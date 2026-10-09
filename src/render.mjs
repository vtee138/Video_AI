import path from 'node:path';
import os from 'node:os';
import {copyFile, link, mkdir, rm, stat, unlink} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia} from '@remotion/renderer';
import {root, outputDir, publicDir, slug} from './common.mjs';

export function isRetryableRemotionTempError(error) {
  const message = String(error?.message || error || '');
  return /remotion-(?:audio-mixing|complex-filter|audio-preprocessing).*No such file or directory/is.test(message) ||
    /Error opening output.*No such file or directory/is.test(message);
}

async function stageAsset(relativePath, stagingDir) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return;
  const source = path.resolve(publicDir, relativePath);
  const destination = path.resolve(stagingDir, relativePath);
  if (!source.startsWith(publicDir + path.sep) || !destination.startsWith(stagingDir + path.sep)) {
    throw new Error(`Asset Remotion không hợp lệ: ${relativePath}`);
  }
  const info = await stat(source);
  if (!info.isFile() || !info.size) throw new Error(`Asset Remotion rỗng: ${relativePath}`);
  await mkdir(path.dirname(destination), {recursive: true});
  await link(source, destination).catch(async error => {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    await copyFile(source, destination);
  });
}

export async function stageRenderAssets(spec, runId) {
  const stagingDir = path.join(root, '.tmp', runId, 'remotion-public');
  await rm(stagingDir, {recursive: true, force: true});
  await mkdir(stagingDir, {recursive: true});
  const assets = [...new Set([...(spec.backgroundClips || []), spec.backgroundImage, spec.musicPath].filter(Boolean))];
  for (const asset of assets) await stageAsset(asset, stagingDir);
  return stagingDir;
}

async function removeOwnedBundle(serveUrl) {
  if (typeof serveUrl !== 'string' || !path.isAbsolute(serveUrl)) return;
  const resolved = path.resolve(serveUrl);
  const temp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(temp + path.sep) || !path.basename(resolved).startsWith('remotion-webpack-bundle-')) return;
  await rm(resolved, {recursive: true, force: true});
}

export async function renderVideo(spec, runId, onProgress, {cancelSignal} = {}) {
  await mkdir(outputDir, {recursive: true});
  const file = path.join(outputDir, `${runId}-${slug(spec.title)}.mp4`);
  const stagingDir = await stageRenderAssets(spec, runId);
  let serveUrl;
  try {
    serveUrl = await bundle({entryPoint: path.join(root, 'remotion', 'index.jsx'), publicDir: stagingDir});
    const compositionId = spec.type === 'quote' ? 'QuoteVideo' : 'RankingVideo';
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
    const composition = await selectComposition({serveUrl, id: compositionId, inputProps: {spec}, browserExecutable});
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await renderMedia({serveUrl, composition, codec: 'h264', outputLocation: file, inputProps: {spec},
          concurrency: 1, disallowParallelEncoding: true, overwrite: true, timeoutInMilliseconds: 120000,
          browserExecutable,
          cancelSignal,
          onProgress: ({progress}) => {
            if (onProgress) onProgress(progress);
            else process.stdout.write(`\rRender ${Math.round(progress * 100)}%`);
          }});
        break;
      } catch (error) {
        await unlink(file).catch(() => {});
        if (attempt === 2 || !isRetryableRemotionTempError(error)) throw error;
        console.warn('Remotion mất thư mục audio tạm; đang dựng lại một lần với parallel encoding đã tắt.');
      }
    }
  } finally {
    await rm(stagingDir, {recursive: true, force: true});
    await removeOwnedBundle(serveUrl);
  }
  if (!onProgress) process.stdout.write('\n');
  return file;
}
