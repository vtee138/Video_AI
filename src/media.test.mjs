import assert from 'node:assert/strict';
import {test} from 'node:test';
import {quietQuoteEnding, quoteMusicTiming, selectWeightedMusic} from './media.mjs';

test('weighted music selection follows relative weights and avoids the previous track', () => {
  const tracks = [{name: 'a.mp3', weight: 1}, {name: 'b.mp3', weight: 3},
    {name: 'c.mp3', weight: 0}];
  assert.equal(selectWeightedMusic(tracks, '', () => 0), 'a.mp3');
  assert.equal(selectWeightedMusic(tracks, '', () => 1), 'b.mp3');
  assert.equal(selectWeightedMusic(tracks, '', () => 3), 'b.mp3');
  assert.equal(selectWeightedMusic(tracks, 'b.mp3', () => 0), 'a.mp3');
  assert.equal(selectWeightedMusic(tracks, 'a.mp3', () => 2), 'b.mp3');
});

test('a one-track library repeats its only enabled track; zero disables all tracks', () => {
  assert.equal(selectWeightedMusic([{name: 'a.mp3', weight: 2}], 'a.mp3', () => 0), 'a.mp3');
  assert.equal(selectWeightedMusic([{name: 'a.mp3', weight: 0}], '', () => 0), null);
});

test('Quote chọn điểm kết ở đoạn nhạc dịu trong cửa sổ 30-40 giây', () => {
  const samples = Buffer.alloc(11 * 8000 * 2);
  for (let index = 0; index < samples.length / 2; index++) samples.writeInt16LE(10000, index * 2);
  for (let index = 4 * 8000; index < 4.5 * 8000; index++) samples.writeInt16LE(100, index * 2);
  assert.equal(quietQuoteEnding(samples), 34);
});

test('đọc được độ dài và điểm kết của nhạc Quote trong kho', async () => {
  const timing = await quoteMusicTiming('ai_do_thay_long.mp3');
  assert.ok(timing.seconds > 40);
  assert.ok(timing.quietEnding >= 30 && timing.quietEnding <= 40);
});
