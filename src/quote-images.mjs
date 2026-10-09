import {createWriteStream} from 'node:fs';
import {copyFile, mkdir, open, readdir, stat, unlink} from 'node:fs/promises';
import {randomInt, randomUUID} from 'node:crypto';
import path from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {publicDir} from './common.mjs';

const imageDir = path.join(publicDir, 'quote-images');
const imageName = /^[a-f0-9-]+\.(jpg|png|webp)$/;

export function imageType(header) {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpg';
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function listQuoteImages() {
  await mkdir(imageDir, {recursive: true});
  const entries = await readdir(imageDir, {withFileTypes: true});
  return (await Promise.all(entries.filter(entry => entry.isFile() && imageName.test(entry.name)).map(async entry => {
    const info = await stat(path.join(imageDir, entry.name));
    return {id: entry.name, url: `/quote-images/${entry.name}`, size: info.size};
  }))).filter(item => item.size > 0).sort((a, b) => a.id.localeCompare(b.id));
}

export function pickQuoteImage(images, pickIndex = randomInt) {
  return images.length ? images[pickIndex(images.length)] : null;
}

export async function uploadQuoteImage(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WebP.');
  await mkdir(imageDir, {recursive: true});
  const temporary = path.join(imageDir, `${randomUUID()}.upload`);
  let size = 0;
  try {
    await pipeline(req, new Transform({transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > 20_000_000 ? new Error('Mỗi ảnh tối đa 20 MB.') : null, chunk);
    }}), createWriteStream(temporary));
    if (!size) throw new Error('Ảnh tải lên bị rỗng.');
    const handle = await open(temporary, 'r');
    const header = Buffer.alloc(12);
    try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
    const extension = imageType(header);
    if (!extension) throw new Error('File không phải ảnh JPG, PNG hoặc WebP hợp lệ.');
    const id = `${randomUUID()}.${extension}`;
    await copyFile(temporary, path.join(imageDir, id));
    return {id, url: `/quote-images/${id}`, size};
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function deleteQuoteImage(id) {
  if (!imageName.test(id)) throw new Error('Tên ảnh không hợp lệ.');
  await unlink(path.join(imageDir, id));
}

export async function copyQuoteImage(id, runId) {
  if (!imageName.test(id) || !/^\d{4}-\d{2}-\d{2}T[\d-]+Z-q\d+$/.test(runId)) {
    throw new Error('Ảnh hoặc phiên Quote không hợp lệ.');
  }
  const extension = path.extname(id);
  const destinationDir = path.join(publicDir, 'runs', runId);
  await mkdir(destinationDir, {recursive: true});
  const destination = path.join(destinationDir, `quote-image${extension}`);
  await copyFile(path.join(imageDir, id), destination);
  return `runs/${runId}/quote-image${extension}`;
}
