import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {publicDir} from './common.mjs';
import {copyQuoteImage, deleteQuoteImage, imageType, listQuoteImages, pickQuoteImage, uploadQuoteImage} from './quote-images.mjs';
import {stageRenderAssets} from './render.mjs';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

test('kho ảnh Quote lưu lại ảnh, chọn một ảnh và stage cho Remotion', async () => {
  const request = Readable.from([tinyPng]);
  request.headers = {'content-type': 'image/png'};
  const image = await uploadQuoteImage(request);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-q${Math.floor(Math.random() * 1e9)}`;
  try {
    assert.equal(imageType(tinyPng), 'png');
    assert.ok((await listQuoteImages()).some(item => item.id === image.id));
    assert.equal(pickQuoteImage([image], () => 0).id, image.id);
    const relative = await copyQuoteImage(image.id, runId);
    assert.deepEqual(await readFile(path.join(publicDir, relative)), tinyPng);
    const staged = await stageRenderAssets({type: 'quote', backgroundImage: relative}, runId);
    assert.deepEqual(await readFile(path.join(staged, relative)), tinyPng);
    await deleteQuoteImage(image.id);
    assert.deepEqual(await readFile(path.join(publicDir, relative)), tinyPng);
  } finally {
    await deleteQuoteImage(image.id).catch(() => {});
    await rm(path.join(publicDir, 'runs', runId), {recursive: true, force: true});
    await rm(path.join(path.dirname(publicDir), '.tmp', runId), {recursive: true, force: true});
  }
});

test('kho ảnh Quote từ chối file giả ảnh', async () => {
  const request = Readable.from([Buffer.from('not an image')]);
  request.headers = {'content-type': 'image/png'};
  await assert.rejects(uploadQuoteImage(request), /không phải ảnh/);
});
