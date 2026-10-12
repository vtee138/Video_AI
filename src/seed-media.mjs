import {copyFile, mkdir, readdir, stat, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {root} from './common.mjs';

const seedRoot = fileURLToPath(new URL('../seed/media/', import.meta.url));
const libraries = {
  'quote-images': /^[a-f0-9-]+\.(?:jpg|png|webp)$/i,
  'luxury-music': /^[^\\/\x00-\x1f<>:"|?*]+\.(?:mp3|wav|m4a)$/i,
};

export async function seedBundledMedia(destinationRoot = root, sourceRoot = seedRoot) {
  const marker = path.join(destinationRoot, 'public', '.bundled-media-seed-v1');
  try {
    await stat(marker);
    return {'quote-images': 0, 'luxury-music': 0};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const counts = {};
  for (const [library, allowedName] of Object.entries(libraries)) {
    const source = path.join(sourceRoot, library);
    const destination = path.join(destinationRoot, 'public', library);
    const entries = await readdir(source, {withFileTypes: true});
    await mkdir(destination, {recursive: true});
    counts[library] = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !allowedName.test(entry.name)) continue;
      try {
        await copyFile(path.join(source, entry.name), path.join(destination, entry.name), constants.COPYFILE_EXCL);
        counts[library]++;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  }
  await writeFile(marker, 'v1\n');
  return counts;
}
