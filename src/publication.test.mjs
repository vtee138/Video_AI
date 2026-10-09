import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publicationStatus} from './publication.mjs';

test('MP4 cũ chưa có lịch sử đăng luôn là chưa xác minh', () => {
  assert.equal(publicationStatus({manualPublication: 'unknown'}, []), 'unknown');
});

test('trạng thái đăng phản ánh kết quả nền tảng và đánh dấu thủ công', () => {
  const video = {manualPublication: 'not_posted'};
  assert.equal(publicationStatus(video, []), 'not_posted');
  assert.equal(publicationStatus(video, [{results: {tiktok: {state: 'processing'}}}]), 'posting');
  assert.equal(publicationStatus(video, [{results: {tiktok: {state: 'failed'}}}]), 'failed');
  assert.equal(publicationStatus(video, [{results: {youtube: {state: 'ready'}}}]), 'uploaded');
  assert.equal(publicationStatus(video, [{results: {facebook: {state: 'published'}}}]), 'posted');
  assert.equal(publicationStatus({manualPublication: 'posted'}, []), 'posted');
});
