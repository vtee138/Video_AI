import test from 'node:test';
import assert from 'node:assert/strict';
import {rankingCaption} from './caption.mjs';
import {autoPostTargets} from './auto.mjs';

test('Ranking đưa hook lên đầu caption và giữ hashtag ở cuối cho Auto', () => {
  const caption = rankingCaption({hookText: 'Toyota dẫn đầu bảng xe bán chạy.',
    caption: 'Số liệu năm 2025 cho thấy nhóm bám đuổi cách biệt đáng kể.',
    hashtags: ['oto', '#doanhso']});
  assert.equal(caption, 'Toyota dẫn đầu bảng xe bán chạy.\n\n' +
    'Số liệu năm 2025 cho thấy nhóm bám đuổi cách biệt đáng kể.\n\n#oto #doanhso');
  const targets = autoPostTargets({tiktok: {privacy: 'PUBLIC_TO_EVERYONE'},
    facebook: {state: 'PUBLISHED'}, youtube: {privacy: 'public'}}, 'Top xe bán chạy', caption);
  for (const text of [targets.tiktok.caption, targets.facebook.caption, targets.youtube.description]) {
    assert.ok(text.startsWith('Toyota dẫn đầu bảng xe bán chạy.'));
  }
});

test('Ranking không lặp hook nếu caption AI đã bắt đầu bằng chính câu đó', () => {
  assert.equal(rankingCaption({hookText: 'Toyota dẫn đầu.',
    caption: 'Toyota dẫn đầu. Đây là số liệu năm 2025.', hashtags: []}),
  'Toyota dẫn đầu. Đây là số liệu năm 2025.');
});
