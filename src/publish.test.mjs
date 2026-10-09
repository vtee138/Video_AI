import assert from 'node:assert/strict';
import {writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {postFacebook, postTikTok, postYouTube, publishConfig} from './publish.mjs';

const file = path.join(import.meta.dirname, 'publish-test.mp4');

async function fixture(run) {
  await writeFile(file, Buffer.from('test-video'));
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(['TIKTOK_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN',
    'YOUTUBE_ACCESS_TOKEN', 'ZERNIO_API_KEY'].map(name => [name, process.env[name]]));
  try { await run(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await unlink(file);
  }
}

test('TikTok queries creator, honors privacy and uploads exact local bytes', async () => fixture(async () => {
  process.env.TIKTOK_ACCESS_TOKEN = 'test-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    if (String(url).includes('creator_info')) return Response.json({data: {
      creator_username: 'demo', privacy_level_options: ['SELF_ONLY'],
      max_video_post_duration_sec: 60, comment_disabled: false, duet_disabled: true, stitch_disabled: false},
    error: {code: 'ok'}});
    if (String(url).includes('video/init')) return Response.json({data: {
      publish_id: 'pub-1', upload_url: 'https://open-upload.tiktokapis.com/upload/test'}, error: {code: 'ok'}});
    return new Response('', {status: 200});
  };
  const result = await postTikTok(file, {caption: 'Bài thử', privacy: 'SELF_ONLY', allowComment: true});
  assert.equal(result.id, 'pub-1');
  assert.equal(JSON.parse(calls[1].options.body).post_info.disable_duet, true);
  assert.equal(calls[2].options.headers['Content-Range'], 'bytes 0-9/10');
  assert.equal(calls[2].options.body.toString(), 'test-video');
}));

test('Facebook sends Page token to Meta upload host and finishes the Reel', async () => fixture(async () => {
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'page-token';
  process.env.ZERNIO_API_KEY = `sk_${'a'.repeat(64)}`;
  assert.equal(publishConfig().facebook.provider, 'direct');
  assert.equal(publishConfig().tiktok.provider, 'zernio');
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    if (calls.length === 1) return Response.json({video_id: '123', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/123'});
    return Response.json({success: true});
  };
  const result = await postFacebook(file, {title: 'Tiêu đề', caption: 'Mô tả'});
  assert.equal(result.id, '123');
  assert.equal(result.provider, 'direct');
  assert.equal(calls[1].options.headers.Authorization, 'OAuth page-token');
  assert.equal(new URLSearchParams(calls[2].options.body).get('upload_phase'), 'finish');
  assert.equal(new URLSearchParams(calls[2].options.body).get('video_state'), 'PUBLISHED');
}));

test('YouTube starts resumable upload with metadata and returns video URL', async () => fixture(async () => {
  process.env.YOUTUBE_ACCESS_TOKEN = 'youtube-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    if (calls.length === 1) return new Response('', {status: 200,
      headers: {Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc'}});
    return Response.json({id: 'video123'});
  };
  const result = await postYouTube(file, {title: 'Video ngắn', description: 'Nguồn', privacy: 'private'});
  assert.equal(result.url, 'https://www.youtube.com/watch?v=video123');
  assert.equal(JSON.parse(calls[0].options.body).status.privacyStatus, 'private');
  assert.equal(calls[1].options.headers['Content-Length'], '10');
  assert.equal(publishConfig().youtube.configured, true);
}));
