import test from 'node:test';
import assert from 'node:assert/strict';
import {composePostCopy} from '../web/post-copy.mjs';
import {autoPostTargets} from './auto.mjs';

test('bản nháp nền tảng giữ nội dung và lọc hashtag chung chung, nguồn dữ liệu', () => {
  const caption = 'Toyota dẫn đầu bảng xe bán chạy năm 2025.\n\n#oto #xuhuong #xehoi #toyota #doanhso\n\nNguồn dữ liệu (2025): https://example.org';
  const copy = composePostCopy('Top hãng xe bán chạy', caption);
  assert.equal(copy.tiktok.caption, 'Toyota dẫn đầu bảng xe bán chạy năm 2025.\n\n#oto #xehoi #toyota #doanhso');
  assert.equal(copy.facebook.caption, 'Toyota dẫn đầu bảng xe bán chạy năm 2025.\n\n#oto #xehoi #toyota');
  assert.equal(copy.youtube.title, 'Top hãng xe bán chạy');
  assert.doesNotMatch(copy.youtube.description, /Nguồn dữ liệu|xuhuong/);
  const targets = autoPostTargets({tiktok: {privacy: 'SELF_ONLY'}, youtube: {privacy: 'public'}},
    'Top hãng xe bán chạy', caption);
  assert.equal(targets.tiktok.caption, copy.tiktok.caption);
  assert.equal(targets.youtube.description, copy.youtube.description);
});
