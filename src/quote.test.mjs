import test from 'node:test';
import assert from 'node:assert/strict';
import {hasFiveQuotePoints, quoteCaption, quoteDuration} from './quote.mjs';

test('Quote dài 30-40 giây theo nhạc và có mốc dự phòng khi thiếu nhạc', () => {
  assert.equal(quoteDuration(34.8), 34);
  assert.equal(quoteDuration(60, 37), 37);
  assert.equal(quoteDuration(18), 30);
  assert.equal(quoteDuration(138, 44), 40);
  assert.equal(quoteDuration(null), 35);
});

test('caption Quote chuẩn hóa hashtag', () => {
  assert.equal(quoteCaption({captionText: 'Nội dung', hashtags: ['songcham', '#truongthanh']}),
    'Nội dung\n\n#songcham #truongthanh');
});

test('caption dài một khối được ngắt tại ranh giới câu', () => {
  const sentence = 'Giữ lời hứa cần một kế hoạch đủ thực tế.';
  const caption = quoteCaption({captionText: Array(12).fill(sentence).join(' '), hashtags: ['kyluat']});
  assert.match(caption, /thực tế\.\n\nGiữ lời/u);
  assert.match(caption, /\n\n#kyluat$/u);
});

test('caption Quote giữ đúng 5 ý và tách dòng giữa các ý', () => {
  const captionText = Array.from({length: 5}, (_, index) =>
    `${index + 1}. Đừng hứa quá tay khi chưa biết có giao đúng hẹn không. Một lời báo sớm giúp người khác còn đường xoay xở.`).join('\n');
  assert.equal(hasFiveQuotePoints(captionText), true);
  assert.equal(hasFiveQuotePoints(captionText.replace('5.', '6.')), false);
  assert.match(quoteCaption({captionText, hashtags: ['trachnhiem']}), /xoay xở\.\n\n2\./u);
});
