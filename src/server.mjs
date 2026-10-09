import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {aiConfig, brainstorm, brainstormQuotes, discoverSuperTopic, research, writeStory} from './ai.mjs';
import {checkSources, normalizeResearch} from './facts.mjs';
import {chooseMusic, deleteMusic, listMusic, listMusicTracks, quoteMusicTiming, setMusicWeight, uploadMusic} from './media.mjs';
import {configuredProviders, downloadFootage, findFootage, publicCandidate} from './stock.mjs';
import {outputDir, publicDir, root, saveJson} from './common.mjs';
import {renderVideo} from './render.mjs';
import {makeCancelSignal} from '@remotion/renderer';
import {quoteCaption, quoteDuration} from './quote.mjs';
import {copyQuoteImage, deleteQuoteImage, listQuoteImages, pickQuoteImage, uploadQuoteImage} from './quote-images.mjs';
import {facebookStatus, platformNames, publishConfig, publishers, tiktokCreator, tiktokStatus, youtubeStatus,
  zernioPostStatus} from './publish.mjs';
import {zernioAccounts, zernioApiKey, zernioConnectUrl, zernioFindPost} from './zernio.mjs';
import {rankingCaption, withoutSourceAppendix} from './caption.mjs';
import {autoPostTargets, selectAutoFootage, validateAutoSettings} from './auto.mjs';
import {activePostForOutput, activeSuperCampaigns, claimDueSuperItem, claimNextSuperRetry, claimSuperItemFootageRepair, claimSuperItemRetry, createSuperCampaign, createSuperItem,
  deleteSessionRecord, deleteVideoRecord,
  failSuperItem, finishSuperItem, flagSuperAttention, initDatabase, listJobs, listSessions, listSuperCampaigns, listVideos, loadPost,
  interruptedSuperRetries, loadSessionForRetry, queueFailedSuperRetries, videoForRun,
  markPublication, openSuperItem, publicationStatus, recentSuperTopics, resumeSuperCampaign,
  saveJob, savePost, saveVideo, scheduleSuperItem, seedExistingOutputs, stopSuperCampaign, superItemsForJobs,
  updateSuperItem} from './db.mjs';
import {nextPostAt, validateSuperPlan} from './super-auto.mjs';
import {concurrencyConfig, Semaphore} from './concurrency.mjs';
import {nextRunnableJobIndex, queueStatus} from './queue-control.mjs';
import {handleFlowRequest} from './flow-tryon.mjs';
import {watchFlowDownloads} from './flow-download-watch.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const webDir = path.join(root, 'web');
const thumbnailDir = path.join(root, '.cache', 'thumbnails');
const execFileAsync = promisify(execFile);
const thumbnailJobs = new Map();
let thumbnailQueue = Promise.resolve();
const runs = new Map();
const pendingJobs = [];
const activeJobs = new Set();
const retryingSessions = new Set();
const posts = new Map();
const concurrency = concurrencyConfig();
const renderSlots = new Semaphore(concurrency.renders);
const downloadSlots = new Semaphore(concurrency.downloads);
const publishSlots = new Semaphore(concurrency.publishes);
let queueWorkerActive = false;
let superWorkerActive = false;
let superLastStatusRefresh = 0;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/create', ['index.html', 'text/html; charset=utf-8']],
  ['/create/ideas', ['index.html', 'text/html; charset=utf-8']],
  ['/create/queue', ['index.html', 'text/html; charset=utf-8']],
  ['/create/footage', ['index.html', 'text/html; charset=utf-8']],
  ['/create/results', ['index.html', 'text/html; charset=utf-8']],
  ['/automation', ['index.html', 'text/html; charset=utf-8']],
  ['/flow', ['index.html', 'text/html; charset=utf-8']],
  ['/publishing', ['index.html', 'text/html; charset=utf-8']],
  ['/library', ['index.html', 'text/html; charset=utf-8']],
  ['/music', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/flow.js', ['flow.js', 'text/javascript; charset=utf-8']],
  ['/flow.css', ['flow.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const json = (res, status, data) => {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
};

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Dữ liệu gửi lên quá lớn.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('Nội dung gửi lên không hợp lệ.'); }
}

const runId = () => new Date().toISOString().replace(/[:.]/g, '-');
const postId = () => `${runId()}-${Math.random().toString(36).slice(2, 8)}`;
const runDir = (id) => path.join(root, '.tmp', id);

function postSnapshot(post) {
  return {id: post.id, outputName: post.outputName, source: post.source,
    createdAt: post.createdAt,
    results: Object.fromEntries(Object.entries(post.results).map(([key, result]) => [key, {...result}]))};
}

async function postConfig() {
  const platforms = publishConfig();
  if (!zernioApiKey() && !zernioApiKey('youtube')) return {platforms, accounts: [], provider: 'direct'};
  const accounts = await zernioAccounts();
  for (const [platform, value] of Object.entries(platforms)) {
    if (platform === 'facebook' && accounts.some(account => account.platform === 'facebook' && account.active)) {
      value.provider = 'zernio';
    }
    if (value.provider === 'zernio') value.configured = accounts.some(account => account.platform === platform && account.active);
  }
  return {platforms, accounts, provider: Object.values(platforms).some(value => value.provider === 'direct') ? 'mixed' : 'zernio'};
}

async function publishPost(post, file, targets) {
  return publishSlots.use(async () => {
    for (const [platform, options] of Object.entries(targets)) {
      const result = post.results[platform];
      result.state = 'uploading';
      await savePost(post);
      let lastSavedProgress = 0;
      let progressWrite = Promise.resolve();
      let progressError = null;
      try {
        const uploaded = await publishers[platform](file, options, value => {
          result.progress = Math.round(value * 100);
          if (result.progress - lastSavedProgress >= 10) {
            lastSavedProgress = result.progress;
            progressWrite = progressWrite.then(() => savePost(post)).catch(error => { progressError ||= error; });
          }
        });
        await progressWrite;
        if (progressError) throw progressError;
        Object.assign(result, uploaded, {progress: 100});
      } catch (error) {
        await progressWrite.catch(() => {});
        Object.assign(result, {state: 'failed', error: error.message});
      }
      await savePost(post);
    }
  });
}

async function refreshPost(post) {
  for (const [platform, result] of Object.entries(post.results)) {
    if (result.provider === 'zernio' && result.state === 'verifying') {
      try {
        const found = await zernioFindPost(platform, result.accountId, result.mediaUrl);
        if (found) {
          Object.assign(result, found);
          delete result.mediaUrl;
          delete result.statusError;
          delete result.error;
        }
        else result.message = 'Chưa tìm thấy bài trên Zernio. Hãy kiểm tra lại sau; đừng đăng lại lúc này.';
      } catch (error) { result.statusError = error.message; }
      continue;
    }
    if (!result.id || result.state !== 'processing' && !(result.provider === 'zernio' && result.state === 'published' && !result.url)) continue;
    try {
      if (result.provider === 'zernio') {
        Object.assign(result, await zernioPostStatus(result.id, platform, result.accountId));
      } else if (platform === 'tiktok') {
        const status = await tiktokStatus(result.id);
        result.remoteStatus = status.status;
        if (status.status === 'PUBLISH_COMPLETE') {
          result.state = 'published';
          const id = status.publicaly_available_post_id?.[0] || status.publicly_available_post_id?.[0];
          if (id) result.url = `https://www.tiktok.com/@${result.creatorUsername}/video/${id}`;
        } else if (status.status === 'FAILED') {
          result.state = 'failed'; result.error = status.fail_reason || 'TikTok xử lý video thất bại.';
        }
      } else if (platform === 'facebook') {
        const status = (await facebookStatus(result.id)).status;
        result.remoteStatus = status?.video_status;
        if (status?.publishing_phase?.status === 'complete') {
          result.state = 'published'; result.url = `https://www.facebook.com/reel/${result.id}`;
        } else if ([status?.video_status, status?.publishing_phase?.status].includes('error')) {
          result.state = 'failed'; result.error = status?.publishing_phase?.error?.message || 'Facebook xử lý Reel thất bại.';
        }
      } else if (platform === 'youtube') {
        const video = await youtubeStatus(result.id);
        result.remoteStatus = video?.processingDetails?.processingStatus || video?.status?.uploadStatus || 'unknown';
        if (result.remoteStatus === 'succeeded' || video?.status?.uploadStatus === 'processed') {
          result.privacyStatus = video?.status?.privacyStatus || null;
          result.state = result.privacyStatus === 'public' ? 'published' : 'ready';
          result.message = video?.status?.privacyStatus === 'public' ? 'Video đã xử lý xong.' :
            `Video đã xử lý xong · quyền riêng tư: ${video?.status?.privacyStatus || 'theo tài khoản'}.`;
        } else if (['failed', 'rejected'].includes(result.remoteStatus)) {
          result.state = 'failed'; result.error = video?.status?.failureReason || video?.status?.rejectionReason || 'YouTube xử lý video thất bại.';
        }
      }
    } catch (error) { result.statusError = error.message; }
  }
  await savePost(post);
}
const publicRun = (run) => ({
  id: run.id,
  prompt: run.prompt,
  template: run.template || 'ranking',
  mode: run.mode || null,
  status: run.status,
  step: run.step,
  progress: run.progress || 0,
  error: run.error || null,
  outputUrl: run.outputName ? `/output/${encodeURIComponent(run.outputName)}` : null,
  caption: run.caption ? withoutSourceAppendix(run.caption) : null,
});
const publicCampaign = ({autoSettings, items, ...campaign}) => ({
  ...campaign, items: items.map(({targets, ...item}) => item),
});

const publicQueueItem = (run) => ({
  id: run.id,
  title: run.idea?.title || 'Video chưa đặt tên',
  template: run.template || 'ranking',
  mode: run.mode || null,
  duration: run.duration || 30,
  latestPeriod: run.idea?.latestPeriod || (run.template === 'quote' ? (run.mode === 'caption' ? 'Nội dung ở caption' : 'Chữ trên video') : ''),
  status: run.status,
  step: run.step,
  progress: run.progress || 0,
  error: run.error || null,
  outputUrl: run.outputName ? `/output/${encodeURIComponent(run.outputName)}` : null,
  caption: run.caption ? withoutSourceAppendix(run.caption) : null,
  metricPeriod: run.facts?.metricPeriod || null,
  auto: Boolean(run.autoSettings),
  manualSuperReview: Boolean(run.manualSuperReview),
  post: run.post ? postSnapshot(run.post) : null,
  publicationStatus: run.post
    ? publicationStatus({manualPublication: 'not_posted'}, [run.post])
    : run.outputName ? 'not_posted' : null,
  footage: run.status === 'footage_review' ? {
    candidates: run.template === 'quote' ? (run.candidates || []) : (run.candidates || []).map(candidate => publicCandidate(candidate, run.id)),
    warnings: run.footageWarnings || [],
    preselectedIds: run.preselectedIds || [],
    requiredClips: run.requiredClips || (run.template === 'quote' ? 1 : 8),
  } : null,
});

function getRun(id) {
  const run = runs.get(id);
  if (!run) throw new Error('Phiên làm việc không còn tồn tại. Hãy tạo lại từ chủ đề.');
  return run;
}

async function createIdeas(prompt, template = 'ranking', mode = null) {
  if (template === 'quote') mode = 'caption';
  const id = runId();
  const folder = runDir(id);
  await mkdir(folder, {recursive: true});
  const run = {id, prompt, template, mode, folder, status: 'thinking',
    step: template === 'quote' ? 'Đang viết 8 nội dung Quote' : 'Đang tìm góc nội dung mới', progress: 0.06};
  runs.set(id, run);
  await saveJob(run);
  try {
    run.ideas = template === 'quote'
      ? await brainstormQuotes(prompt, mode)
      : await brainstorm(prompt);
    await saveJson(path.join(folder, 'ideas.json'), run.ideas);
    run.status = 'ideas';
    run.step = template === 'quote' ? 'Chọn các Quote muốn tạo' : 'Chọn một ý tưởng để nghiên cứu';
    run.progress = 0.18;
    await saveJob(run);
    return run;
  } catch (error) {
    run.status = 'error';
    run.error = error.message;
    await saveJob(run);
    throw error;
  }
}

async function prepareQuoteRun(run) {
  run.status = 'preparing';
  run.step = 'Đang chọn ảnh từ kho Quote';
  run.progress = 0.36;
  run.error = null;
  await saveJob(run);
  try {
    const music = await chooseMusic();
    const timing = music ? await quoteMusicTiming(music.path) : null;
    run.duration = quoteDuration(timing?.seconds, timing?.quietEnding);
    run.requiredClips = 1;
    run.story = {...run.idea, musicPath: music?.path || null};
    run.caption = quoteCaption(run.idea);
    await saveJson(path.join(run.folder, 'quote-spec.json'), {
      ...run.story, template: 'quote', mode: run.mode,
      duration: run.duration, requiredClips: run.requiredClips,
    });
    await writeFile(path.join(run.folder, 'caption.txt'), run.caption, 'utf8');
    run.candidates = await listQuoteImages();
    run.preselectedIds = [pickQuoteImage(run.candidates)?.id].filter(Boolean);
    run.footageWarnings = [];
    run.status = 'footage_review';
    run.step = run.preselectedIds.length ? 'Đã chọn ngẫu nhiên 1 ảnh · chờ duyệt' : 'Kho ảnh trống · hãy upload ảnh Quote';
    run.progress = 0.64;
  } catch (error) {
    run.status = 'error';
    run.error = error.message;
    run.step = 'Không thể chuẩn bị Quote';
  }
  await saveJob(run);
}

async function researchIdea(run, selection) {
  if (!Number.isInteger(selection) || selection < 0 || selection >= run.ideas.length) {
    throw new Error('Ý tưởng được chọn không hợp lệ.');
  }
  run.status = 'researching';
  run.step = 'Đang tìm và đối chiếu dữ liệu';
  run.progress = 0.28;
  run.error = null;
  run.idea = run.ideas[selection];
  await saveJob(run);
  try {
    const raw = await research(run.idea);
    await saveJson(path.join(run.folder, 'research.json'), raw);
    run.facts = normalizeResearch(raw);
    run.step = 'Đang kiểm tra các đường dẫn nguồn';
    run.progress = 0.42;
    await saveJob(run);
    await checkSources(run.facts);
    await saveJson(path.join(run.folder, 'fact-bundle.json'), run.facts);
    run.status = 'review';
    run.step = 'Số liệu sẵn sàng để duyệt';
    run.progress = 0.5;
    await saveJob(run);
    return run.facts;
  } catch (error) {
    run.status = 'error';
    run.error = error.message;
    await saveJob(run);
    throw error;
  }
}

async function prepareRun(run) {
  run.status = 'preparing';
  run.step = 'Đang viết tiêu đề và chọn nhạc';
  run.progress = 0.54;
  run.error = null;
  await saveJob(run);
  try {
    const story = await writeStory(run.facts, run.idea, await listMusic());
    run.story = story;
    await saveJson(path.join(run.folder, 'story.json'), story);
    run.caption = rankingCaption(story);
    await writeFile(path.join(run.folder, 'caption.txt'), run.caption, 'utf8');

    run.step = 'Đang tìm footage từ các nguồn stock';
    run.progress = 0.6;
    await saveJob(run);
    const search = await findFootage(story.backgroundQueries);
    run.candidates = search.candidates;
    run.footageWarnings = search.warnings;
    run.footageSummary = search.summary;
    await saveJson(path.join(run.folder, 'footage-candidates.json'),
      search.candidates.map(candidate => ({...candidate, downloadUrl: '[chỉ lưu trong bộ nhớ server]',
        fallbackDownloadUrl: '[chỉ lưu trong bộ nhớ server]', previewUrl: '[chỉ lưu trong bộ nhớ server]'})));
    run.status = 'footage_review';
    run.step = `Chờ chọn footage · ${run.candidates.length} clip gợi ý`;
    run.progress = 0.64;
  } catch (error) {
    run.status = 'error';
    run.error = error.message;
    run.step = 'Không thể chuẩn bị footage';
  }
  await saveJob(run);
}

async function renderRun(run) {
  run.status = run.retrySpec ? 'rendering' : 'downloading';
  run.step = run.retrySpec ? 'Đang dựng lại video từ tài nguyên đã lưu' : run.template === 'quote' ? 'Đang chuẩn bị ảnh Quote' : 'Đang tải footage đã chọn';
  run.progress = 0.66;
  run.error = null;
  await saveJob(run);
  let progressWrite = Promise.resolve();
  try {
    const story = run.story || run.retrySpec;
    let spec = run.retrySpec;
    if (!spec) {
    if (run.template === 'quote') {
      const image = run.selectedCandidates?.[0];
      if (!image) throw new Error('Hãy chọn một ảnh Quote.');
      const backgroundImage = await copyQuoteImage(image.id, run.id);
      spec = {type: 'quote', width: 1080, height: 1920, fps: 30, duration: run.duration,
        mode: run.mode, title: story.title, quoteText: story.quoteText, hookText: story.hookText,
        backgroundImage, musicPath: story.musicPath || null};
      await saveJson(path.join(run.folder, 'media-sources.json'), [{id: image.id, path: backgroundImage}]);
    } else {
      const music = await chooseMusic();
      const clips = await downloadSlots.use(() => downloadFootage(run.selectedCandidates, run.id));
      const detectedCountries = run.facts.top10.filter(item => item.countryCode).length;
      spec = {
        type: 'ranking', width: 1080, height: 1920, fps: 30, duration: 30,
        title: story.title,
        subtitle: story.subtitle,
        entityType: detectedCountries >= 7 ? 'country' : story.entityType,
        rows: run.facts.top10.map(({rank, entity, displayValue, countryCode}) =>
          ({rank, entity, displayValue, countryCode})),
        backgroundClips: clips.map(clip => clip.path),
        musicPath: music?.path || null,
        sourceText: `${run.facts.top10[0].sourceTitle} · ${run.facts.metricPeriod}`,
      };
      await saveJson(path.join(run.folder, 'media-sources.json'), clips);
    }
    await saveJson(path.join(run.folder, 'video-spec.json'), spec);
    }
    run.status = 'rendering';
    run.step = 'Chờ lượt render';
    await saveJob(run);
    let lastSavedProgress = 0;
    let progressError = null;
    const {cancelSignal, cancel} = makeCancelSignal();
    run.cancelRender = cancel;
    if (runs.get(run.parentId)?.pauseRequested) {
      run.renderCancelRequested = true;
      cancel();
    }
    let file;
    try {
      file = await renderSlots.use(async () => {
        if (run.renderCancelRequested) throw new Error('renderMedia() got cancelled');
        run.step = 'Remotion đang dựng video';
        await saveJob(run);
        return renderVideo(spec, run.id, progress => {
          run.progress = 0.72 + progress * 0.28;
          run.step = `Remotion đang dựng video · ${Math.round(progress * 100)}%`;
          if (progress - lastSavedProgress >= 0.1) {
            lastSavedProgress = progress;
            progressWrite = progressWrite.then(() => saveJob(run)).catch(error => { progressError ||= error; });
          }
        }, {cancelSignal});
      });
    } finally { run.cancelRender = null; }
    await progressWrite;
    if (progressError) throw progressError;
    run.outputName = path.basename(file);
    await saveVideo({outputName: run.outputName, runId: run.id,
      title: story.title || run.idea?.title, caption: withoutSourceAppendix(run.caption), template: run.template});
    if (run.superItemId) {
      const targets = autoPostTargets(run.autoSettings, story.title || run.idea?.title, run.caption);
      const scheduled = await scheduleSuperItem(run.superItemId, run.outputName, targets);
      run.step = scheduled ? `Đã lên lịch đăng ${new Date(run.scheduledAt).toLocaleString('vi-VN')}`
        : 'Video đã render · chiến dịch đã dừng';
    } else if (run.autoSettings && !run.skipAutoPublish) {
      run.status = 'publishing';
      run.step = 'Đang tự động đăng video';
      run.progress = 0.99;
      await saveJob(run);
      const post = {id: postId(), outputName: run.outputName, source: 'auto',
        createdAt: new Date().toISOString(), results: {}};
      const targets = autoPostTargets(run.autoSettings, story.title || run.idea?.title, run.caption);
      for (const key of Object.keys(targets)) post.results[key] = {state: 'queued', progress: 0};
      run.post = post;
      posts.set(post.id, post);
      await savePost(post);
      await publishPost(post, file, targets);
      run.step = Object.values(post.results).some(result => result.state === 'failed')
        ? 'Video xong · một số nền tảng đăng lỗi' : 'Video đã gửi tới các nền tảng';
    } else {
      run.step = 'Video đã sẵn sàng';
    }
    run.status = 'done';
    run.progress = 1;
  } catch (error) {
    if (run.renderCancelRequested && String(error.message).includes('renderMedia() got cancelled')) {
      await progressWrite.catch(() => {});
      run.retrySpec = await readFile(path.join(run.folder, 'video-spec.json'), 'utf8').then(JSON.parse);
      run.status = 'render_queued';
      run.step = 'Đã tạm dừng · sẽ dựng lại video khi tiếp tục';
      run.progress = 0.7;
      run.renderCancelRequested = false;
      pendingJobs.push(run.id);
      await saveJob(run);
      return;
    }
    run.status = run.status === 'downloading' && !run.autoSettings ? 'footage_review' : 'error';
    run.error = error.message;
    run.step = run.status === 'footage_review' ? (run.template === 'quote' ? 'Ảnh không còn trong kho · chọn lại ảnh' : 'Tải clip lỗi · chọn lại footage') : 'Không thể hoàn tất';
  }
  await saveJob(run);
}

function queueSnapshot(parent) {
  const items = (parent.jobIds || []).map(id => runs.get(id)).filter(Boolean);
  const completed = items.filter(item => item.status === 'done').length;
  const failed = items.filter(item => item.status === 'error').length;
  const progress = items.length ? items.reduce((sum, item) => sum + (item.progress || 0), 0) / items.length : 0;
  return {
    id: parent.id,
    status: queueStatus(parent, items, activeJobs),
    total: items.length,
    canPause: true,
    completed,
    failed,
    progress,
    items: items.map(publicQueueItem),
  };
}

function refreshParent(parent) {
  const snapshot = queueSnapshot(parent);
  parent.progress = snapshot.progress;
  parent.status = snapshot.status;
  parent.step = snapshot.status === 'processing'
    ? `Hàng chờ: ${snapshot.completed + snapshot.failed}/${snapshot.total} video đã xử lý`
    : snapshot.status === 'pausing' ? 'Đang chờ video hiện tại hoàn tất để tạm dừng'
      : snapshot.status === 'paused' ? 'Đã tạm dừng hàng chờ'
        : `Hoàn tất ${snapshot.completed}/${snapshot.total} video`;
}

async function processQueuedJob(job) {
  const parent = runs.get(job.parentId);
  try {
    if (job.status === 'render_queued') await renderRun(job);
    else if (job.status === 'resume_prepared') {
      if (job.template === 'quote') {
        job.requiredClips = 1;
        job.candidates = await listQuoteImages();
        job.preselectedIds = [pickQuoteImage(job.candidates)?.id].filter(Boolean);
        job.footageWarnings = [];
      } else {
        const search = await findFootage(job.story.backgroundQueries);
        job.candidates = search.candidates;
        job.footageWarnings = search.warnings;
        job.footageSummary = search.summary;
      }
      job.status = 'footage_review';
      job.step = job.template === 'quote' ? 'Chờ chọn ảnh Quote' : `Chờ chọn footage · ${job.candidates.length} clip gợi ý`;
      job.progress = 0.64;
      await saveJob(job);
    }
    else if (job.template === 'quote') await prepareQuoteRun(job);
    else {
      await researchIdea(job, 0);
      if (job.status === 'review') await prepareRun(job);
    }
    if (job.autoSettings && job.status === 'footage_review') {
      const minimum = job.template === 'quote' ? job.requiredClips : 8;
      const selected = job.template === 'quote'
        ? [job.candidates.find(candidate => candidate.id === job.preselectedIds?.[0])].filter(Boolean)
        : selectAutoFootage(job.candidates || [], job.template, job.requiredClips);
      if (selected.length < minimum) {
        job.status = 'error';
        job.error = job.template === 'quote' ? 'Kho ảnh Quote đang trống. Hãy upload ảnh rồi chạy lại.'
          : `Chỉ tìm được ${selected.length}/${minimum} clip phù hợp. ` +
            `${job.footageSummary ? `Nguồn: ${job.footageSummary}. ` : ''}Hãy chạy thủ công để bổ sung footage.`;
        job.step = job.template === 'quote' ? 'Kho ảnh Quote đang trống' : 'Không đủ footage để chạy tự động';
      } else {
        job.selectedCandidates = selected;
        await saveJson(path.join(job.folder, 'footage-selection.json'),
          job.template === 'quote' ? selected : selected.map(candidate => publicCandidate(candidate, job.id)));
        await renderRun(job);
      }
    }
  } catch (error) {
    job.status = 'error';
    job.error ||= error.message;
    job.step = 'Không thể hoàn tất video';
  } finally {
    activeJobs.delete(job.id);
    await saveJob(job);
    if (job.superItemId && job.status === 'error') await failSuperItem(job.superItemId, job.error || 'Không thể tạo video.');
    if (parent) {
      refreshParent(parent);
      await saveJob(parent);
    }
  }
}

async function drainQueue() {
  if (queueWorkerActive) return;
  queueWorkerActive = true;
  try {
    const workers = Array.from({length: concurrency.jobs}, async () => {
      while (pendingJobs.length) {
        const next = nextRunnableJobIndex(pendingJobs, runs);
        if (next === -1) break;
        const [id] = pendingJobs.splice(next, 1);
        const job = runs.get(id);
        if (!job || !['queued', 'render_queued', 'resume_prepared'].includes(job.status)) continue;
        activeJobs.add(id);
        await processQueuedJob(job);
      }
    });
    await Promise.all(workers);
  } finally {
    queueWorkerActive = false;
    if (nextRunnableJobIndex(pendingJobs, runs) !== -1) void drainQueue();
  }
}

async function setQueuePaused(parent, paused) {
  if (!parent.jobIds?.length) throw new Error('Phiên này chưa có hàng chờ.');
  if (['done', 'done_with_errors'].includes(queueSnapshot(parent).status)) {
    throw new Error('Hàng chờ đã hoàn tất.');
  }
  parent.pauseRequested = paused;
  if (paused) for (const id of parent.jobIds) {
    const job = runs.get(id);
    if (job?.cancelRender) {
      job.renderCancelRequested = true;
      job.cancelRender();
    }
  }
  refreshParent(parent);
  await saveJob(parent);
  if (!paused) void drainQueue();
  return queueSnapshot(parent);
}

async function createQueue(parent, selections, autoInput = null, schedule = null) {
  if (parent.jobIds?.length) throw new Error('Phiên này đã có hàng chờ. Hãy tạo phiên mới để chọn bộ video khác.');
  if (!Array.isArray(selections)) throw new Error('Danh sách ý tưởng không hợp lệ.');
  const unique = [...new Set(selections.map(Number))];
  if (!unique.length || unique.length > parent.ideas.length ||
      unique.some(index => !Number.isInteger(index) || index < 0 || index >= parent.ideas.length)) {
    throw new Error('Hãy chọn từ 1 đến tất cả ý tưởng đang hiển thị.');
  }
  const autoSettings = schedule ? autoInput :
    autoInput ? await validateAutoSettings(autoInput, await postConfig(), tiktokCreator) : null;
  parent.jobIds = [];
  for (const [position, selection] of unique.entries()) {
    const id = `${parent.id}-q${String(position + 1).padStart(2, '0')}`;
    const folder = runDir(id);
    await mkdir(folder, {recursive: true});
    const idea = parent.ideas[selection];
    const job = {id, parentId: parent.id, prompt: parent.prompt, template: parent.template || 'ranking',
      mode: parent.mode || null, folder, ideas: [idea], idea,
      autoSettings,
      superItemId: schedule?.itemId || null,
      scheduledAt: schedule?.scheduledAt || null,
      status: 'queued', step: `Chờ tới lượt ${position + 1}`, progress: 0.02, error: null};
    runs.set(id, job);
    parent.jobIds.push(id);
    await saveJob(job);
    pendingJobs.push(id);
  }
  await saveJson(path.join(parent.folder, 'queue.json'), unique.map(selection => parent.ideas[selection]));
  refreshParent(parent);
  await saveJob(parent);
  void drainQueue();
  return queueSnapshot(parent);
}

async function startSuperCycle(campaign) {
  const scheduledAt = nextPostAt(campaign.nextAt, campaign.lastStartedAt, campaign.intervalMinutes);
  const item = await createSuperItem(randomUUID(), campaign.id, scheduledAt);
  try {
    const recent = await recentSuperTopics(campaign.id);
    const topic = await discoverSuperTopic({template: campaign.template, focus: campaign.focus, recent});
    if (!(await activeSuperCampaigns()).some(active => active.id === campaign.id)) {
      await updateSuperItem(item.id, {status: 'canceled', topic}); return;
    }
    await updateSuperItem(item.id, {topic, status: 'producing'});
    const parent = await createIdeas(topic, campaign.template, campaign.mode);
    if (!(await activeSuperCampaigns()).some(active => active.id === campaign.id)) {
      await updateSuperItem(item.id, {status: 'canceled'}); return;
    }
    const idea = parent.ideas[0];
    if (!idea) throw new Error('Không có ý tưởng phù hợp cho chủ đề mới.');
    const queue = await createQueue(parent, [0], campaign.autoSettings,
      {itemId: item.id, scheduledAt});
    await updateSuperItem(item.id, {jobId: queue.items[0].id});
  } catch (error) {
    await failSuperItem(item.id, error.message);
  }
}

async function retrySuperItem(campaign, item) {
  try {
    if (item.outputName && item.targets) {
      await stat(path.join(outputDir, item.outputName));
      await updateSuperItem(item.id, {status: 'scheduled', error: null});
      void tickSuperAuto();
      return;
    }
    await updateSuperItem(item.id, {outputName: null, targets: null, postId: null});
    let topic = item.topic;
    if (!topic) {
      const recent = await recentSuperTopics(campaign.id);
      topic = await discoverSuperTopic({template: campaign.template, focus: campaign.focus, recent});
      await updateSuperItem(item.id, {topic});
    }
    const parent = await createIdeas(topic, campaign.template, campaign.mode);
    if (!(await activeSuperCampaigns()).some(active => active.id === campaign.id)) {
      await updateSuperItem(item.id, {status: 'canceled'});
      return;
    }
    const idea = parent.ideas[0];
    if (!idea) throw new Error('Không có ý tưởng phù hợp khi Retry video.');
    const queue = await createQueue(parent, [0], campaign.autoSettings,
      {itemId: item.id, scheduledAt: item.scheduledAt});
    await updateSuperItem(item.id, {jobId: queue.items[0].id});
  } catch (error) {
    await failSuperItem(item.id, error.message);
  }
}

async function recoverInterruptedSuperAuto() {
  const pending = await interruptedSuperRetries();
  for (const candidate of pending) {
    try {
      const retry = await claimSuperItemRetry(candidate.campaignId, candidate.itemId);
      await retrySuperItem(retry.campaign, retry.item);
    } catch (error) {
      console.error('Khôi phục Super Auto:', error.message);
    }
  }
}

async function publishDueSuperItem(item) {
  const file = path.join(outputDir, item.outputName);
  const post = {id: postId(), outputName: item.outputName, source: 'auto',
    createdAt: new Date().toISOString(), results: {}};
  for (const key of Object.keys(item.targets || {})) post.results[key] = {state: 'queued', progress: 0};
  let postSaved = false;
  try {
    await stat(file);
    await savePost(post);
    postSaved = true;
    posts.set(post.id, post);
    await updateSuperItem(item.id, {postId: post.id});
    await publishPost(post, file, item.targets);
    const failed = Object.values(post.results).every(result => result.state === 'failed');
    await finishSuperItem(item.id, post.id, failed);
  } catch (error) {
    const message = `Không thể xác nhận lượt đăng: ${error.message}`;
    if (postSaved) await flagSuperAttention(item.id, `${message}. Kiểm tra nền tảng trước khi tiếp tục.`);
    else await failSuperItem(item.id, message);
  }
}

async function tickSuperAuto() {
  if (superWorkerActive) return;
  superWorkerActive = true;
  try {
    let due;
    while ((due = await claimDueSuperItem())) await publishDueSuperItem(due);
    const campaigns = await activeSuperCampaigns();
    for (const campaign of campaigns) {
      if (new Date(campaign.readyAfter).getTime() > Date.now() || await openSuperItem(campaign)) continue;
      const retry = await claimNextSuperRetry(campaign.id);
      if (retry) { await retrySuperItem(campaign, retry); continue; }
      await startSuperCycle(campaign);
    }
    if (Date.now() - superLastStatusRefresh > 60_000) {
      superLastStatusRefresh = Date.now();
      const recent = await listSuperCampaigns(3);
      for (const item of recent.flatMap(campaign => campaign.items).filter(item => item.postId &&
        Object.values(item.postResults || {}).some(result => ['processing', 'verifying'].includes(result.state))).slice(0, 3)) {
        try {
          const post = await loadPost(item.postId);
          if (post) { await refreshPost(post); posts.set(post.id, post); }
        } catch (error) { console.error(`Cập nhật bài ${item.postId}:`, error.message); }
      }
    }
  } catch (error) { console.error('Super Auto:', error.message); }
  finally { superWorkerActive = false; }
}

async function uploadClip(run, req) {
  if (run.status !== 'footage_review') throw new Error('Chỉ thêm clip tại bước chọn footage.');
  if (!String(req.headers['content-type'] || '').startsWith('video/mp4')) throw new Error('Hãy chọn file MP4.');
  const sizeLimit = 100_000_000;
  const uploadDir = path.join(run.folder, 'uploads');
  await mkdir(uploadDir, {recursive: true});
  const id = `local:${Date.now()}-${(run.candidates || []).length}`;
  const file = path.join(uploadDir, `${id.slice(6)}.mp4`);
  let size = 0;
  try {
    await pipeline(req, new Transform({transform(chunk, encoding, callback) {
      size += chunk.length;
      callback(size > sizeLimit ? new Error('Clip local tối đa 100 MB.') : null, chunk);
    }}), createWriteStream(file));
    const handle = await open(file, 'r');
    const header = Buffer.alloc(12);
    try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
    if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('File tải lên không phải MP4 hợp lệ.');
  } catch (error) {
    await unlink(file).catch(() => {});
    throw error;
  }
  const name = decodeURIComponent(String(req.headers['x-file-name'] || 'Clip local')).slice(0, 120);
  const candidate = {id, provider: 'Local', sourceUrl: '', creator: '', description: name,
    thumbnail: '', previewUrl: '', downloadUrl: '', localPath: file,
    width: 0, height: 0, duration: 0, query: '', subject: name, score: 0};
  run.candidates.push(candidate);
  return publicCandidate(candidate, run.id);
}

async function recoverableRuns() {
  const folders = await readdir(path.join(root, '.tmp'), {withFileTypes: true});
  const ids = folders.filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T.*-q\d+$/.test(entry.name))
    .map(entry => entry.name).sort().reverse().slice(0, 50);
  const found = [];
  for (const id of ids) {
    try {
      try { await stat(path.join(runDir(id), 'video-spec.json')); continue; } catch { /* Not rendered. */ }
      try {
        const quote = JSON.parse(await readFile(path.join(runDir(id), 'quote-spec.json'), 'utf8'));
        found.push({id, title: quote.title, template: 'quote'});
        continue;
      } catch { /* Try legacy Ranking run. */ }
      await Promise.all(['story.json', 'fact-bundle.json'].map(name => stat(path.join(runDir(id), name))));
      const story = JSON.parse(await readFile(path.join(runDir(id), 'story.json'), 'utf8'));
      found.push({id, title: story.title, template: 'ranking'});
    } catch { /* Incomplete run. */ }
  }
  return found.slice(0, 5);
}

async function recoverRun(id, superRecovery = null) {
  if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z-q\d+$/.test(id)) throw new Error('Mã phiên không hợp lệ.');
  if (runs.has(id)) {
    const current = getRun(id);
    const parent = getRun(current.parentId);
    if (!superRecovery) return queueSnapshot(parent);
    if (!current.story || !Array.isArray(current.candidates)) {
      throw new Error('Job chưa có dữ liệu footage để chỉnh sửa thủ công.');
    }
    Object.assign(current, {
      autoSettings: superRecovery.campaign.autoSettings,
      superItemId: superRecovery.item.id,
      scheduledAt: superRecovery.item.scheduledAt,
      manualSuperReview: true,
      status: 'footage_review',
      step: `Chờ bổ sung footage · ${current.candidates.length} clip hiện có`,
      progress: 0.64,
      error: null,
    });
    await saveJob(current);
    refreshParent(parent);
    await saveJob(parent);
    return queueSnapshot(parent);
  }
  const folder = runDir(id);
  const quote = await readFile(path.join(folder, 'quote-spec.json'), 'utf8')
    .then(JSON.parse).catch(() => null);
  const story = quote || JSON.parse(await readFile(path.join(folder, 'story.json'), 'utf8'));
  const facts = quote ? null : JSON.parse(await readFile(path.join(folder, 'fact-bundle.json'), 'utf8'));
  const parentId = id.replace(/-q\d+$/, '');
  const selection = Number(id.match(/-q(\d+)$/)[1]) - 1;
  const ideas = JSON.parse(await readFile(path.join(runDir(parentId), 'queue.json'), 'utf8'));
  const idea = ideas[selection] || {title: story.title};
  const parent = {id: `recover-${id}`, prompt: '', jobIds: [id], status: 'processing'};
  const recoveredIdea = quote || idea;
  const run = {id, parentId: parent.id, folder, template: quote ? 'quote' : 'ranking',
    mode: quote?.mode || null, duration: quote?.duration || 30, requiredClips: quote ? 1 : 8,
    ideas: [recoveredIdea], idea: recoveredIdea, facts, story,
    caption: withoutSourceAppendix(await readFile(path.join(folder, 'caption.txt'), 'utf8').catch(() => '')),
    autoSettings: superRecovery?.campaign.autoSettings || null,
    superItemId: superRecovery?.item.id || null,
    scheduledAt: superRecovery?.item.scheduledAt || null,
    manualSuperReview: Boolean(superRecovery),
    status: 'preparing', step: 'Đang tìm lại footage', progress: 0.6};
  runs.set(parent.id, parent);
  runs.set(id, run);
  let search;
  try { search = quote ? {candidates: await listQuoteImages(), warnings: []}
    : await findFootage(story.backgroundQueries); }
  catch (error) {
    runs.delete(parent.id);
    runs.delete(id);
    throw error;
  }
  run.candidates = search.candidates;
  run.footageWarnings = search.warnings;
  run.footageSummary = search.summary;
  run.preselectedIds = quote ? [pickQuoteImage(search.candidates)?.id].filter(Boolean) : [];
  run.status = 'footage_review';
  run.step = `Chờ chọn footage · ${run.candidates.length} clip gợi ý`;
  run.progress = 0.64;
  await saveJob(run);
  refreshParent(parent);
  return queueSnapshot(parent);
}

async function retrySession(id) {
  if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(id)) throw new Error('Mã phiên không hợp lệ.');
  if (retryingSessions.has(id)) throw new Error('Phiên này đang được khôi phục.');
  retryingSessions.add(id);
  try {
    if (runs.has(id)) {
      const current = getRun(id);
      if (current.jobIds?.length) return {queue: queueSnapshot(current)};
      if (current.ideas?.length) return {runId: id, ideas: current.ideas, template: current.template, mode: current.mode};
    }
    const {parent: record, children} = await loadSessionForRetry(id);
    if (!record || (record.status !== 'interrupted' && !children.some(child => child.status === 'interrupted'))) {
      throw new Error('Phiên này không ở trạng thái gián đoạn.');
    }
    const folder = runDir(id);
    const ideas = await readFile(path.join(folder, 'ideas.json'), 'utf8').then(JSON.parse)
      .catch(() => null);
    if (!Array.isArray(ideas) || !ideas.length) {
      throw new Error('Không còn dữ liệu ý tưởng của phiên để tiếp tục.');
    }
    const parent = {id, folder, prompt: record.title.replace(/^Phiên:\s*/u, ''),
      template: record.template, mode: record.mode, ideas, status: 'ideas',
      step: 'Chọn video để tiếp tục', progress: 0.18, jobIds: []};
    if (!children.length) {
      runs.set(id, parent);
      await saveJob(parent);
      return {runId: id, ideas, template: parent.template, mode: parent.mode};
    }
    const queuedIdeas = await readFile(path.join(folder, 'queue.json'), 'utf8').then(JSON.parse)
      .catch(() => null);
    if (!Array.isArray(queuedIdeas) || queuedIdeas.length < children.length) {
      throw new Error('Không còn danh sách video đã chọn của phiên để tiếp tục.');
    }
    const restored = [];
    const superJobs = await superItemsForJobs(children.map(child => child.run_id));
    const warning = superJobs.size
      ? 'Video của Super Auto cũ sẽ tiếp tục sản xuất; hãy kiểm tra và đăng từ Thư viện để giữ đúng lịch chiến dịch.'
      : children.some(child => child.auto_mode && !child.auto_settings)
        ? 'Phiên Auto cũ chưa lưu cấu hình đăng. Retry tiếp tục tạo video; bạn cần kiểm tra và đăng từ Thư viện.' : null;
    for (const child of children) {
      const position = Number(/-q(\d+)$/.exec(child.run_id)?.[1]) - 1;
      if (!Number.isInteger(position) || position < 0) throw new Error('Mã video trong phiên không hợp lệ.');
      const idea = queuedIdeas[position];
      if (!idea) throw new Error('Thiếu ý tưởng đã chọn của video.');
      const childFolder = runDir(child.run_id);
      const quote = await readFile(path.join(childFolder, 'quote-spec.json'), 'utf8').then(JSON.parse).catch(() => null);
      const story = quote || await readFile(path.join(childFolder, 'story.json'), 'utf8').then(JSON.parse).catch(() => null);
      const facts = await readFile(path.join(childFolder, 'fact-bundle.json'), 'utf8').then(JSON.parse).catch(() => null);
      const spec = await readFile(path.join(childFolder, 'video-spec.json'), 'utf8').then(JSON.parse).catch(() => null);
      const outputName = child.output_name || await videoForRun(child.run_id);
      const run = {id: child.run_id, parentId: id, folder: childFolder, prompt: parent.prompt,
        template: child.template, mode: child.mode, ideas: [idea], idea, story, facts,
        caption: await readFile(path.join(childFolder, 'caption.txt'), 'utf8').catch(() => ''),
        duration: quote?.duration || 30, requiredClips: quote ? 1 : 8,
        autoSettings: child.auto_settings || null, outputName,
        skipAutoPublish: superJobs.has(child.run_id),
        progress: child.progress || 0, error: null};
      if (child.status === 'error') {
        run.status = 'error'; run.error = child.error;
        run.step = child.step || 'Video gặp lỗi trước khi phiên bị gián đoạn';
      } else if (outputName || child.status === 'done') {
        run.status = 'done'; run.progress = 1;
        run.step = outputName ? 'Video đã hoàn tất · kiểm tra trạng thái đăng trong Thư viện' : 'Video đã hoàn tất';
      } else if (spec && (spec.backgroundImage || (Array.isArray(spec.backgroundClips) && spec.backgroundClips.length)) &&
        (await Promise.all([...(spec.backgroundImage ? [spec.backgroundImage] : []), ...(spec.backgroundClips || [])].map(async clip => {
          if (typeof clip !== 'string') return false;
          const file = path.resolve(publicDir, clip);
          if (!file.startsWith(publicDir + path.sep)) return false;
          return stat(file).then(info => info.isFile() && info.size > 0).catch(() => false);
        }))).every(Boolean)) {
        run.retrySpec = spec;
        run.status = 'render_queued'; run.step = 'Chờ dựng lại từ clip đã lưu';
        run.progress = 0.7;
      } else if (story && (quote || facts)) {
        run.status = 'resume_prepared'; run.step = 'Chờ tìm lại footage'; run.progress = 0.6;
      } else {
        run.status = 'queued'; run.step = 'Chờ tiếp tục sản xuất'; run.progress = 0.02;
      }
      restored.push(run);
    }
    runs.set(id, parent);
    for (const run of restored) {
      runs.set(run.id, run);
      parent.jobIds.push(run.id);
      await saveJob(run);
      if (['queued', 'render_queued', 'resume_prepared'].includes(run.status)) pendingJobs.push(run.id);
    }
    refreshParent(parent);
    await saveJob(parent);
    void drainQueue();
    return {queue: queueSnapshot(parent), warning};
  } finally { retryingSessions.delete(id); }
}

async function sendFile(res, file, contentType, rangeHeader) {
  const info = await stat(file);
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start <= end && start < info.size) {
        res.writeHead(206, {'Content-Type': contentType, 'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1});
        createReadStream(file, {start, end}).pipe(res);
        return;
      }
    }
  }
  res.writeHead(200, {'Content-Type': contentType, 'Content-Length': info.size, 'Accept-Ranges': 'bytes'});
  createReadStream(file).pipe(res);
}

async function thumbnailFor(outputName) {
  const video = path.join(outputDir, outputName);
  const videoInfo = await stat(video);
  const key = createHash('sha256').update(`${outputName}:${videoInfo.size}:${videoInfo.mtimeMs}`).digest('hex').slice(0, 24);
  const thumbnail = path.join(thumbnailDir, `${key}.jpg`);
  try { await stat(thumbnail); return thumbnail; } catch { /* Generate on first request. */ }
  if (!thumbnailJobs.has(key)) {
    const job = thumbnailQueue.then(async () => {
      await mkdir(thumbnailDir, {recursive: true});
      const temporary = path.join(thumbnailDir, `${key}-${randomUUID()}.jpg`);
      try {
        await execFileAsync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', '2',
          '-i', video, '-frames:v', '1', '-vf', 'scale=240:-2', '-q:v', '4', '-y', temporary],
        {timeout: 20_000});
        await rename(temporary, thumbnail);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return thumbnail;
    });
    thumbnailJobs.set(key, job);
    thumbnailQueue = job.catch(() => {});
    job.finally(() => thumbnailJobs.delete(key)).catch(() => {});
  }
  return thumbnailJobs.get(key);
}

function localDeletionRequest(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).origin === `http://${req.headers.host}`; }
  catch { return false; }
}

async function removeRunArtifacts(ids) {
  const tempRoot = path.resolve(root, '.tmp');
  const mediaRoot = path.resolve(publicDir, 'runs');
  const failures = [];
  for (const id of ids) {
    if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-q\d+)?$/.test(id)) {
      failures.push(`${id}: Mã phiên không hợp lệ.`);
      continue;
    }
    for (const [base, target] of [[tempRoot, path.resolve(tempRoot, id)],
      [mediaRoot, path.resolve(mediaRoot, id)]]) {
      if (path.dirname(target) !== base) {
        failures.push(`${id}: Đường dẫn dữ liệu phiên không hợp lệ.`);
        continue;
      }
      try { await rm(target, {recursive: true, force: true}); }
      catch (error) { failures.push(`${id}: ${error.message}`); }
    }
  }
  return failures;
}

async function removeVideo(outputName) {
  const source = path.resolve(outputDir, outputName);
  if (path.dirname(source) !== path.resolve(outputDir)) throw new Error('Đường dẫn video không hợp lệ.');
  let staged = null;
  let thumbnail = null;
  try {
    const info = await stat(source);
    const key = createHash('sha256').update(`${outputName}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 24);
    thumbnail = path.join(thumbnailDir, `${key}.jpg`);
    const stagingRoot = path.resolve(root, '.tmp', 'delete-staging');
    await mkdir(stagingRoot, {recursive: true});
    staged = path.resolve(stagingRoot, `${randomUUID()}.mp4`);
    if (path.dirname(staged) !== stagingRoot) throw new Error('Đường dẫn xóa video không hợp lệ.');
    await rename(source, staged);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let record;
  try { record = await deleteVideoRecord(outputName); }
  catch (error) {
    if (staged) {
      try { await rename(staged, source); }
      catch (restoreError) {
        throw new Error(`${error.message} Không thể khôi phục MP4; file tạm ở ${staged}: ${restoreError.message}`);
      }
    }
    throw error;
  }
  const cleanup = [];
  if (staged) {
    try { await unlink(staged); }
    catch (error) { cleanup.push(`File tạm ${staged}: ${error.message}`); }
  }
  if (thumbnail) await unlink(thumbnail).catch(error => { if (error.code !== 'ENOENT') console.error('Thumbnail:', error); });
  for (const post of posts.values()) if (post.outputName === outputName) posts.delete(post.id);
  const run = record.runId && runs.get(record.runId);
  if (run) { run.outputName = null; run.post = null; run.step = 'Video đã xóa khỏi Thư viện'; }
  if (record.removeArtifacts) {
    cleanup.push(...await removeRunArtifacts([record.runId]));
  }
  return {cleanup};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self' blob:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'");

    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [name, type] = staticFiles.get(url.pathname);
      await sendFile(res, path.join(webDir, name), type);
      return;
    }
    if (req.method === 'GET' && /^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname)) {
      await sendFile(res, path.join(webDir, url.pathname), 'font/woff2');
      return;
    }
    if (req.method === 'GET' && /^\/flags\/[a-z]{2}\.svg$/.test(url.pathname)) {
      const code = path.basename(url.pathname, '.svg');
      await sendFile(res, path.join(root, 'node_modules', 'flag-icons', 'flags', '4x3', `${code}.svg`), 'image/svg+xml');
      return;
    }
    if (req.method === 'GET' && /^\/quote-images\/[a-f0-9-]+\.(jpg|png|webp)$/.test(url.pathname)) {
      const name = path.basename(url.pathname);
      const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      await sendFile(res, path.join(publicDir, 'quote-images', name), type);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/music/')) {
      const name = decodeURIComponent(url.pathname.slice('/music/'.length));
      const track = (await listMusicTracks()).find(item => item.name === name);
      if (!track) { json(res, 404, {error: 'Không tìm thấy bài nhạc.'}); return; }
      const type = name.toLowerCase().endsWith('.wav') ? 'audio/wav'
        : name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg';
      await sendFile(res, path.join(publicDir, name), type, req.headers.range);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/music') {
      json(res, 200, {tracks: await listMusicTracks()});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/music') {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ thêm nhạc từ giao diện local.'}); return; }
      const name = req.headers['x-file-name'];
      if (typeof name !== 'string' || name.length > 300) throw new Error('Tên file nhạc không hợp lệ.');
      json(res, 201, {track: await uploadMusic(req, decodeURIComponent(name))});
      return;
    }
    const musicMatch = /^\/api\/music\/(.+)$/.exec(url.pathname);
    if (musicMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ sửa kho nhạc từ giao diện local.'}); return; }
      const name = decodeURIComponent(musicMatch[1]);
      if (req.method === 'DELETE') {
        await deleteMusic(name);
        json(res, 200, {deleted: name});
      } else {
        const {weight} = await body(req);
        json(res, 200, {track: await setMusicWeight(name, weight)});
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/quote-images') {
      json(res, 200, {images: await listQuoteImages()});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/quote-images') {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ upload ảnh từ giao diện local.'}); return; }
      const image = await uploadQuoteImage(req);
      for (const run of runs.values()) if (run.template === 'quote' && run.status === 'footage_review') {
        run.candidates ||= [];
        run.candidates.push(image);
        if (!run.preselectedIds?.length) run.preselectedIds = [image.id];
      }
      json(res, 201, {image});
      return;
    }
    const quoteImageDelete = /^\/api\/quote-images\/([a-f0-9-]+\.(?:jpg|png|webp))$/.exec(url.pathname);
    if (req.method === 'DELETE' && quoteImageDelete) {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ xóa ảnh từ giao diện local.'}); return; }
      await deleteQuoteImage(quoteImageDelete[1]);
      for (const run of runs.values()) if (run.template === 'quote' && run.status === 'footage_review') {
        run.candidates = (run.candidates || []).filter(image => image.id !== quoteImageDelete[1]);
        run.preselectedIds = (run.preselectedIds || []).filter(id => id !== quoteImageDelete[1]);
      }
      json(res, 200, {deleted: quoteImageDelete[1]});
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/output/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice('/output/'.length)));
      if (!name.endsWith('.mp4')) throw new Error('File video không hợp lệ.');
      await sendFile(res, path.join(outputDir, name), 'video/mp4', req.headers.range);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/thumbnails/') && url.pathname.endsWith('.jpg')) {
      const name = decodeURIComponent(url.pathname.slice('/thumbnails/'.length, -4));
      if (name !== path.basename(name) || !name.endsWith('.mp4')) throw new Error('File video không hợp lệ.');
      await sendFile(res, await thumbnailFor(name), 'image/jpeg');
      return;
    }
    if (url.pathname.startsWith('/api/flow/')) {
      if (await handleFlowRequest(req, res, url, {json, sendFile, body, localDeletionRequest,
        validateFlowAutoSettings: async input => validateAutoSettings(input, await postConfig(), tiktokCreator)})) return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      json(res, 200, {aiConfigured: aiConfig().configured, aiProvider: aiConfig().provider,
        providers: configuredProviders(), model: aiConfig().model,
        musicCount: (await listMusic()).length, concurrency});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/posts/config') {
      json(res, 200, await postConfig());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/posts/connect') {
      const origin = req.headers.origin;
      if (![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) {
        json(res, 403, {error: 'Yêu cầu kết nối phải đến từ giao diện local.'}); return;
      }
      const input = await body(req);
      const platform = String(input.platform || '');
      if (!['facebook', 'tiktok', 'youtube'].includes(platform)) throw new Error('Nền tảng kết nối không hợp lệ.');
      if (!zernioApiKey(platform)) throw new Error(`Chưa cấu hình API key Zernio cho ${platformNames[platform]}.`);
      const connected = (await zernioAccounts(platform)).find(account => account.active);
      if (connected) {
        json(res, 200, {alreadyConnected: true, account: connected}); return;
      }
      const nonce = randomUUID();
      const redirectUrl = new URL(`http://${host}:${port}/`);
      redirectUrl.searchParams.set('zernio_platform', platform);
      redirectUrl.searchParams.set('zernio_state', nonce);
      const connection = await zernioConnectUrl(platform, redirectUrl.toString());
      json(res, 200, {...connection, nonce});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/posts/tiktok/creator') {
      json(res, 200, {creator: await tiktokCreator(url.searchParams.get('accountId') || undefined)});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/posts') {
      const origin = req.headers.origin;
      if (origin && !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
        json(res, 403, {error: 'Yêu cầu đăng bài phải đến từ giao diện local.'}); return;
      }
      const input = await body(req);
      const outputName = String(input.outputName || '');
      if (!/^[a-zA-Z0-9._-]+\.mp4$/.test(outputName)) throw new Error('Tên file MP4 không hợp lệ.');
      const file = path.join(outputDir, outputName);
      const info = await stat(file);
      if (!info.isFile() || !info.size) throw new Error('Không tìm thấy MP4 hoàn chỉnh.');
      const targets = input.targets;
      if (!targets || typeof targets !== 'object' || Array.isArray(targets) ||
          !Object.keys(targets).length || Object.keys(targets).some(key => !publishers[key])) {
        throw new Error('Hãy chọn ít nhất một nền tảng hợp lệ.');
      }
      if (targets.tiktok && zernioApiKey() && input.consent !== true) {
        throw new Error('Cần xem trước nội dung và đồng ý đăng TikTok trước khi gửi.');
      }
      const config = await postConfig();
      const missing = Object.keys(targets).filter(key => !config.platforms[key].configured);
      if (missing.length) throw new Error(`Thiếu cấu hình: ${missing.map(key => platformNames[key]).join(', ')}.`);
      const existing = await activePostForOutput(outputName, Object.keys(targets));
      if (existing) throw new Error(`Video này đã có lượt đăng đang chờ hoặc đã xuất bản (${existing.id}). Kiểm tra trạng thái trước khi đăng lại.`);
      for (const [platform, options] of Object.entries(targets)) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error(`Tùy chọn ${platform} không hợp lệ.`);
        if (typeof options.caption === 'string') options.caption = withoutSourceAppendix(options.caption);
        if (typeof options.description === 'string') options.description = withoutSourceAppendix(options.description);
      }
      const post = {id: postId(), outputName, source: 'manual',
        createdAt: new Date().toISOString(), results: {}};
      for (const key of Object.keys(targets)) post.results[key] = {state: 'queued', progress: 0};
      await savePost(post);
      posts.set(post.id, post);
      void publishPost(post, file, targets).catch(error => console.error('Lưu trạng thái đăng:', error.message));
      json(res, 202, {post: postSnapshot(post)});
      return;
    }
    const postMatch = /^\/api\/posts\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && postMatch) {
      const post = posts.get(postMatch[1]) || await loadPost(postMatch[1]);
      if (!post) throw new Error('Không tìm thấy lượt đăng.');
      posts.set(post.id, post);
      if (url.searchParams.get('refresh') === '1') await refreshPost(post);
      json(res, 200, {post: postSnapshot(post)});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/recoverable') {
      json(res, 200, {runs: await recoverableRuns()});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/outputs') {
      json(res, 200, {outputs: await listVideos()});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      json(res, 200, {jobs: await listJobs()});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      json(res, 200, {sessions: await listSessions()});
      return;
    }
    const deleteSessionMatch = /^\/api\/sessions\/(\d{4}-\d{2}-\d{2}T[\d-]+Z)$/.exec(url.pathname);
    if (req.method === 'DELETE' && deleteSessionMatch) {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ có thể xóa từ giao diện local.'}); return; }
      const id = deleteSessionMatch[1];
      if (retryingSessions.has(id) || [...runs.values()].some(run =>
        (run.id === id || run.parentId === id) &&
        ['thinking', 'researching', 'preparing', 'downloading', 'rendering', 'publishing', 'queued',
          'render_queued', 'resume_prepared'].includes(run.status))) {
        throw new Error('Phiên đang xử lý. Hãy đợi hoàn tất trước khi xóa.');
      }
      const {ids} = await deleteSessionRecord(id);
      for (const runId of ids) runs.delete(runId);
      const cleanup = await removeRunArtifacts(ids);
      json(res, 200, {deleted: id, deletedRunIds: ids, cleanup, sessions: await listSessions()});
      return;
    }
    const deleteOutputMatch = /^\/api\/outputs\/([a-zA-Z0-9._-]+\.mp4)$/.exec(url.pathname);
    if (req.method === 'DELETE' && deleteOutputMatch) {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ có thể xóa từ giao diện local.'}); return; }
      const name = deleteOutputMatch[1];
      if ([...runs.values()].some(run => run.outputName === name &&
        ['publishing', 'rendering'].includes(run.status))) {
        throw new Error('Video đang xử lý hoặc đăng. Hãy đợi hoàn tất trước khi xóa.');
      }
      const result = await removeVideo(name);
      json(res, 200, {deleted: name, ...result, outputs: await listVideos()});
      return;
    }
    const retryMatch = /^\/api\/sessions\/([^/]+)\/retry$/.exec(url.pathname);
    if (req.method === 'POST' && retryMatch) {
      if (req.headers.origin && !['127.0.0.1', 'localhost'].includes(new URL(req.headers.origin).hostname)) {
        json(res, 403, {error: 'Retry chỉ nhận yêu cầu từ giao diện local.'}); return;
      }
      json(res, 202, await retrySession(retryMatch[1]));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/super-auto') {
      const campaigns = await listSuperCampaigns();
      json(res, 200, {campaigns: campaigns.map(publicCampaign)});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/super-auto') {
      if (req.headers.origin && !['127.0.0.1', 'localhost'].includes(new URL(req.headers.origin).hostname)) {
        json(res, 403, {error: 'Super Auto chỉ nhận yêu cầu từ giao diện local.'}); return;
      }
      if ((await activeSuperCampaigns()).length) throw new Error('Hãy dừng chiến dịch Super Auto đang chạy trước.');
      const input = await body(req);
      const plan = validateSuperPlan(input);
      const autoSettings = await validateAutoSettings(input.auto, await postConfig(), tiktokCreator);
      const campaign = await createSuperCampaign({...plan, id: randomUUID(), autoSettings});
      void tickSuperAuto();
      json(res, 201, {campaign: (({autoSettings, ...visible}) => visible)(campaign)});
      return;
    }
    const superAction = /^\/api\/super-auto\/([\w-]+)\/(stop|resume)$/.exec(url.pathname);
    if (req.method === 'POST' && superAction) {
      if (req.headers.origin && !['127.0.0.1', 'localhost'].includes(new URL(req.headers.origin).hostname)) {
        json(res, 403, {error: 'Super Auto chỉ nhận yêu cầu từ giao diện local.'}); return;
      }
      if (superAction[2] === 'stop') await stopSuperCampaign(superAction[1]);
      else { await resumeSuperCampaign(superAction[1]); void tickSuperAuto(); }
      json(res, 200, {campaigns: (await listSuperCampaigns()).map(publicCampaign)});
      return;
    }
    const superRetry = /^\/api\/super-auto\/([\w-]+)\/items\/([\w-]+)\/retry$/.exec(url.pathname);
    if (req.method === 'POST' && superRetry) {
      if (req.headers.origin && !['127.0.0.1', 'localhost'].includes(new URL(req.headers.origin).hostname)) {
        json(res, 403, {error: 'Retry Super Auto chỉ nhận yêu cầu từ giao diện local.'}); return;
      }
      const retry = await claimSuperItemRetry(superRetry[1], superRetry[2]);
      void retrySuperItem(retry.campaign, retry.item);
      json(res, 202, {campaigns: (await listSuperCampaigns()).map(publicCampaign)});
      return;
    }
    const superFootageRepair = /^\/api\/super-auto\/([\w-]+)\/items\/([\w-]+)\/footage$/.exec(url.pathname);
    if (req.method === 'POST' && superFootageRepair) {
      if (req.headers.origin && !['127.0.0.1', 'localhost'].includes(new URL(req.headers.origin).hostname)) {
        json(res, 403, {error: 'Chỉ có thể bổ sung footage từ giao diện local.'}); return;
      }
      const recovery = await claimSuperItemFootageRepair(superFootageRepair[1], superFootageRepair[2]);
      try {
        const queue = await recoverRun(recovery.item.jobId, recovery);
        json(res, 200, {queue});
      } catch (error) {
        await updateSuperItem(recovery.item.id, {
          status: recovery.originalStatus,
          error: recovery.originalError,
        });
        throw error;
      }
      return;
    }
    const superRetryFailed = /^\/api\/super-auto\/([\w-]+)\/retry-failed$/.exec(url.pathname);
    if (req.method === 'POST' && superRetryFailed) {
      const origin = req.headers.origin;
      if (origin && !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
        json(res, 403, {error: 'Retry Super Auto chỉ nhận yêu cầu từ giao diện local.'}); return;
      }
      const input = await body(req);
      const settings = input.auto ? await validateAutoSettings(input.auto, await postConfig(), tiktokCreator) : null;
      const queued = await queueFailedSuperRetries(superRetryFailed[1], settings);
      void tickSuperAuto();
      json(res, 202, {queued, campaigns: await listSuperCampaigns()});
      return;
    }
    const publicationMatch = /^\/api\/outputs\/([a-zA-Z0-9._-]+\.mp4)\/publication$/.exec(url.pathname);
    if (req.method === 'POST' && publicationMatch) {
      const origin = req.headers.origin;
      if (origin && !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
        json(res, 403, {error: 'Chỉ có thể cập nhật trạng thái từ giao diện local.'}); return;
      }
      const input = await body(req);
      await markPublication(publicationMatch[1], input.status);
      json(res, 200, {outputs: await listVideos()});
      return;
    }
    const recoverMatch = /^\/api\/recover\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'POST' && recoverMatch) {
      json(res, 200, {queue: await recoverRun(recoverMatch[1])});
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ideas') {
      const input = await body(req);
      const prompt = String(input.prompt || '').trim();
      if (prompt.length < 3 || prompt.length > 300) throw new Error('Chủ đề cần từ 3 đến 300 ký tự.');
      const template = input.template === 'quote' ? 'quote' : 'ranking';
      const mode = template === 'quote' ? String(input.mode || '') : null;
      if (template === 'quote' && !['onscreen', 'caption'].includes(mode)) throw new Error('Hãy chọn một chế độ Quote.');
      const run = await createIdeas(prompt, template, mode);
      json(res, 200, {runId: run.id, ideas: run.ideas, run: publicRun(run)});
      return;
    }
    const queueMatch = /^\/api\/runs\/([^/]+)\/queue$/.exec(url.pathname);
    if (req.method === 'POST' && queueMatch) {
      const parent = getRun(queueMatch[1]);
      const input = await body(req);
      if (input.auto && req.headers.origin && !['127.0.0.1', 'localhost'].includes(new URL(req.headers.origin).hostname)) {
        json(res, 403, {error: 'Auto mode chỉ nhận yêu cầu từ giao diện local.'}); return;
      }
      const queue = await createQueue(parent, input.selections, input.auto);
      json(res, 202, {queue});
      return;
    }
    if (req.method === 'GET' && queueMatch) {
      const parent = getRun(queueMatch[1]);
      if (!parent.jobIds?.length) throw new Error('Phiên này chưa có hàng chờ.');
      refreshParent(parent);
      json(res, 200, {queue: queueSnapshot(parent)});
      return;
    }
    const queueAction = /^\/api\/runs\/([^/]+)\/queue\/(pause|resume)$/.exec(url.pathname);
    if (req.method === 'POST' && queueAction) {
      if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ có thể điều khiển hàng chờ từ giao diện local.'}); return; }
      const parent = getRun(queueAction[1]);
      json(res, 200, {queue: await setQueuePaused(parent, queueAction[2] === 'pause')});
      return;
    }
    const footageMatch = /^\/api\/runs\/([^/]+)\/footage$/.exec(url.pathname);
    if (req.method === 'POST' && footageMatch) {
      const run = getRun(footageMatch[1]);
      if (run.status !== 'footage_review') throw new Error('Video này chưa sẵn sàng để chọn footage.');
      const input = await body(req);
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      const minimum = run.template === 'quote' ? 1 : 8;
      const maximum = run.template === 'quote' ? 1 : 20;
      if (ids.length < minimum || ids.length > maximum || new Set(ids).size !== ids.length) {
        throw new Error(run.template === 'quote' ? 'Hãy chọn đúng một ảnh Quote.' : `Hãy chọn từ ${minimum} đến 20 clip khác nhau.`);
      }
      const selected = ids.map(id => run.candidates.find(candidate => candidate.id === id));
      if (selected.some(candidate => !candidate)) throw new Error('Có tài nguyên không thuộc danh sách gợi ý hiện tại.');
      run.selectedCandidates = selected;
      await saveJson(path.join(run.folder, 'footage-selection.json'),
        run.template === 'quote' ? selected : selected.map(candidate => publicCandidate(candidate, run.id)));
      run.status = 'render_queued';
      run.step = 'Đã chọn footage · chờ tải và render';
      run.progress = 0.65;
      await saveJob(run);
      if (run.superItemId) await updateSuperItem(run.superItemId, {status: 'producing', error: null});
      pendingJobs.push(run.id);
      void drainQueue();
      json(res, 202, {run: publicQueueItem(run)});
      return;
    }
    const uploadMatch = /^\/api\/runs\/([^/]+)\/footage\/upload$/.exec(url.pathname);
    if (req.method === 'POST' && uploadMatch) {
      const run = getRun(uploadMatch[1]);
      if (run.template === 'quote') throw new Error('Quote dùng kho ảnh. Hãy upload JPG, PNG hoặc WebP vào kho ảnh Quote.');
      json(res, 201, {candidate: await uploadClip(run, req)});
      return;
    }
    const previewMatch = /^\/api\/runs\/([^/]+)\/footage\/([^/]+)\/preview$/.exec(url.pathname);
    if (req.method === 'GET' && previewMatch) {
      const run = getRun(previewMatch[1]);
      const candidate = run.candidates?.find(item => item.id === decodeURIComponent(previewMatch[2]));
      if (!candidate) throw new Error('Không tìm thấy clip xem trước.');
      if (candidate.localPath) {
        await sendFile(res, candidate.localPath, 'video/mp4', req.headers.range);
      } else {
        const response = await fetch(candidate.previewUrl, {headers: req.headers.range ? {Range: req.headers.range} : {},
          signal: AbortSignal.timeout(120000)});
        if (!response.ok || !response.body) throw new Error(`Không xem trước được clip: HTTP ${response.status}.`);
        const headers = {'Content-Type': 'video/mp4', 'Cache-Control': 'no-store'};
        for (const key of ['content-range', 'content-length', 'accept-ranges']) {
          if (response.headers.has(key)) headers[key] = response.headers.get(key);
        }
        res.writeHead(response.status === 206 ? 206 : 200, headers);
        await pipeline(Readable.fromWeb(response.body), res);
      }
      return;
    }
    const researchMatch = /^\/api\/runs\/([^/]+)\/research$/.exec(url.pathname);
    if (req.method === 'POST' && researchMatch) {
      const run = getRun(researchMatch[1]);
      const input = await body(req);
      const facts = await researchIdea(run, Number(input.selection));
      json(res, 200, {facts, run: publicRun(run)});
      return;
    }
    const renderMatch = /^\/api\/runs\/([^/]+)\/render$/.exec(url.pathname);
    if (req.method === 'POST' && renderMatch) {
      const run = getRun(renderMatch[1]);
      if (!['review', 'error'].includes(run.status) || !run.facts || !run.idea) {
        throw new Error('Cần duyệt xong số liệu trước khi render.');
      }
      void prepareRun(run);
      json(res, 202, {run: publicRun(run)});
      return;
    }
    const stateMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && stateMatch) {
      json(res, 200, {run: publicRun(getRun(stateMatch[1]))});
      return;
    }
    json(res, 404, {error: 'Không tìm thấy đường dẫn.'});
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 400;
    json(res, status, {error: error.message || 'Có lỗi xảy ra.'});
  }
});

try {
  await initDatabase();
  const seeded = await seedExistingOutputs();
  server.listen(port, host, () => {
    console.log(`\nAI Video Studio đang chạy tại http://${host}:${port}\nPostgreSQL sẵn sàng · seed ${seeded.videos} MP4, ${seeded.jobs} job.\nNhấn Ctrl+C để dừng.\n`);
    console.log(`Song song: ${concurrency.jobs} job · ${concurrency.renders} render · ${concurrency.downloads} download · ${concurrency.publishes} publish.`);
    const footageProviders = configuredProviders();
    console.log(`Nguồn footage: ${footageProviders.map(provider => `${provider.name} ${provider.enabled ? 'bật' : 'tắt'}`).join(' · ')}`);
    if (!footageProviders.some(provider => provider.enabled)) console.warn('Chưa có API footage nào được bật.');
    void recoverInterruptedSuperAuto().then(() => tickSuperAuto())
      .catch(error => console.error('Khởi động Super Auto:', error.message));
    void watchFlowDownloads().catch(error => console.error('Theo dõi tải xuống Flow:', error.message));
    setInterval(() => void tickSuperAuto(), 30_000).unref();
  });
} catch (error) {
  console.error(`Không khởi động được PostgreSQL: ${error.message}`);
  process.exitCode = 1;
}
