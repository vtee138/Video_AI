import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, unlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {seedBundledMedia} from './seed-media.mjs';

test('bundled media seeds once and preserves files already on the server', async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), 'video-seed-'));
  try {
    const first = await seedBundledMedia(destination);
    assert.equal(first['quote-images'], 9);
    assert.equal(first['luxury-music'], 5);
    const image = (await readdir(path.join(destination, 'public', 'quote-images')))[0];
    const file = path.join(destination, 'public', 'quote-images', image);
    await writeFile(file, 'server version');
    const deletedImage = (await readdir(path.join(destination, 'public', 'quote-images')))[1];
    await unlink(path.join(destination, 'public', 'quote-images', deletedImage));
    assert.deepEqual(await seedBundledMedia(destination), {'quote-images': 0, 'luxury-music': 0});
    assert.equal(await readFile(file, 'utf8'), 'server version');
    assert.equal((await readdir(path.join(destination, 'public', 'quote-images'))).length, 8);
  } finally {
    await rm(destination, {recursive: true, force: true});
  }
});
