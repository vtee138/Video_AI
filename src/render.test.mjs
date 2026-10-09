import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, rm, stat, writeFile} from 'node:fs/promises';
import {isRetryableRemotionTempError, stageRenderAssets} from './render.mjs';
import {publicDir, root} from './common.mjs';

test('nhận diện lỗi thư mục audio tạm của Remotion để retry đúng một lần', () => {
  assert.equal(isRetryableRemotionTempError(new Error(
    'Error opening output C:\\Temp\\remotion-assets\\remotion-audio-mixing\\0.wav: No such file or directory')), true);
  assert.equal(isRetryableRemotionTempError(new Error('FFmpeg codec không được hỗ trợ')), false);
});

test('bundle chỉ stage asset của video hiện tại thay vì sao chép toàn bộ public', async () => {
  const runId = `render-stage-${Date.now()}`;
  const relative = `runs/${runId}/clip-1.mp4`;
  const source = path.join(publicDir, relative);
  await mkdir(path.dirname(source), {recursive: true});
  await writeFile(source, 'video');
  try {
    const staging = await stageRenderAssets({backgroundClips: [relative], musicPath: null}, runId);
    assert.equal((await stat(path.join(staging, relative))).size, 5);
    await assert.rejects(stat(path.join(staging, 'ai_do_thay_long.mp3')));
  } finally {
    await rm(path.join(publicDir, 'runs', runId), {recursive: true, force: true});
    await rm(path.join(root, '.tmp', runId), {recursive: true, force: true});
  }
});
