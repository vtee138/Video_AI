import {createWriteStream} from 'node:fs';
import {copyFile, mkdir, open, rename, stat, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {outputDir, root} from './common.mjs';
import {uploadLocalMedia} from './storage.mjs';
import {createFlowAsset, createFlowJob, getFlowAsset, getFlowJob,
  listFlowAssets, listFlowJobs, updateFlowJob} from './db.mjs';
import {composeFlowVideo, openFlowBrowser, runFlowBrowser} from './flow-browser.mjs';
import {autoPostTargets} from './auto.mjs';
import {activateFlowAutoPublishing, claimFlowAutoTask, createFlowAutoBatch, failFlowAutoItem, flowAutoItem,
  listFlowAutoBatches, nextFlowAutoTask, stopFlowAutoBatch, updateFlowAutoItem} from './flow-auto.mjs';

const base = path.join(root, 'assets', 'flow-tryon');
const assetDir = path.join(base, 'assets');
const jobDir = path.join(base, 'jobs');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exec = promisify(execFile);
let browserQueue = Promise.resolve();
let lastExtensionPoll = 0;
const postCheckAt = new Map();

async function queueFlowPost(outputName, targets) {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4173}/api/posts`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({outputName, targets, consent: true}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Đăng bài HTTP ${response.status}`);
  return data.post;
}

async function refreshFlowPublications() {
  for (const batch of await listFlowAutoBatches()) {
    if (batch.status !== 'active') continue;
    const item = batch.items.find(value => value.state === 'publishing' && value.postId);
    if (!item || Date.now() - (postCheckAt.get(item.postId) || 0) < 30_000) continue;
    postCheckAt.set(item.postId, Date.now());
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4173}/api/posts/${item.postId}?refresh=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const {post} = await response.json();
      const results = Object.entries(post.results || {});
      if (!results.length) throw new Error('Lượt đăng chưa có nền tảng.');
      const failures = results.filter(([, result]) => result.state === 'failed');
      const settled = results.every(([, result]) => ['published', 'failed'].includes(result.state));
      if (settled && failures.length) {
        await updateFlowAutoItem(item.jobId, 'publishing', {state: 'failed', postResults: post.results,
          error: failures.map(([platform, result]) => `${platform}: ${result.error || 'đăng thất bại'}`).join('; ').slice(0, 500)});
      } else if (settled) {
        await updateFlowAutoItem(item.jobId, 'publishing', {state: 'done', postResults: post.results});
      } else {
        await updateFlowAutoItem(item.jobId, 'publishing', {postResults: post.results});
      }
    } catch (error) {
      console.warn('Kiểm tra lượt đăng Flow:', error.message);
    }
  }
}

function imageType(header) {
  if (header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['png', 'image/png'];
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return ['jpg', 'image/jpeg'];
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return ['webp', 'image/webp'];
  return null;
}

async function upload(req, target, kind, maxBytes) {
  await mkdir(path.dirname(target), {recursive: true});
  const temp = `${target}.${randomUUID()}.part`;
  let size = 0;
  try {
    await pipeline(req, new Transform({transform(chunk, encoding, callback) {
      size += chunk.length;
      callback(size > maxBytes ? new Error('File vượt giới hạn dung lượng.') : null, chunk);
    }}), createWriteStream(temp));
    if (!size) throw new Error('File rỗng.');
    const handle = await open(temp, 'r');
    const header = Buffer.alloc(16);
    try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
    const type = kind === 'image' ? imageType(header) :
      header.toString('ascii', 4, 8) === 'ftyp' ? ['mp4', 'video/mp4'] : null;
    if (!type) throw new Error(kind === 'image' ? 'Chỉ nhận ảnh PNG, JPEG hoặc WebP.' : 'Chỉ nhận video MP4.');
    const final = `${target}.${type[0]}`;
    await rename(temp, final);
    return {file: final, contentType: type[1], size};
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function existingImage(prefix) {
  for (const ext of ['png', 'jpg', 'webp']) {
    const file = `${prefix}.${ext}`;
    if (await stat(file).then(() => true).catch(() => false)) return file;
  }
  return null;
}

async function videoSeconds(file) {
  const {stdout} = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file], {timeout: 30_000});
  return Number(stdout.trim()) || 0;
}

async function normalizeVideo(source, output, seconds) {
  if (await videoSeconds(source) < seconds) throw new Error(`MP4 cần dài ít nhất ${seconds} giây.`);
  await exec('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source,
    '-t', String(seconds), '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', '-y', output], {timeout: 30 * 60_000});
}

function enrich(job) {
  return {...job, garmentUrl: `/api/flow/jobs/${job.id}/media/garment`,
    stillUrl: `/api/flow/jobs/${job.id}/media/still`,
    videoUrl: `/api/flow/jobs/${job.id}/media/video`};
}

function queueStage(job, stage) {
  const task = async () => {
    const current = await getFlowJob(job.id);
    if (!current || current.state !== `queued_${stage}`) return;
    await updateFlowJob(job.id, {state: `generating_${stage}`, error: null});
    try {
      const directory = path.join(jobDir, job.id);
      const garment = await existingImage(path.join(directory, 'garment'));
      const background = await existingImage(path.join(assetDir, job.backgroundId));
      const model = job.modelId ? await existingImage(path.join(assetDir, job.modelId)) : null;
      const action = job.hasAction ? path.join(directory, 'action.mp4') : null;
      const output = path.join(directory, stage === 'image' ? 'still.png' : 'video.mp4');
      const result = await runFlowBrowser({stage, job, garment, background, model, action,
        still: await existingImage(path.join(directory, 'still')), output, directory});
      if (result?.pause) {
        await updateFlowJob(job.id, {state: 'credit_pause',
          error: 'Đã tạo một đoạn video. Nhánh clip hành động dùng nhiều credit; đợi ít nhất 24 giờ rồi tiếp tục bằng credit miễn phí.'});
        return;
      }
      await stat(output);
      await updateFlowJob(job.id, {state: stage === 'image' ? 'image_review' : 'done', error: null});
    } catch (error) {
      await updateFlowJob(job.id, {state: error.code === 'FLOW_AUTH' ? 'auth_required' : 'needs_attention',
        error: error.message.slice(0, 1000)});
    }
  };
  browserQueue = browserQueue.then(task, task);
}

export async function handleFlowRequest(req, res, url, helpers) {
  const {json, sendFile, localDeletionRequest} = helpers;
  const pathname = url.pathname;
  const extensionRequest = () => localDeletionRequest(req) ||
    (/^chrome-extension:\/\/[a-z]{32}$/.test(req.headers.origin || '') &&
      req.headers['x-flow-extension'] === '1');
  if (pathname === '/api/flow/auto/status' && req.method === 'GET') {
    json(res, 200, {connected: Date.now() - lastExtensionPoll < 120_000,
      lastPoll: lastExtensionPoll || null}); return true;
  }
  if (pathname === '/api/flow/auto/batches' && req.method === 'GET') {
    await refreshFlowPublications();
    json(res, 200, {batches: await listFlowAutoBatches()}); return true;
  }
  if (pathname === '/api/flow/auto/batches' && req.method === 'POST') {
    if (!extensionRequest()) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    const input = await helpers.body(req);
    const ids = input.jobIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
      new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id)))
      throw new Error('Hãy chọn từ 1 đến 100 ảnh quần áo hợp lệ.');
    if (!Array.isArray(input.titles) || input.titles.length !== ids.length ||
      input.titles.some(title => typeof title !== 'string' || !title.trim() || title.length > 120))
      throw new Error('Mỗi ảnh cần một tên sản phẩm hợp lệ.');
    const jobs = await Promise.all(ids.map(getFlowJob));
    if (jobs.some(job => !job || job.state !== 'ready_image' || job.hasAction))
      throw new Error('Job phải có ảnh quần áo và chưa tạo; clip hành động chưa hỗ trợ trong Auto Flow.');
    const resumeSubmit = input.resumeSubmit === true;
    if (resumeSubmit && ids.length !== 1)
      throw new Error('Chỉ có thể gửi lại một bản nháp Flow mỗi lần.');
    const previewOnly = input.previewOnly === true;
    const settings = previewOnly ? null : await helpers.validateFlowAutoSettings(input.auto);
    const credits = jobs.reduce((sum, job) => sum + Math.ceil(job.duration / 8) * 20, 0);
    if (!Number.isInteger(input.maxCredits) || input.maxCredits < credits)
      throw new Error(`Đợt này cần tối đa khoảng ${credits} credit video. Hãy đặt giới hạn đủ lớn.`);
    const batch = await createFlowAutoBatch({jobIds: ids, titles: input.titles.map(value => value.trim()),
      settings, credits, previewOnly, resumeSubmit});
    json(res, 201, {batch}); return true;
  }
  const batchStop = /^\/api\/flow\/auto\/batches\/([0-9a-f-]+)\/stop$/.exec(pathname);
  if (batchStop && req.method === 'POST' && uuid.test(batchStop[1])) {
    if (!extensionRequest()) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    json(res, 200, {batch: await stopFlowAutoBatch(batchStop[1])}); return true;
  }
  const batchPublish = /^\/api\/flow\/auto\/batches\/([0-9a-f-]+)\/publish$/.exec(pathname);
  if (batchPublish && req.method === 'POST' && uuid.test(batchPublish[1])) {
    if (!extensionRequest()) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    const input = await helpers.body(req);
    const settings = await helpers.validateFlowAutoSettings(input.auto);
    const batch = await activateFlowAutoPublishing(batchPublish[1], settings);
    for (const item of batch.items) {
      const caption = `${item.title || 'Trang phục'} · Video thử đồ`;
      try {
        const post = await queueFlowPost(item.outputName, autoPostTargets(settings, caption, caption));
        await updateFlowAutoItem(item.jobId, 'publishing', {postId: post.id,
          postResults: post.results});
      } catch (error) {
        await failFlowAutoItem(item.jobId, `Video đã lưu; chưa xác nhận đăng: ${error.message}`);
      }
    }
    json(res, 200, {batch: (await listFlowAutoBatches()).find(value => value.id === batch.id)}); return true;
  }
  if (pathname === '/api/flow/auto/next' && req.method === 'GET') {
    if (req.headers['x-flow-extension'] !== '1' ||
      req.headers.origin && !/^chrome-extension:\/\/[a-z]{32}$/.test(req.headers.origin)) {
      json(res, 403, {error: 'Chỉ tiện ích Flow trong Edge được lấy tác vụ.'}); return true;
    }
    lastExtensionPoll = Date.now();
    await refreshFlowPublications();
    const next = await nextFlowAutoTask();
    if (!next) { json(res, 200, {task: null}); return true; }
    const job = await getFlowJob(next.item.jobId);
    if (!job) throw new Error('Không tìm thấy job trong đợt Flow.');
    const kind = ['ready_image', 'ready_submit_image'].includes(next.item.state) ? 'image' : 'video';
    const resumeSubmit = next.item.state === 'ready_submit_image';
    const segment = next.item.segment;
    const references = kind === 'image' ? [
      `/api/flow/jobs/${job.id}/media/garment`,
      `/api/flow/assets/${job.backgroundId}/image`,
      ...(job.modelId ? [`/api/flow/assets/${job.modelId}/image`] : [])] :
      [`/api/flow/jobs/${job.id}/media/still`];
    const imagePrompt = `Generate exactly one photorealistic full-body vertical 9:16 fashion image. Reference 1 shows the clothing or complete outfit, reference 2 is the background${job.modelId ? ', reference 3 is the model' : ''}. Show an adult woman wearing all clothing visible in reference 1. Preserve each garment's cut, color, fabric, print and length. Use the background reference as the location. ${job.modelId ? 'Keep the model reference identity.' : ''} Remove any phone, camera, cursor or screenshot overlay. No text or extra people. Do not generate any other media.`;
    const videoPrompt = `Generate exactly one 8-second vertical 9:16 fashion video using the attached image as the first frame. The adult woman wears exactly the same outfit and moves naturally. Preserve her face, all garment details, colors and background. Shot ${segment + 1}: ${['front pose', 'gentle side turn', 'walk slowly', 'turn back'][segment % 4]}. No outfit changes, no text. Do not generate any other media.`;
    json(res, 200, {task: {batchId: next.batch.id, jobId: job.id, kind, segment,
      duration: job.duration, references: resumeSubmit ? [] : references, resumeSubmit,
      prompt: kind === 'image' ? imagePrompt : videoPrompt}}); return true;
  }
  if (pathname === '/api/flow/auto/claim' && req.method === 'POST') {
    if (!extensionRequest()) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    const input = await helpers.body(req);
    const result = await claimFlowAutoTask(input.batchId, input.jobId,
      input.resumeSubmit ? 'ready_submit_image' :
        input.kind === 'image' ? 'ready_image' : 'ready_video', input.segment);
    await updateFlowJob(input.jobId, {state: input.kind === 'image' ? 'generating_image' : 'generating_video'});
    json(res, 200, result); return true;
  }
  if (pathname === '/api/flow/auto/fail' && req.method === 'POST') {
    if (!extensionRequest()) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    const input = await helpers.body(req);
    const result = await failFlowAutoItem(input.jobId, input.error || 'Flow không hoàn thành tác vụ.');
    await updateFlowJob(input.jobId, {state: 'needs_attention', error: result.item.error});
    json(res, 200, result); return true;
  }
  if (pathname === '/api/flow/capabilities' && req.method === 'GET') {
    json(res, 200, {continuousVideo: true}); return true;
  }
  if (pathname === '/api/flow/assets' && req.method === 'GET') {
    json(res, 200, {assets: await listFlowAssets()}); return true;
  }
  if (pathname === '/api/flow/jobs' && req.method === 'GET') {
    json(res, 200, {jobs: (await listFlowJobs()).map(enrich)}); return true;
  }
  if (pathname === '/api/flow/browser' && req.method === 'POST') {
    if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    json(res, 200, await openFlowBrowser()); return true;
  }
  if (pathname === '/api/flow/assets' && req.method === 'POST') {
    if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    const kind = url.searchParams.get('kind');
    if (!['background', 'model'].includes(kind)) throw new Error('Loại ảnh không hợp lệ.');
    const id = randomUUID();
    await upload(req, path.join(assetDir, id), 'image', 20_000_000);
    const name = decodeURIComponent(String(req.headers['x-file-name'] || 'Ảnh mới')).slice(0, 120);
    json(res, 201, {asset: await createFlowAsset({id, kind, name})}); return true;
  }
  if (pathname === '/api/flow/jobs' && req.method === 'POST') {
    if (!localDeletionRequest(req)) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
    const input = await helpers.body(req);
    if (!uuid.test(input.backgroundId || '')) throw new Error('Hãy chọn background từ kho.');
    const background = await getFlowAsset(input.backgroundId);
    if (background?.kind !== 'background') throw new Error('Background không tồn tại.');
    let modelId = null;
    if (input.modelId) {
      if (!uuid.test(input.modelId)) throw new Error('Ảnh người mẫu không hợp lệ.');
      const model = await getFlowAsset(input.modelId);
      if (model?.kind !== 'model') throw new Error('Ảnh người mẫu không tồn tại.');
      modelId = model.id;
    }
    const duration = Number(input.duration);
    if (![8, 15, 20, 30].includes(duration)) throw new Error('Chọn thời lượng 8, 15, 20 hoặc 30 giây.');
    const category = String(input.category || 'dress').slice(0, 60);
    if (input.continuousVideo !== undefined && typeof input.continuousVideo !== 'boolean')
      throw new Error('Tùy chọn dùng credit liên tục không hợp lệ.');
    const job = await createFlowJob({id: randomUUID(), category, duration,
      backgroundId: background.id, modelId, hasAction: !!input.hasAction,
      continuousVideo: input.continuousVideo === true});
    json(res, 201, {job: enrich(job)}); return true;
  }
  const assetMatch = /^\/api\/flow\/assets\/([0-9a-f-]+)\/image$/.exec(pathname);
  if (req.method === 'GET' && assetMatch && uuid.test(assetMatch[1])) {
    const asset = await getFlowAsset(assetMatch[1]);
    if (!asset) throw Object.assign(new Error('Không tìm thấy ảnh.'), {code: 'ENOENT'});
    const file = await existingImage(path.join(assetDir, asset.id));
    await sendFile(res, file, `image/${path.extname(file) === '.jpg' ? 'jpeg' : path.extname(file).slice(1)}`);
    return true;
  }
  const match = /^\/api\/flow\/jobs\/([0-9a-f-]+)(?:\/(.*))?$/.exec(pathname);
  if (!match || !uuid.test(match[1])) return false;
  const job = await getFlowJob(match[1]);
  if (!job) throw Object.assign(new Error('Không tìm thấy job Flow.'), {code: 'ENOENT'});
  const action = match[2] || '';
  const directory = path.join(jobDir, job.id);
  if (req.method === 'GET' && !action) { json(res, 200, {job: enrich(job)}); return true; }
  if (req.method === 'GET' && action.startsWith('media/')) {
    const media = action.slice(6);
    let file;
    if (media === 'garment') file = await existingImage(path.join(directory, 'garment'));
    if (media === 'still') file = await existingImage(path.join(directory, 'still'));
    if (media === 'video') file = path.join(directory, 'video.mp4');
    if (media === 'action') file = path.join(directory, 'action.mp4');
    if (media === 'debug') file = path.join(directory, 'flow-debug.png');
    if (!file) return false;
    await sendFile(res, file, ['video', 'action'].includes(media) ? 'video/mp4' : media === 'debug' ? 'image/png' :
      `image/${path.extname(file) === '.jpg' ? 'jpeg' : path.extname(file).slice(1)}`, req.headers.range);
    return true;
  }
  if (req.method !== 'POST') return false;
  if (!extensionRequest()) { json(res, 403, {error: 'Chỉ nhận yêu cầu từ app local.'}); return true; }
  if (action === 'garment' && job.state === 'uploading') {
    await upload(req, path.join(directory, 'garment'), 'image', 20_000_000);
    json(res, 200, {job: enrich(await updateFlowJob(job.id, {state: 'ready_image'}))}); return true;
  }
  if (action === 'action' && job.hasAction && ['uploading', 'ready_image'].includes(job.state)) {
    await upload(req, path.join(directory, 'action'), 'video', 1_000_000_000);
    json(res, 200, {job: enrich(job)}); return true;
  }
  if (action === 'start-image' && ['ready_image', 'auth_required', 'needs_attention'].includes(job.state)) {
    if (!await existingImage(path.join(directory, 'garment'))) throw new Error('Chưa có ảnh quần áo.');
    if (job.hasAction && !await stat(path.join(directory, 'action.mp4')).then(() => true).catch(() => false))
      throw new Error('Chưa có clip hành động.');
    const next = await updateFlowJob(job.id, {state: 'queued_image', error: null});
    queueStage(next, 'image'); json(res, 202, {job: enrich(next)}); return true;
  }
  if (action === 'approve-image' && job.state === 'image_review') {
    const next = await updateFlowJob(job.id, {state: 'queued_video', error: null});
    queueStage(next, 'video'); json(res, 202, {job: enrich(next)}); return true;
  }
  if (action === 'retry-video' && ['needs_attention', 'auth_required', 'ready_video', 'credit_pause'].includes(job.state)) {
    if (!await existingImage(path.join(directory, 'still'))) throw new Error('Chưa có ảnh đã duyệt.');
    if (job.hasAction && !job.continuousVideo) {
      const segments = [];
      for (let index = 1; index <= Math.ceil(job.duration / 8); index++) {
        const info = await stat(path.join(directory, `segment-${index}.mp4`)).catch(() => null);
        if (info) segments.push(info);
      }
      if (segments.length && Date.now() - Math.max(...segments.map(info => info.mtimeMs)) < 24 * 60 * 60_000)
        throw new Error('Nhánh clip hành động chờ 24 giờ giữa các đoạn để dùng credit miễn phí.');
    }
    const next = await updateFlowJob(job.id, {state: 'queued_video', error: null});
    queueStage(next, 'video'); json(res, 202, {job: enrich(next)}); return true;
  }
  if (action === 'import-image' && ['needs_attention', 'auth_required', 'ready_image', 'generating_image'].includes(job.state)) {
    const auto = await flowAutoItem(job.id);
    if (job.state === 'generating_image' && auto?.item.state !== 'generating_image')
      throw new Error('Ảnh tự động không khớp tác vụ đang chạy.');
    const result = await upload(req, path.join(directory, 'imported-still'), 'image', 20_000_000);
    for (const ext of ['png', 'jpg', 'webp']) await unlink(path.join(directory, `still.${ext}`)).catch(() => {});
    await rename(result.file, path.join(directory, `still${path.extname(result.file)}`));
    if (auto?.item.state === 'generating_image') {
      await updateFlowAutoItem(job.id, 'generating_image', {state: 'ready_video', segment: 0});
      json(res, 200, {job: enrich(await updateFlowJob(job.id, {state: 'ready_video', error: null}))});
    } else {
      json(res, 200, {job: enrich(await updateFlowJob(job.id, {state: 'image_review', error: null}))});
    }
    return true;
  }
  if (action === 'import-segment' && job.state === 'generating_video') {
    const auto = await flowAutoItem(job.id);
    if (auto?.batch.status !== 'active' || auto.item.state !== 'generating_video')
      throw new Error('Không có đoạn video tự động đang chờ.');
    const index = auto.item.segment + 1;
    const imported = await upload(req, path.join(directory, `segment-${index}`), 'video', 1_000_000_000);
    const seconds = await videoSeconds(imported.file);
    if (seconds < 4) throw new Error('Đoạn video Flow quá ngắn.');
    const required = Math.ceil(job.duration / 8);
    if (index < required) {
      await updateFlowAutoItem(job.id, 'generating_video', {state: 'ready_video', segment: index});
      json(res, 200, {job: enrich(await updateFlowJob(job.id, {state: 'ready_video', error: null}))});
      return true;
    }
    const parts = Array.from({length: required}, (_, value) => path.join(directory, `segment-${value + 1}.mp4`));
    await composeFlowVideo(parts, path.join(directory, 'video.mp4'), job.duration, directory);
    await mkdir(outputDir, {recursive: true});
    const outputName = `flow-${job.id}.mp4`;
    const outputFile = path.join(outputDir, outputName);
    await copyFile(path.join(directory, 'video.mp4'), outputFile);
    await uploadLocalMedia(outputFile);
    if (auto.batch.previewOnly) {
      await updateFlowAutoItem(job.id, 'generating_video', {state: 'done', segment: index,
        outputName});
      json(res, 200, {job: enrich(await updateFlowJob(job.id, {state: 'done', error: null})),
        previewOnly: true});
      return true;
    }
    await updateFlowAutoItem(job.id, 'generating_video', {state: 'publishing', segment: index,
      outputName, startedAt: new Date().toISOString()});
    await updateFlowJob(job.id, {state: 'done', error: null});
    const caption = `${auto.item.title || job.category} · Video thử đồ`;
    const targets = autoPostTargets(auto.batch.settings, caption, caption);
    try {
      const post = await queueFlowPost(outputName, targets);
      await updateFlowAutoItem(job.id, 'publishing', {postId: post.id,
        postResults: post.results});
      json(res, 200, {job: enrich(await getFlowJob(job.id)), post});
    } catch (error) {
      await failFlowAutoItem(job.id, `Video đã lưu; chưa xác nhận đăng: ${error.message}`);
      json(res, 200, {job: enrich(await getFlowJob(job.id)), warning: error.message});
    }
    return true;
  }
  if (action === 'import-video' && ['needs_attention', 'auth_required', 'image_review', 'credit_pause', 'ready_video'].includes(job.state)) {
    const imported = await upload(req, path.join(directory, 'import-video'), 'video', 1_000_000_000);
    await normalizeVideo(imported.file, path.join(directory, 'video.mp4'), job.duration);
    json(res, 200, {job: enrich(await updateFlowJob(job.id, {state: 'done', error: null}))}); return true;
  }
  return false;
}
