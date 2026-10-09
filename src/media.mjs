import {createWriteStream} from 'node:fs';
import {mkdir, open, readFile, readdir, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {randomInt, randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {publicDir, root} from './common.mjs';

const musicStateFile = path.join(root, '.tmp', 'music-selection.json');
const musicLibraryFile = path.join(root, '.tmp', 'music-library.json');
const musicName = /^[^\\/\x00-\x1f<>:"|?*]+\.(mp3|wav|m4a)$/i;
let musicSelectionQueue = Promise.resolve();
let musicLibraryQueue = Promise.resolve();
const execFileAsync = promisify(execFile);

export async function listMusic() {
  return (await readdir(publicDir, {withFileTypes: true}))
    .filter(entry => entry.isFile() && musicName.test(entry.name))
    .map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'vi'));
}

async function readWeights() {
  try {
    const data = JSON.parse(await readFile(musicLibraryFile, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function validWeight(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

export async function listMusicTracks() {
  const [names, weights] = await Promise.all([listMusic(), readWeights()]);
  return Promise.all(names.map(async name => {
    const info = await stat(path.join(publicDir, name));
    return {name, weight: validWeight(weights[name]) ? weights[name] : 1,
      size: info.size, url: `/music/${encodeURIComponent(name)}`};
  }));
}

export function selectWeightedMusic(tracks, previousName = '', pickIndex = size => randomInt(size)) {
  const enabled = tracks.filter(track => validWeight(track.weight) && track.weight > 0);
  if (!enabled.length) return null;
  const candidates = enabled.length > 1
    ? enabled.filter(track => track.name !== previousName) : enabled;
  const pool = candidates.length ? candidates : enabled;
  const total = pool.reduce((sum, track) => sum + track.weight, 0);
  let index = pickIndex(total);
  for (const track of pool) {
    index -= track.weight;
    if (index < 0) return track.name;
  }
  throw new Error('Giá trị chọn nhạc không hợp lệ.');
}

export async function chooseMusic() {
  const selection = musicSelectionQueue.then(async () => {
    const tracks = await listMusicTracks();
    let state = {};
    try { state = JSON.parse(await readFile(musicStateFile, 'utf8')); }
    catch { /* First selection or stale state. */ }
    const name = selectWeightedMusic(tracks, state.last);
    if (!name) return null;
    await mkdir(path.dirname(musicStateFile), {recursive: true});
    await writeFile(musicStateFile, JSON.stringify({last: name, selectedAt: new Date().toISOString()}, null, 2));
    return {path: name, original: name};
  });
  musicSelectionQueue = selection.catch(() => {});
  return selection;
}

export function quietQuoteEnding(pcm, sampleRate = 8000) {
  const windows = [];
  for (let second = 30; second <= 40; second++) {
    const first = Math.round((second - 30) * sampleRate);
    const count = Math.round(sampleRate / 2);
    if ((first + count) * 2 > pcm.length) break;
    let power = 0;
    for (let index = first; index < first + count; index++) {
      const sample = pcm.readInt16LE(index * 2) / 32768;
      power += sample * sample;
    }
    windows.push({second, rms: Math.sqrt(power / count)});
  }
  if (!windows.length) return 35;
  const sorted = windows.map(window => window.rms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0.001;
  return windows.reduce((best, current) => {
    const score = current.rms / median + Math.abs(current.second - 35) * 0.06;
    return score < best.score ? {...current, score} : best;
  }, {second: 35, score: Infinity}).second;
}

export async function quoteMusicTiming(name) {
  if (!musicName.test(name)) throw new Error('Tên nhạc Quote không hợp lệ.');
  const file = path.join(publicDir, name);
  const probe = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file], {timeout: 15000});
  const seconds = Number(String(probe.stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Không đọc được thời lượng nhạc ${name}.`);
  if (seconds <= 40) return {seconds, quietEnding: null};
  try {
    const decoded = await execFileAsync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', '29.5',
      '-i', file, '-t', '11', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
    {encoding: 'buffer', maxBuffer: 1_000_000, timeout: 30000});
    return {seconds, quietEnding: quietQuoteEnding(decoded.stdout)};
  } catch (error) {
    console.warn(`Không phân tích được nhịp nhạc Quote (${name}): ${error.message}`);
    return {seconds, quietEnding: 35};
  }
}

function queueLibraryChange(change) {
  const result = musicLibraryQueue.then(change);
  musicLibraryQueue = result.catch(() => {});
  return result;
}

async function saveWeights(weights) {
  await mkdir(path.dirname(musicLibraryFile), {recursive: true});
  const temporary = `${musicLibraryFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(weights, null, 2));
    await rename(temporary, musicLibraryFile);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function setMusicWeight(name, weight) {
  if (!musicName.test(name) || !validWeight(weight)) throw new Error('Tên nhạc hoặc trọng số không hợp lệ (0–10).');
  return queueLibraryChange(async () => {
    if (!(await listMusic()).includes(name)) throw new Error('Không tìm thấy bài nhạc.');
    const weights = await readWeights();
    weights[name] = weight;
    await saveWeights(weights);
    return {name, weight};
  });
}

export async function deleteMusic(name) {
  if (!musicName.test(name)) throw new Error('Tên nhạc không hợp lệ.');
  return queueLibraryChange(async () => {
    if (!(await listMusic()).includes(name)) throw new Error('Không tìm thấy bài nhạc.');
    await unlink(path.join(publicDir, name));
    const weights = await readWeights();
    delete weights[name];
    await saveWeights(weights);
  });
}

function audioHeaderMatches(header, extension) {
  if (extension === '.wav') return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE';
  if (extension === '.m4a') return header.toString('ascii', 4, 8) === 'ftyp';
  return header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
}

export async function uploadMusic(req, originalName) {
  const base = path.basename(String(originalName || '').normalize('NFC')).replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').trim();
  if (!musicName.test(base)) throw new Error('Chỉ nhận file MP3, WAV hoặc M4A.');
  const extension = path.extname(base).toLowerCase();
  if (!base.slice(0, -extension.length).trim()) throw new Error('Tên bài nhạc không hợp lệ.');
  await mkdir(publicDir, {recursive: true});
  const temporary = path.join(publicDir, `${randomUUID()}.upload`);
  let size = 0;
  try {
    await pipeline(req, new Transform({transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > 100_000_000 ? new Error('Mỗi file nhạc tối đa 100 MB.') : null, chunk);
    }}), createWriteStream(temporary));
    if (!size) throw new Error('File nhạc tải lên bị rỗng.');
    const handle = await open(temporary, 'r');
    const header = Buffer.alloc(12);
    try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
    if (!audioHeaderMatches(header, extension)) throw new Error('Nội dung file không khớp định dạng nhạc.');
    return await queueLibraryChange(async () => {
      const existing = new Set((await listMusic()).map(name => name.toLocaleLowerCase('vi')));
      const stem = base.slice(0, -extension.length).slice(0, 150);
      let name = `${stem}${extension}`;
      for (let number = 2; existing.has(name.toLocaleLowerCase('vi')); number++) name = `${stem} (${number})${extension}`;
      await rename(temporary, path.join(publicDir, name));
      return {name, weight: 1, size, url: `/music/${encodeURIComponent(name)}`};
    });
  } finally { await unlink(temporary).catch(() => {}); }
}
