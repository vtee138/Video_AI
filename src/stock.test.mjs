import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {rm, stat} from 'node:fs/promises';
import {publicDir} from './common.mjs';
import {downloadFootage, findFootage, publicCandidate} from './stock.mjs';
import {fillMissingEnvironment, normalizeBomEnvironment} from './common.mjs';

test('chuẩn hóa BOM trong tên biến môi trường', () => {
  const environment = {'\uFEFFPIXABAY_API_KEY': 'key-with-bom'};
  normalizeBomEnvironment(environment);
  assert.deepEqual(environment, {PIXABAY_API_KEY: 'key-with-bom'});
});

test('nạp giá trị .env cho biến Windows rỗng nhưng không ghi đè override', () => {
  const environment = {PIXABAY_API_KEY: '', COVERR_API_KEY: 'system-key'};
  fillMissingEnvironment('\uFEFFPIXABAY_API_KEY=file-key\nCOVERR_API_KEY=file-coverr', environment);
  assert.deepEqual(environment, {PIXABAY_API_KEY: 'file-key', COVERR_API_KEY: 'system-key'});
});

test('tìm lại bằng truy vấn rộng khi truy vấn chặt không có clip', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['PIXABAY_API_KEY', 'PEXELS_API_KEY', 'COVERR_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.PIXABAY_API_KEY = 'test-key';
  delete process.env.PEXELS_API_KEY;
  delete process.env.COVERR_API_KEY;
  const query = `brand model factory motion ${Date.now()}`;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const broad = new URL(String(url)).searchParams.get('q') !== query;
    return {ok: true, json: async () => ({hits: broad ? [{id: 404, pageURL: 'https://pixabay.com/videos/404/',
      tags: 'factory production motion', duration: 12, user: 'A', videos: {
        small: {url: 'https://cdn.pixabay.com/404.mp4', width: 1280, height: 720, size: 1000},
      }}] : []})};
  };
  try {
    const result = await findFootage([{query, subject: 'Nhà máy', anchors: ['brand'],
      visualAnchors: ['factory', 'motion']}]);
    assert.equal(calls, 2);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].query, query);
    assert.match(result.summary, /Pixabay: 1 clip, 1 fallback/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('ngừng gọi một nguồn trong lượt tìm hiện tại khi key bị từ chối', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['PIXABAY_API_KEY', 'PEXELS_API_KEY', 'COVERR_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  delete process.env.PIXABAY_API_KEY;
  delete process.env.PEXELS_API_KEY;
  process.env.COVERR_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => { calls++; return {ok: false, status: 403}; };
  try {
    const stamp = Date.now();
    const result = await findFootage([
      {query: `blocked source one ${stamp}`, subject: 'A', anchors: [], visualAnchors: []},
      {query: `blocked source two ${stamp}`, subject: 'B', anchors: [], visualAnchors: []},
    ]);
    assert.equal(calls, 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.summary, /Coverr: 0 clip, 1 lỗi/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('tìm clip qua ba API, gộp danh sách và không lộ link tải gốc', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['PIXABAY_API_KEY', 'PEXELS_API_KEY', 'COVERR_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'test-key';
  globalThis.fetch = async url => {
    const address = String(url);
    const data = address.includes('pixabay.com') ? {hits: [{id: 101, pageURL: 'https://pixabay.com/videos/101/',
      tags: 'unique test factory production', duration: 12, user: 'A', videos: {
        small: {url: 'https://cdn.pixabay.com/101.mp4', width: 1280, height: 720, size: 1000,
          thumbnail: 'https://cdn.pixabay.com/101.jpg'},
      }}]} : address.includes('pexels.com') ? {videos: [{id: 202, url: 'https://www.pexels.com/video/202/',
        duration: 10, image: 'https://images.pexels.com/202.jpg', user: {name: 'B'},
        video_files: [{file_type: 'video/mp4', link: 'https://videos.pexels.com/202.mp4', width: 1920, height: 1080}]}]}
      : {hits: [{id: 'c303', title: 'unique test factory production', duration: 11,
        max_width: 1920, max_height: 1080, poster: 'https://storage.coverr.co/c303.jpg',
        urls: {mp4: 'https://storage.coverr.co/c303.mp4', mp4_preview: 'https://storage.coverr.co/c303-preview.mp4',
          mp4_download: 'https://storage.coverr.co/c303-download.mp4'}}]};
    return {ok: true, json: async () => data};
  };
  try {
    const query = `unique test factory production ${Date.now()}`;
    const result = await findFootage([{query, subject: 'Nhà máy', anchors: [], visualAnchors: []}]);
    assert.equal(result.warnings.length, 0);
    assert.deepEqual(new Set(result.candidates.map(candidate => candidate.provider)),
      new Set(['Pixabay', 'Pexels', 'Coverr']));
    for (const candidate of result.candidates) {
      const visible = publicCandidate(candidate, 'test-run');
      assert.equal(visible.downloadUrl, undefined);
      assert.match(visible.previewUrl, /^\/api\/runs\/test-run\/footage\//);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('tải footage thử lại khi CDN timeout tạm thời', async () => {
  const originalFetch = globalThis.fetch;
  const runId = `stock-retry-${Date.now()}`;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return new Response(Buffer.from('video-bytes'), {status: 200});
  };
  const selected = Array.from({length: 8}, (_, index) => ({
    id: `clip-${index + 1}`, provider: 'Test CDN', downloadUrl: `https://cdn.example/${index + 1}.mp4`,
    sourceUrl: 'https://example.com', creator: '', duration: 10, query: 'test', subject: 'test', description: 'test',
  }));
  try {
    const clips = await downloadFootage(selected, runId);
    assert.equal(clips.length, 8);
    assert.equal(calls, 9);
    assert.ok((await stat(path.join(publicDir, clips[0].path))).size > 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(path.join(publicDir, 'runs', runId), {recursive: true, force: true});
  }
});

test('Coverr dùng URL MP4 dự phòng khi URL tải xuống mất kết nối', async () => {
  const originalFetch = globalThis.fetch;
  const runId = `stock-coverr-fallback-${Date.now()}`;
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    if (String(url).includes('download=true')) throw new TypeError('fetch failed');
    return new Response(Buffer.from('video-bytes'),
      {status: 200, headers: {'content-type': 'video/mp4'}});
  };
  const selected = Array.from({length: 8}, (_, index) => ({
    id: `clip:${index + 1}`, provider: index === 7 ? 'Coverr' : 'Test CDN',
    downloadUrl: `https://cdn.coverr.co/${index + 1}.mp4${index === 7 ? '?download=true' : ''}`,
    fallbackDownloadUrl: index === 7 ? 'https://cdn.coverr.co/8.mp4' : undefined,
    sourceUrl: 'https://coverr.co/videos/test', creator: '', duration: 10,
    query: 'test', subject: 'test', description: 'test',
  }));
  try {
    const clips = await downloadFootage(selected, runId);
    assert.equal(clips.length, 8);
    assert.equal(requested.length, 9);
    assert.ok(requested[8].endsWith('/8.mp4'));
    assert.ok((await stat(path.join(publicDir, clips[7].path))).size > 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(path.join(publicDir, 'runs', runId), {recursive: true, force: true});
  }
});
