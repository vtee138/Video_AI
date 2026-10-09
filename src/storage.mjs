import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readdir, rename, stat, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {root} from './common.mjs';

const mediaExtensions = new Set([
  '.aac', '.avif', '.avi', '.flac', '.gif', '.jpeg', '.jpg', '.m4a', '.mkv',
  '.mov', '.mp3', '.mp4', '.ogg', '.png', '.wav', '.webm', '.webp',
]);

const contentTypes = new Map([
  ['.aac', 'audio/aac'], ['.avif', 'image/avif'], ['.avi', 'video/x-msvideo'],
  ['.flac', 'audio/flac'], ['.gif', 'image/gif'], ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'], ['.m4a', 'audio/mp4'], ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'], ['.mp3', 'audio/mpeg'], ['.mp4', 'video/mp4'],
  ['.ogg', 'audio/ogg'], ['.png', 'image/png'], ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'], ['.webp', 'image/webp'],
]);

let client;

export function storageMode(environment = process.env) {
  return String(environment.MEDIA_STORAGE || 'local').trim().toLowerCase();
}

export function r2Enabled(environment = process.env) {
  return storageMode(environment) === 'r2';
}

export function r2Config(environment = process.env) {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = required.filter(name => !String(environment[name] || '').trim());
  if (missing.length) throw new Error(`Thiếu cấu hình R2: ${missing.join(', ')}.`);
  return {
    accountId: environment.R2_ACCOUNT_ID.trim(),
    accessKeyId: environment.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY.trim(),
    bucket: environment.R2_BUCKET.trim(),
    prefix: String(environment.R2_PREFIX || 'video-studio').trim().replace(/^\/+|\/+$/g, ''),
  };
}

function r2Client() {
  if (client) return client;
  const config = r2Config();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey},
    requestHandler: new NodeHttpHandler({connectionTimeout: 15_000, socketTimeout: 120_000}),
  });
  return client;
}

export function objectKeyForPath(file, {baseRoot = root, prefix = null} = {}) {
  const resolvedRoot = path.resolve(baseRoot);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`File media nằm ngoài thư mục dự án: ${file}`);
  }
  const normalized = relative.split(path.sep).join('/');
  const actualPrefix = prefix === null ? r2Config().prefix : String(prefix).replace(/^\/+|\/+$/g, '');
  return actualPrefix ? `${actualPrefix}/${normalized}` : normalized;
}

function encodedObjectUrl(baseUrl, key) {
  const base = String(baseUrl || '').trim().replace(/\/+$/g, '');
  if (!base) return null;
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function mediaReference(file, {fallbackUrl = null, environment = process.env} = {}) {
  if (!r2Enabled(environment)) return {provider: 'local', key: null, url: fallbackUrl};
  const config = r2Config(environment);
  const key = objectKeyForPath(file, {prefix: config.prefix});
  return {provider: 'r2', key, url: encodedObjectUrl(environment.R2_PUBLIC_URL, key) || fallbackUrl};
}

export function mediaContentType(file) {
  return contentTypes.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
}

export function isMediaFile(file) {
  return mediaExtensions.has(path.extname(file).toLowerCase());
}

export async function uploadLocalMedia(file, {force = false, onProgress, partConcurrency = 4} = {}) {
  if (!r2Enabled()) return {status: 'local', file};
  const info = await stat(file);
  if (!info.isFile() || !info.size) throw new Error(`File media rỗng hoặc không hợp lệ: ${file}`);
  const config = r2Config();
  const key = objectKeyForPath(file, {prefix: config.prefix});
  if (!force) {
    try {
      const remote = await r2Client().send(new HeadObjectCommand({Bucket: config.bucket, Key: key}));
      if (remote.ContentLength === info.size && remote.Metadata?.['mtime-ms'] === String(Math.trunc(info.mtimeMs))) {
        return {status: 'skipped', file, key, size: info.size};
      }
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') throw error;
    }
  }
  const upload = new Upload({
    client: r2Client(),
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: info.size,
      ContentType: mediaContentType(file),
      Metadata: {'mtime-ms': String(Math.trunc(info.mtimeMs))},
    },
    queueSize: Math.min(4, Math.max(1, Number(partConcurrency) || 1)),
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
  });
  if (onProgress) upload.on('httpUploadProgress', progress => onProgress(progress.loaded || 0, info.size));
  await upload.done();
  return {status: 'uploaded', file, key, size: info.size};
}

export async function remoteMedia(file, {range} = {}) {
  if (!r2Enabled()) return null;
  const config = r2Config();
  try {
    return await r2Client().send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKeyForPath(file, {prefix: config.prefix}),
      ...(range ? {Range: range} : {}),
    }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function ensureLocalMedia(file) {
  try {
    const info = await stat(file);
    if (info.isFile() && info.size) return file;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const object = await remoteMedia(file);
  if (!object?.Body) throw new Error(`Không tìm thấy media ở local hoặc R2: ${path.basename(file)}`);
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.download`;
  try {
    await pipeline(object.Body, createWriteStream(temporary));
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return file;
}

export async function deleteRemoteMedia(file) {
  if (!r2Enabled()) return false;
  const config = r2Config();
  await r2Client().send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: objectKeyForPath(file, {prefix: config.prefix}),
  }));
  return true;
}

export async function checkR2Connection() {
  const config = r2Config();
  await r2Client().send(new ListObjectsV2Command({Bucket: config.bucket, MaxKeys: 1}));
  return {bucket: config.bucket, prefix: config.prefix};
}

function videoCatalogKey(config) {
  return config.prefix ? `${config.prefix}/catalog/videos.json` : 'catalog/videos.json';
}

export async function readVideoCatalog() {
  if (!r2Enabled()) return null;
  const config = r2Config();
  try {
    const object = await r2Client().send(new GetObjectCommand({
      Bucket: config.bucket, Key: videoCatalogKey(config),
    }));
    if (!object.Body) return null;
    const chunks = [];
    for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function writeVideoCatalog(catalog) {
  if (!r2Enabled()) return false;
  const config = r2Config();
  await r2Client().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: videoCatalogKey(config),
    Body: JSON.stringify(catalog),
    ContentType: 'application/json; charset=utf-8',
  }));
  return true;
}

async function walk(directory, result) {
  const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file, result);
    else if (entry.isFile() && isMediaFile(file)) result.push(file);
  }
}

export async function listLocalMedia({includeTemp = true} = {}) {
  const files = [];
  const directories = ['output', 'public', 'assets', ...(includeTemp ? ['.tmp'] : [])];
  for (const directory of directories) await walk(path.join(root, directory), files);
  return files.sort((a, b) => a.localeCompare(b));
}
