import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from './common.mjs';

const file = path.join(root, '.cache', 'flow-auto-batches.json');
let mutation = Promise.resolve();

async function readBatches() {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function writeBatches(batches) {
  await mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(batches, null, 2));
  await rename(temp, file);
}

function mutate(fn) {
  const task = mutation.then(async () => {
    const batches = await readBatches();
    const result = await fn(batches);
    await writeBatches(batches);
    return result;
  });
  mutation = task.catch(() => {});
  return task;
}

export async function listFlowAutoBatches() { await mutation; return readBatches(); }

export async function createFlowAutoBatch({jobIds, titles, settings, credits, previewOnly = false,
  resumeSubmit = false}) {
  return mutate(batches => {
    const used = new Set(batches.filter(batch => batch.status === 'active')
      .flatMap(batch => batch.items.map(item => item.jobId)));
    if (jobIds.some(id => used.has(id))) throw new Error('Có job đã nằm trong một đợt đang chạy.');
    const batch = {id: randomUUID(), status: 'active', settings, credits, previewOnly,
      createdAt: new Date().toISOString(), items: jobIds.map((jobId, index) =>
        ({jobId, title: titles[index], state: resumeSubmit ? 'ready_submit_image' : 'ready_image',
          segment: 0, error: null, postId: null}))};
    batches.unshift(batch);
    return batch;
  });
}

export async function activateFlowAutoPublishing(batchId, settings) {
  return mutate(batches => {
    const batch = batches.find(value => value.id === batchId);
    if (!batch || !batch.previewOnly || batch.status !== 'done' ||
      batch.items.some(item => item.state !== 'done' || !item.outputName || item.postId))
      throw new Error('Đợt preview chưa hoàn tất hoặc đã gửi đăng.');
    batch.previewOnly = false;
    batch.settings = settings;
    batch.status = 'active';
    for (const item of batch.items) {
      item.state = 'publishing';
      item.startedAt = new Date().toISOString();
      item.touchedAt = item.startedAt;
    }
    return batch;
  });
}

export async function nextFlowAutoTask() {
  const batches = await listFlowAutoBatches();
  for (const batch of batches.filter(item => item.status === 'active').reverse()) {
    const item = batch.items.find(entry => !['done', 'failed'].includes(entry.state));
    if (!item) continue;
    if (['ready_image', 'ready_submit_image', 'ready_video'].includes(item.state)) return {batch, item};
    const timeout = item.state === 'publishing' ? 45 * 60_000 : 20 * 60_000;
    const reference = item.state === 'publishing' ? item.startedAt :
      item.touchedAt || item.startedAt || batch.createdAt;
    if (Date.now() - Date.parse(reference) > timeout) {
      await failFlowAutoItem(item.jobId, item.state === 'publishing' ?
        'Chưa xác nhận được kết quả đăng sau 45 phút. Kiểm tra lượt đăng trước khi thử lại.' :
        'Tác vụ Flow quá thời gian hoặc app đã khởi động lại; không tự Generate lần nữa để tránh dùng credit hai lần.');
      return nextFlowAutoTask();
    }
    return null;
  }
  return null;
}

export async function flowAutoItem(jobId) {
  const batches = await listFlowAutoBatches();
  for (const batch of batches) {
    const item = batch.items.find(value => value.jobId === jobId);
    if (item) return {batch, item};
  }
  return null;
}

export async function claimFlowAutoTask(batchId, jobId, state, segment) {
  return mutate(batches => {
    const batch = batches.find(value => value.id === batchId && value.status === 'active');
    const item = batch?.items.find(value => value.jobId === jobId);
    if (!item || item.state !== state || item.segment !== segment)
      throw new Error('Tác vụ Flow đã thay đổi; không tạo thêm để tránh tiêu credit hai lần.');
    item.state = ['ready_image', 'ready_submit_image'].includes(state) ?
      'generating_image' : 'generating_video';
    item.startedAt = new Date().toISOString();
    item.touchedAt = item.startedAt;
    return {batch, item};
  });
}

export async function updateFlowAutoItem(jobId, expectedState, patch) {
  return mutate(batches => {
    const batch = batches.find(value => value.items.some(item => item.jobId === jobId));
    const item = batch?.items.find(value => value.jobId === jobId);
    if (!item || item.state !== expectedState) throw new Error('Trạng thái tác vụ Flow không khớp.');
    Object.assign(item, patch);
    item.touchedAt = new Date().toISOString();
    if (batch.items.every(value => ['done', 'failed'].includes(value.state))) batch.status = 'done';
    return {batch, item};
  });
}

export async function failFlowAutoItem(jobId, message) {
  return mutate(batches => {
    const batch = batches.find(value => value.status === 'active' &&
      value.items.some(item => item.jobId === jobId));
    const item = batch?.items.find(value => value.jobId === jobId);
    if (!item) throw new Error('Không tìm thấy tác vụ Flow đang chạy.');
    item.state = 'failed'; item.error = String(message).slice(0, 500);
    if (batch.items.every(value => ['done', 'failed'].includes(value.state))) batch.status = 'done';
    return {batch, item};
  });
}

export async function stopFlowAutoBatch(batchId) {
  return mutate(batches => {
    const batch = batches.find(value => value.id === batchId);
    if (!batch) throw new Error('Không tìm thấy đợt Flow.');
    batch.status = 'stopped';
    return batch;
  });
}
