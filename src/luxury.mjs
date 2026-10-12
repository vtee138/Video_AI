import {createWriteStream} from 'node:fs';
import {mkdir, open, readFile, readdir, rename, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {publicDir, root, saveJson} from './common.mjs';
import {downloadFootage} from './stock.mjs';
import {listMusicTracks} from './media.mjs';
import {renderVideo} from './render.mjs';
import {saveVideo} from './db.mjs';
import {sameUiOrigin} from './request-origin.mjs';
import {selectLuxurySuggestions} from './luxury-selection.mjs';

const execFileAsync = promisify(execFile);
const sessions = new Map();
const sessionDir = path.join(root, '.tmp', 'luxury-sessions');
const sessionWrites = new Map();
const footageDir = path.join(publicDir, 'luxury-footage');
const selectionHistoryFile = path.join(root, '.tmp', 'luxury-selection-history.json');
let selectionHistoryWrite = Promise.resolve();
const maxFootageBytes = 500_000_000;
const defaultPostCaption = 'I attract abundance every day. ✨ #LifeOfLuxury #WealthMindset';
const categories = [
  {id: 'car', name: 'Luxury Car', slots: [0, 1], required: 2},
  {id: 'jet', name: 'Private Jet', slots: [2], required: 1},
  {id: 'yacht', name: 'Superyacht', slots: [3], required: 1},
  {id: 'mansion', name: 'Mansion', slots: [4], required: 1},
  {id: 'watch', name: 'Luxury Watch', slots: [5], required: 1},
  {id: 'skyline', name: 'Night Skyline', slots: [6, 7], required: 2},
];
const scenes = [
  {name: 'Luxury Car · arrival', category: 'car'},
  {name: 'Luxury Car · drive', category: 'car'},
  {name: 'Private Jet', category: 'jet'},
  {name: 'Superyacht', category: 'yacht'},
  {name: 'Mansion', category: 'mansion'},
  {name: 'Luxury Watch', category: 'watch'},
  {name: 'Night Skyline · wide', category: 'skyline'},
  {name: 'Night Skyline · finale', category: 'skyline'},
];

function sessionFile(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return path.join(sessionDir, `${id}.json`);
}

async function persistSession(session) {
  session.updatedAt = new Date().toISOString();
  const data = JSON.stringify(session);
  const previous = sessionWrites.get(session.id) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    await mkdir(sessionDir, {recursive: true});
    const file = sessionFile(session.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, 'utf8');
      await rename(temporary, file);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  });
  sessionWrites.set(session.id, write);
  try { await write; } finally {
    if (sessionWrites.get(session.id) === write) sessionWrites.delete(session.id);
  }
}

async function loadSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const file = sessionFile(id);
  if (!file) return null;
  let session;
  try { session = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (session.id !== id || !Array.isArray(session.candidates)) return null;
  if (['searching', 'queued', 'downloading', 'rendering'].includes(session.status)) {
    session.status = 'ready';
    session.progress = 0;
    session.summary = 'Lượt xử lý trước bị gián đoạn. Kiểm tra lựa chọn rồi render lại.';
    await persistSession(session);
  }
  sessions.set(id, session);
  return session;
}

async function listSavedSessions() {
  const files = await readdir(sessionDir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const entries = await Promise.all(files.filter(name => /^[a-zA-Z0-9-]+\.json$/.test(name))
    .map(async name => {
      try {
        const session = await loadSession(name.slice(0, -5));
        if (session?.status === 'ready') await refreshSessionFootage(session);
        return session && session.status !== 'searching' ? {
          id: session.id, status: session.status, updatedAt: session.updatedAt,
          selectedCount: (session.draft?.ids || session.suggestedIds || []).filter(Boolean).length,
        } : null;
      } catch { return null; }
    }));
  return entries.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
}

async function readFootageFolder(directory, category) {
  const files = await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const clips = await Promise.all(files.filter(name => /^[a-f0-9-]+\.json$/i.test(name)).map(async name => {
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      const id = path.basename(name, '.json');
      await open(path.join(directory, `${id}.mp4`), 'r').then(handle => handle.close());
      return {id: `local:${id}`, category, provider: 'Local', description: metadata.name,
        thumbnail: '', sourceUrl: '', localPath: path.join(directory, `${id}.mp4`),
        duration: metadata.duration, query: category, subject: category};
    } catch { return null; }
  }));
  return clips.filter(Boolean);
}

async function listLuxuryFootage() {
  const groups = await Promise.all([
    ...categories.map(category => readFootageFolder(path.join(footageDir, category.id), category.id)),
    ...scenes.map((scene, slot) => readFootageFolder(path.join(footageDir, `slot-${slot}`), scene.category)),
  ]);
  return [...new Map(groups.flat().map(item => [item.id, item])).values()];
}

function candidatesForSlot(footage, slot) {
  return footage.filter(item => item.category === scenes[slot].category)
    .map(item => ({...item, slot, subject: scenes[slot].name}));
}

function publicFootage(item) {
  return {id: item.id, category: item.category, name: item.description, duration: item.duration,
    previewUrl: `/api/luxury/footage/${encodeURIComponent(item.id)}/preview`};
}

async function refreshSessionFootage(session) {
  if (session.status !== 'ready') return;
  const footage = await listLuxuryFootage();
  const candidates = scenes.flatMap((_, slot) => candidatesForSlot(footage, slot));
  const current = session.candidates.map(item => `${item.slot}:${item.id}`).join('|');
  const next = candidates.map(item => `${item.slot}:${item.id}`).join('|');
  if (current === next) return;
  session.candidates = candidates;
  session.suggestedIds = selectLuxurySuggestions(candidates, await readSelectionHistory(), scenes.length);
  const draft = session.draft || {};
  session.draft = {ids: scenes.map((_, slot) => candidates.some(item => item.slot === slot &&
    item.id === draft.ids?.[slot]) ? draft.ids[slot] : session.suggestedIds[slot]),
    musicName: draft.musicName || '', postCaption: draft.postCaption ?? defaultPostCaption};
  session.summary = 'Đã cập nhật lựa chọn từ kho footage Luxury riêng.';
  await persistSession(session);
}

async function readSelectionHistory() {
  try {
    const entries = JSON.parse(await readFile(selectionHistoryFile, 'utf8'));
    return Array.isArray(entries) ? entries.filter(entry => Array.isArray(entry) &&
      entry.length === scenes.length && entry.every(id => typeof id === 'string')).slice(0, 12) : [];
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function recordSelection(ids) {
  selectionHistoryWrite = selectionHistoryWrite.catch(() => {}).then(async () => {
    const history = await readSelectionHistory();
    await saveJson(selectionHistoryFile, [ids, ...history].slice(0, 12));
  });
  await selectionHistoryWrite;
}

function publicCandidate(candidate, sessionId) {
  return {id: candidate.id, slot: candidate.slot, provider: candidate.provider,
    description: candidate.description, thumbnail: candidate.thumbnail,
    duration: candidate.duration, sourceUrl: candidate.sourceUrl,
    previewUrl: `/api/luxury/sessions/${encodeURIComponent(sessionId)}/preview/${encodeURIComponent(candidate.id)}`};
}

function snapshot(session) {
  return {id: session.id, status: session.status, progress: session.progress,
    updatedAt: session.updatedAt, draft: session.draft || null,
    error: session.error || null, outputUrl: session.outputName ? `/output/${encodeURIComponent(session.outputName)}` : null,
    candidates: session.candidates.map(item => publicCandidate(item, session.id)),
    suggestedIds: session.suggestedIds || [],
    warnings: session.warnings || [], summary: session.summary || ''};
}

async function storeFootage(req, category) {
  if (!categories.some(item => item.id === category)) throw new Error('Nhóm footage không hợp lệ.');
  if (!String(req.headers['content-type'] || '').startsWith('video/mp4')) throw new Error('Hãy tải lên file MP4.');
  const directory = path.join(footageDir, category);
  await mkdir(directory, {recursive: true});
  const id = `local:${randomUUID()}`;
  const file = path.join(directory, `${id.slice(6)}.mp4`);
  const metadataFile = path.join(directory, `${id.slice(6)}.json`);
  let size = 0;
  try {
    await pipeline(req, new Transform({transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > maxFootageBytes ? new Error('Mỗi clip tối đa 500 MB.') : null, chunk);
    }}), createWriteStream(file));
    const handle = await open(file, 'r');
    const header = Buffer.alloc(12);
    try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
    if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('File tải lên không phải MP4 hợp lệ.');
    const probe = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file], {timeout: 15000});
    const duration = Number(probe.stdout.trim());
    if (!Number.isFinite(duration) || duration < 3.8) throw new Error('Clip cần dài ít nhất 3,8 giây.');
    const name = decodeURIComponent(String(req.headers['x-file-name'] || 'Clip tải lên')).slice(0, 120);
    const candidate = {id, category, provider: 'Local', description: name, thumbnail: '', sourceUrl: '',
      localPath: file, duration, query: category, subject: category};
    await saveJson(metadataFile, {name, duration});
    return candidate;
  } catch (error) {
    await unlink(metadataFile).catch(() => {});
    await unlink(file).catch(() => {});
    throw error;
  }
}

async function uploadClip(req, session, slot) {
  if (session.status !== 'ready') throw new Error('Phiên Luxury đang render hoặc đã hoàn tất. Hãy tạo phiên mới.');
  if (!Number.isInteger(slot) || slot < 0 || slot >= scenes.length) throw new Error('Cảnh footage không hợp lệ.');
  const candidate = {...await storeFootage(req, scenes[slot].category), slot,
    subject: scenes[slot].name};
  await refreshSessionFootage(session);
  return publicCandidate(candidate, session.id);
}

async function transitionSound(sessionId) {
  const relative = `runs/${sessionId}/transition.wav`;
  const folder = path.join(publicDir, 'runs', sessionId);
  await mkdir(folder, {recursive: true});
  const rate = 44100;
  const samples = Math.round(rate * .34);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  let seed = 32119;
  for (let index = 0; index < samples; index++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const t = index / samples;
    const envelope = Math.sin(Math.PI * t) ** 2 * (1 - t);
    const noise = (seed / 0xffffffff * 2 - 1) * envelope * 0.12;
    data.writeInt16LE(Math.round(noise * 32767), 44 + index * 2);
  }
  await writeFile(path.join(folder, 'transition.wav'), data);
  return relative;
}

async function produce(session, selected, postCaption, musicName, {downloadSlots, renderSlots}) {
  try {
    session.status = 'downloading'; session.progress = 0.08;
    await persistSession(session);
    const clips = await downloadSlots.use(() => downloadFootage(selected, session.id));
    await saveJson(path.join(root, '.tmp', session.id, 'media-sources.json'), clips);
    const spec = {type: 'luxury', title: 'Life of Luxury', width: 1080, height: 1920,
      fps: 30, duration: 30, backgroundClips: clips.map(item => item.path),
      musicPath: `luxury-music/${musicName}`, sfxPath: await transitionSound(session.id)};
    await saveJson(path.join(root, '.tmp', session.id, 'video-spec.json'), spec);
    await writeFile(path.join(root, '.tmp', session.id, 'caption.txt'), postCaption, 'utf8');
    session.status = 'rendering'; session.progress = .3;
    await persistSession(session);
    const file = await renderSlots.use(() => renderVideo(spec, session.id, progress => {
      session.progress = .3 + progress * .7;
    }));
    session.outputName = path.basename(file);
    await saveVideo({outputName: session.outputName, runId: session.id,
      title: spec.title, caption: postCaption, template: 'luxury'});
    session.status = 'done'; session.progress = 1;
    await persistSession(session);
  } catch (error) {
    session.status = 'error'; session.error = error.message;
    await persistSession(session).catch(persistError => console.error('Không lưu được phiên Luxury:', persistError));
  }
}

export async function handleLuxuryRequest(req, res, url, helpers) {
  if (!url.pathname.startsWith('/api/luxury/')) return false;
  const {json, body, sendFile, runId, downloadSlots, renderSlots} = helpers;
  if (req.method === 'GET' && url.pathname === '/api/luxury/plan') {
    json(res, 200, {scenes, categories, defaultPostCaption, tracks: await listMusicTracks('luxury')}); return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/luxury/footage') {
    json(res, 200, {categories, clips: (await listLuxuryFootage()).map(publicFootage)}); return true;
  }
  const footageRoute = /^\/api\/luxury\/footage\/([^/]+)(?:\/(preview))?$/.exec(url.pathname);
  if (footageRoute) {
    const key = decodeURIComponent(footageRoute[1]);
    if (req.method === 'POST' && !footageRoute[2]) {
      if (!sameUiOrigin(req)) { json(res, 403, {error: 'Hãy tải footage từ giao diện ứng dụng.'}); return true; }
      json(res, 201, {clip: publicFootage(await storeFootage(req, key))}); return true;
    }
    const clip = (await listLuxuryFootage()).find(item => item.id === key);
    if (!clip) { json(res, 404, {error: 'Không tìm thấy footage trong kho Luxury.'}); return true; }
    if (req.method === 'GET' && footageRoute[2] === 'preview') {
      await sendFile(res, clip.localPath, 'video/mp4', req.headers.range); return true;
    }
    if (req.method === 'DELETE' && !footageRoute[2]) {
      if (!sameUiOrigin(req)) { json(res, 403, {error: 'Hãy xóa footage từ giao diện ứng dụng.'}); return true; }
      await listSavedSessions();
      if ([...sessions.values()].some(session => ['queued', 'downloading', 'rendering'].includes(session.status) &&
        session.draft?.ids?.includes(key))) {
        json(res, 409, {error: 'Clip đang được dùng để render. Hãy đợi video hoàn tất rồi xóa.'});
        return true;
      }
      await unlink(clip.localPath);
      await unlink(clip.localPath.replace(/\.mp4$/, '.json')).catch(() => {});
      await Promise.all([...sessions.values()].filter(session => session.status === 'ready')
        .map(session => refreshSessionFootage(session)));
      json(res, 200, {deleted: key}); return true;
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/luxury/sessions') {
    json(res, 200, {sessions: await listSavedSessions()}); return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/luxury/search') {
    if (!sameUiOrigin(req)) { json(res, 403, {error: 'Hãy tạo video từ giao diện ứng dụng.'}); return true; }
    const id = runId();
    const session = {id, status: 'searching', progress: 0, candidates: [], warnings: [], error: null};
    sessions.set(id, session);
    try {
      const footage = await listLuxuryFootage();
      const candidates = scenes.flatMap((_, slot) => candidatesForSlot(footage, slot));
      session.candidates = candidates;
      session.suggestedIds = selectLuxurySuggestions(candidates, await readSelectionHistory(), scenes.length);
      session.draft = {ids: session.suggestedIds, postCaption: defaultPostCaption, musicName: ''};
      session.warnings = [];
      session.summary = 'Mỗi video chọn ngẫu nhiên từ kho footage Luxury; ưu tiên tránh clip vừa dùng.';
      session.status = 'ready';
      await persistSession(session);
      json(res, 200, {session: snapshot(session)});
    } catch (error) {
      sessions.delete(id);
      throw error;
    }
    return true;
  }
  const match = /^\/api\/luxury\/sessions\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return false;
  const session = await loadSession(match[1]);
  if (!session) { json(res, 404, {error: 'Không tìm thấy phiên Luxury đã lưu.'}); return true; }
  const action = match[2] || '';
  if (session.status === 'ready') await refreshSessionFootage(session);
  if (req.method === 'GET' && !action) { json(res, 200, {session: snapshot(session)}); return true; }
  if (req.method === 'PATCH' && action === 'draft') {
    if (!sameUiOrigin(req)) { json(res, 403, {error: 'Hãy lưu phiên từ giao diện ứng dụng.'}); return true; }
    if (session.status !== 'ready') throw new Error('Phiên này không thể sửa. Hãy tạo bộ footage mới.');
    const input = await body(req);
    const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
    const postCaption = String(input.postCaption || '').trim();
    const musicName = String(input.musicName || '');
    if (ids.length !== scenes.length || ids.some((id, slot) => id &&
      !session.candidates.some(item => item.id === id && item.slot === slot))) {
      throw new Error('Lựa chọn footage không hợp lệ.');
    }
    if (postCaption.length > 300) throw new Error('Caption bài đăng tối đa 300 ký tự.');
    if (musicName && !(await listMusicTracks('luxury')).some(track => track.name === musicName)) {
      throw new Error('Nhạc đã chọn không còn trong kho Luxury.');
    }
    session.draft = {ids, postCaption, musicName};
    await persistSession(session);
    json(res, 200, {session: snapshot(session)}); return true;
  }
  const upload = /^clips\/(\d+)$/.exec(action);
  if (req.method === 'POST' && upload) {
    if (!sameUiOrigin(req)) { json(res, 403, {error: 'Hãy tải clip từ giao diện ứng dụng.'}); return true; }
    json(res, 201, {candidate: await uploadClip(req, session, Number(upload[1]))}); return true;
  }
  const preview = /^preview\/(.+)$/.exec(action);
  if (req.method === 'GET' && preview) {
    const candidate = session.candidates.find(item => item.id === decodeURIComponent(preview[1]));
    if (!candidate) throw new Error('Không tìm thấy clip xem trước.');
    if (candidate.localPath) await sendFile(res, candidate.localPath, 'video/mp4', req.headers.range);
    else {
      const response = await fetch(candidate.previewUrl,
        {headers: req.headers.range ? {Range: req.headers.range} : {}, signal: AbortSignal.timeout(120000)});
      if (!response.ok || !response.body) throw new Error(`Không xem trước được clip: HTTP ${response.status}.`);
      const headers = {'Content-Type': 'video/mp4', 'Cache-Control': 'no-store'};
      for (const key of ['content-range', 'content-length', 'accept-ranges']) {
        if (response.headers.has(key)) headers[key] = response.headers.get(key);
      }
      res.writeHead(response.status === 206 ? 206 : 200, headers);
      await pipeline(Readable.fromWeb(response.body), res);
    }
    return true;
  }
  if (req.method === 'POST' && action === 'render') {
    if (!sameUiOrigin(req)) { json(res, 403, {error: 'Hãy render từ giao diện ứng dụng.'}); return true; }
    if (session.status !== 'ready') throw new Error('Phiên Luxury chưa sẵn sàng để render.');
    const input = await body(req);
    const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
    const postCaption = String(input.postCaption || '').trim();
    if (ids.length !== scenes.length || new Set(ids).size !== scenes.length) {
      throw new Error('Hãy chọn 8 clip khác nhau, mỗi cảnh một clip.');
    }
    const selected = ids.map((id, slot) => session.candidates.find(item => item.id === id && item.slot === slot));
    if (selected.some(item => !item)) throw new Error('Có cảnh chưa chọn đúng footage.');
    if (selected.some(item => item.provider !== 'Local')) throw new Error('Video Luxury mới chỉ dùng footage từ kho riêng.');
    if (postCaption.length > 300) throw new Error('Caption bài đăng tối đa 300 ký tự.');
    const musicName = String(input.musicName || '');
    if (!(await listMusicTracks('luxury')).some(track => track.name === musicName)) {
      throw new Error('Hãy tải và chọn bản Cherry Lady không lời trong kho nhạc Luxury.');
    }
    session.draft = {ids, postCaption, musicName};
    await recordSelection(ids);
    session.status = 'queued'; session.progress = .02;
    await persistSession(session);
    void produce(session, selected, postCaption, musicName, {downloadSlots, renderSlots});
    json(res, 202, {session: snapshot(session)}); return true;
  }
  return false;
}
