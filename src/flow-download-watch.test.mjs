import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, utimes, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {scanFlowDownloads} from './flow-download-watch.mjs';

test('chỉ nhập ảnh có tên chứa đúng ID job đang chờ', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flow-download-'));
  const id = '11111111-2222-4333-8444-555555555555';
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, method: options?.method || 'GET'});
    return options?.method === 'POST'
      ? {ok: true}
      : {ok: true, json: async () => ({job: {state: 'ready_image'}})};
  };
  try {
    await writeFile(path.join(directory, `${id}.png`), Buffer.alloc(32, 1));
    await writeFile(path.join(directory, 'unrelated.png'), Buffer.alloc(32, 1));
    const old = new Date(Date.now() - 5000);
    await utimes(path.join(directory, `${id}.png`), old, old);
    const handled = new Set();
    assert.equal(await scanFlowDownloads({directory, request, handled}), 1);
    assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
    assert.ok(calls.every(call => call.url.includes(id)));
    assert.equal(await scanFlowDownloads({directory, request, handled}), 0);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('đợt tự động nhập đúng ảnh và đoạn MP4 theo trạng thái job', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flow-auto-download-'));
  const id = '11111111-2222-4333-8444-555555555555';
  const calls = [];
  let state = 'generating_image';
  const request = async (url, options) => {
    calls.push(url);
    if (options?.method === 'POST') {
      state = url.endsWith('import-image') ? 'generating_video' : 'done';
      return {ok: true};
    }
    return {ok: true, json: async () => ({job: {state}})};
  };
  try {
    const image = path.join(directory, `${id}-image.png`);
    const video = path.join(directory, `${id}-video-1.mp4`);
    await writeFile(image, Buffer.alloc(32, 1));
    const old = new Date(Date.now() - 5000);
    await utimes(image, old, old);
    const handled = new Set();
    assert.equal(await scanFlowDownloads({directory, request, handled}), 1);
    await writeFile(video, Buffer.alloc(32, 2));
    await utimes(video, old, old);
    assert.equal(await scanFlowDownloads({directory, request, handled}), 1);
    assert.ok(calls.some(url => url.endsWith('/import-image')));
    assert.ok(calls.some(url => url.endsWith('/import-segment')));
  } finally { await rm(directory, {recursive: true, force: true}); }
});
