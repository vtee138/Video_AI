import {createWriteStream} from 'node:fs';
import {copyFile, mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {publicDir, root} from './common.mjs';

const cacheLifetimeMs = 24 * 60 * 60 * 1000;
const cacheDir = path.join(root, '.cache', 'stock');
const ignored = new Set(['a', 'and', 'city', 'drone', 'footage', 'of', 'the', 'video', 'view', 'aerial', 'shot']);
const words = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) || [];
const safeHttps = value => typeof value === 'string' && value.startsWith('https://') ? value : '';
const cropWidth = file => Math.min(file.width || 0, (file.height || 0) * 9 / 16);

function broadItem(item) {
  const anchorWords = new Set(item.anchors.flatMap(words));
  const visual = item.visualAnchors.flatMap(words).filter(word => word.length > 2 && !ignored.has(word));
  const context = words(item.query).filter(word => word.length > 2 && !ignored.has(word) && !anchorWords.has(word));
  const query = [...new Set([...visual, ...context.slice(-2)])].slice(0, 4).join(' ');
  if (!query || query === item.query.toLowerCase()) return null;
  return {...item, query, anchors: [], visualAnchors: visual.length ? [visual[0]] : []};
}

async function cachedSearch(provider, query, request) {
  const name = createHash('sha256').update(`${provider}:${query.toLowerCase()}`).digest('hex') + '.json';
  const file = path.join(cacheDir, name);
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - saved.at < cacheLifetimeMs) return saved.data;
  } catch { /* Cache miss or corrupt cache. */ }
  const data = await request();
  await mkdir(cacheDir, {recursive: true});
  await writeFile(file, JSON.stringify({at: Date.now(), data}), 'utf8');
  return data;
}

async function jsonRequest(url, headers = {}) {
  const response = await fetch(url, {headers, signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function queryItems(queries) {
  return queries.map(item => typeof item === 'string'
    ? {query: item, subject: item, anchors: [], visualAnchors: []}
    : {query: String(item?.query || '').trim(), subject: String(item?.subject || '').trim(),
      anchors: Array.isArray(item?.anchors) ? item.anchors.slice(0, 3) : [],
      visualAnchors: Array.isArray(item?.visualAnchors) ? item.visualAnchors.slice(0, 2) : []})
    .filter(item => item.query).slice(0, 16);
}

function rank(candidate, item) {
  const metadata = new Set(words(candidate.description));
  const wanted = words(item.query).filter(word => word.length > 2 && !ignored.has(word));
  const anchorMatches = item.anchors.filter(anchor => words(anchor).every(word => metadata.has(word))).length;
  const sceneMatches = item.visualAnchors.filter(anchor => words(anchor).every(word => metadata.has(word))).length;
  const matches = wanted.filter(word => metadata.has(word)).length;
  return matches * 12 + anchorMatches * 100 + sceneMatches * 80 + (candidate.height > candidate.width ? 25 : 0);
}

function pixabayCandidates(hits, item) {
  return (hits || []).filter(video => video.duration >= 5).flatMap(video => {
    const variants = Object.values(video.videos || {}).filter(file => safeHttps(file?.url) &&
      file.width >= 720 && file.height >= 720 && cropWidth(file) >= 400 &&
      file.size > 0 && file.size <= 50_000_000);
    variants.sort((a, b) => (cropWidth(b) >= 540 ? 1 : 0) - (cropWidth(a) >= 540 ? 1 : 0) ||
      (cropWidth(a) >= 540 && cropWidth(b) >= 540 ? a.size - b.size : cropWidth(b) - cropWidth(a)));
    const file = variants[0];
    if (!file) return [];
    const candidate = {id: `pixabay:${video.id}`, provider: 'Pixabay', sourceUrl: video.pageURL,
      creator: video.user || '', description: video.tags || '', thumbnail: safeHttps(video.videos?.tiny?.thumbnail || video.videos?.small?.thumbnail),
      previewUrl: file.url, downloadUrl: file.url, width: file.width, height: file.height,
      duration: video.duration, query: item.query, subject: item.subject};
    const score = rank(candidate, item);
    if (item.anchors.length && !item.anchors.some(anchor => words(anchor).every(word => words(candidate.description).includes(word)))) return [];
    if (item.visualAnchors.length && !words(candidate.description).includes(words(item.visualAnchors[0])[0])) return [];
    return [{...candidate, score}];
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

function pexelsCandidates(videos, item) {
  return (videos || []).flatMap(video => {
    const files = (video.video_files || []).filter(file => file.file_type === 'video/mp4' &&
      safeHttps(file.link) && file.width >= 720 && file.height >= 720 && cropWidth(file) >= 400);
    files.sort((a, b) => (cropWidth(b) >= 540 ? 1 : 0) - (cropWidth(a) >= 540 ? 1 : 0) ||
      (cropWidth(a) >= 540 && cropWidth(b) >= 540
        ? a.width * a.height - b.width * b.height : cropWidth(b) - cropWidth(a)));
    const file = files[0];
    if (!file || video.duration < 5) return [];
    const candidate = {id: `pexels:${video.id}`, provider: 'Pexels', sourceUrl: video.url,
      creator: video.user?.name || '', description: item.query, thumbnail: safeHttps(video.image),
      previewUrl: file.link, downloadUrl: file.link, width: file.width, height: file.height,
      duration: video.duration, query: item.query, subject: item.subject};
    return [{...candidate, score: rank(candidate, item)}];
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

function coverrCandidates(hits, item) {
  return (hits || []).flatMap(video => {
    if (video.duration < 5 || video.max_height < 720 || cropWidth({width: video.max_width, height: video.max_height}) < 400 ||
        !safeHttps(video.urls?.mp4) || !safeHttps(video.urls?.mp4_download)) return [];
    const candidate = {id: `coverr:${video.id}`, provider: 'Coverr',
      sourceUrl: `https://coverr.co/videos/${encodeURIComponent(video.id)}`,
      creator: '', description: [video.title, video.description, ...(video.tags || [])].join(' '),
      thumbnail: safeHttps(video.poster || video.thumbnail), previewUrl: safeHttps(video.urls.mp4_preview || video.urls.mp4),
      downloadUrl: video.urls.mp4_download, fallbackDownloadUrl: video.urls.mp4,
      width: video.max_width, height: video.max_height,
      duration: video.duration, query: item.query, subject: item.subject};
    return [{...candidate, score: rank(candidate, item)}];
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function configuredProviders() {
  return [
    {name: 'Pixabay', enabled: Boolean(process.env.PIXABAY_API_KEY)},
    {name: 'Pexels', enabled: Boolean(process.env.PEXELS_API_KEY)},
    {name: 'Coverr', enabled: Boolean(process.env.COVERR_API_KEY)},
  ];
}

export async function findFootage(queries) {
  const providers = configuredProviders().filter(provider => provider.enabled);
  if (!providers.length) return {candidates: [], warnings: ['Chưa cấu hình API footage; hãy thêm MP4 local.'],
    summary: 'Không có nguồn footage nào đang bật'};
  const candidates = new Map();
  const warnings = [];
  const stats = new Map(providers.map(provider => [provider.name, {clips: new Set(), fallbacks: 0, failures: 0}]));
  const unavailable = new Set();
  for (const item of queryItems(queries)) {
    for (const provider of providers) {
      if (unavailable.has(provider.name)) continue;
      try {
        const search = async searchItem => {
          if (provider.name === 'Pixabay') {
            const url = new URL('https://pixabay.com/api/videos/');
            url.search = new URLSearchParams({key: process.env.PIXABAY_API_KEY, q: searchItem.query.slice(0, 100),
              video_type: 'film', safesearch: 'true', per_page: '30'}).toString();
            const data = await cachedSearch('pixabay', searchItem.query, () => jsonRequest(url));
            return pixabayCandidates(data.hits, searchItem);
          }
          if (provider.name === 'Pexels') {
            const url = new URL('https://api.pexels.com/v1/videos/search');
            url.search = new URLSearchParams({query: searchItem.query, per_page: '20'}).toString();
            const data = await cachedSearch('pexels', searchItem.query,
              () => jsonRequest(url, {Authorization: process.env.PEXELS_API_KEY}));
            return pexelsCandidates(data.videos, searchItem);
          }
          const url = new URL('https://api.coverr.co/videos');
          url.search = new URLSearchParams({query: searchItem.query, page_size: '20', urls: 'true'}).toString();
          const data = await cachedSearch('coverr', searchItem.query,
            () => jsonRequest(url, {Authorization: `Bearer ${process.env.COVERR_API_KEY}`}));
          return coverrCandidates(data.hits, searchItem);
        };
        let found = await search(item);
        if (!found.length) {
          const fallback = broadItem(item);
          if (fallback) {
            stats.get(provider.name).fallbacks++;
            found = (await search(fallback)).map(candidate => ({...candidate,
              query: item.query, subject: item.subject, fallbackQuery: fallback.query}));
          }
        }
        for (const candidate of found) {
          stats.get(provider.name).clips.add(candidate.id);
          if (!candidates.has(candidate.id) || candidates.get(candidate.id).score < candidate.score) candidates.set(candidate.id, candidate);
        }
      } catch (error) {
        stats.get(provider.name).failures++;
        warnings.push(`${provider.name}: ${item.query} (${error.message})`);
        if (/HTTP (401|403|429)/i.test(error.message || '')) unavailable.add(provider.name);
      }
    }
  }
  const summary = [...stats.entries()].map(([name, value]) =>
    `${name}: ${value.clips.size} clip${value.fallbacks ? `, ${value.fallbacks} fallback` : ''}${value.failures ? `, ${value.failures} lỗi` : ''}`).join(' · ');
  return {candidates: [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 80), warnings, summary};
}

export function publicCandidate(candidate, runId) {
  return {id: candidate.id, provider: candidate.provider, sourceUrl: candidate.sourceUrl,
    creator: candidate.creator, description: candidate.description, thumbnail: candidate.thumbnail,
    width: candidate.width, height: candidate.height, duration: candidate.duration,
    query: candidate.query, subject: candidate.subject,
    previewUrl: `/api/runs/${encodeURIComponent(runId)}/footage/${encodeURIComponent(candidate.id)}/preview`};
}

function transientDownloadError(error) {
  return error?.name === 'TimeoutError' ||
    /aborted due to timeout|ECONNRESET|fetch failed|UND_ERR|HTTP (408|429|5\d\d)/i.test(error?.message || '');
}

async function downloadRemoteCandidate(candidate, file, position, total) {
  let lastError;
  let attempts = 0;
  const urls = [candidate.downloadUrl];
  if (candidate.provider === 'Coverr' && safeHttps(candidate.fallbackDownloadUrl) &&
      candidate.fallbackDownloadUrl !== candidate.downloadUrl) urls.push(candidate.fallbackDownloadUrl);
  for (let attempt = 1; attempt <= 3; attempt++) {
    attempts = attempt;
    try {
      const response = await fetch(urls[Math.min(attempt - 1, urls.length - 1)],
        {signal: AbortSignal.timeout(180000)});
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (/^(text\/html|application\/json)/i.test(response.headers.get('content-type') || '')) {
        throw new Error('CDN trả nội dung không phải video');
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
      return;
    } catch (error) {
      lastError = error;
      await unlink(file).catch(() => {});
      if (attempt === 3 || (!transientDownloadError(error) && attempt >= urls.length)) break;
      await delay(attempt === 1 ? 1000 : 3000);
    }
  }
  const cause = lastError?.cause?.code ? ` (${lastError.cause.code})` : '';
  throw new Error(`Không tải được clip ${position}/${total} từ ${candidate.provider} (${candidate.id}) sau ${attempts} lần: ${lastError?.message || 'lỗi không xác định'}${cause}`);
}

export async function downloadFootage(selected, runId) {
  if (selected.length < 8 || selected.length > 20) throw new Error('Hãy chọn từ 8 đến 20 clip khác nhau.');
  const mediaDir = path.join(publicDir, 'runs', runId);
  await mkdir(mediaDir, {recursive: true});
  const clips = [];
  for (const [index, candidate] of selected.entries()) {
    const name = `clip-${index + 1}.mp4`;
    if (candidate.provider === 'Local' && candidate.localPath) {
      await copyFile(candidate.localPath, path.join(mediaDir, name));
    } else {
      await downloadRemoteCandidate(candidate, path.join(mediaDir, name), index + 1, selected.length);
    }
    clips.push({path: `runs/${runId}/${name}`, sourceUrl: candidate.sourceUrl,
      creator: candidate.creator, provider: candidate.provider, duration: candidate.duration,
      query: candidate.query, subject: candidate.subject, tags: candidate.description});
  }
  return clips;
}
