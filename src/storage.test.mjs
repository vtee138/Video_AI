import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {root} from './common.mjs';
import {isMediaFile, mediaContentType, mediaReference, objectKeyForPath, r2Enabled, storageMode} from './storage.mjs';

test('R2 is opt-in and storage mode is normalized', () => {
  assert.equal(storageMode({}), 'local');
  assert.equal(r2Enabled({MEDIA_STORAGE: ' R2 '}), true);
});

test('object keys preserve the project-relative path', () => {
  const baseRoot = path.resolve('C:/project');
  assert.equal(objectKeyForPath(path.join(baseRoot, 'public', 'runs', 'clip.mp4'),
    {baseRoot, prefix: '/studio/'}), 'studio/public/runs/clip.mp4');
  assert.throws(() => objectKeyForPath(path.resolve('C:/outside.mp4'), {baseRoot, prefix: 'studio'}));
});

test('media extension and content type recognition', () => {
  assert.equal(isMediaFile('VIDEO.MP4'), true);
  assert.equal(isMediaFile('metadata.json'), false);
  assert.equal(mediaContentType('photo.webp'), 'image/webp');
  assert.equal(mediaContentType('clip.mp4'), 'video/mp4');
});

test('media reference uses app fallback for private R2 and public URL when configured', () => {
  const base = {MEDIA_STORAGE: 'r2', R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bucket', R2_PREFIX: 'video-studio'};
  const file = path.join(root, 'output', 'video one.mp4');
  assert.deepEqual(mediaReference(file, {fallbackUrl: '/output/video%20one.mp4', environment: base}), {
    provider: 'r2', key: 'video-studio/output/video one.mp4', url: '/output/video%20one.mp4'});
  assert.equal(mediaReference(file, {fallbackUrl: '/output/video.mp4',
    environment: {...base, R2_PUBLIC_URL: 'https://media.example.com/'}}).url,
  'https://media.example.com/video-studio/output/video%20one.mp4');
});
