import {createWriteStream} from 'node:fs';
import {copyFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {randomInt, randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {publicDir, root} from './common.mjs';

const musicName = /^[^\\/\x00-\x1f<>:"|?*]+\.(mp3|wav|m4a)$/i;
const musicKinds = new Set(['ranking', 'quote', 'luxury']);
const selectionQueues = new Map();
const libraryQueues = new Map();
let migration;
const execFileAsync = promisify(execFile);

function musicKind(kind) {
  if (!musicKinds.has(kind)) throw new Error('Kiểu kho nhạc không hợp lệ.');
  return kind;
}

const musicDir = kind => path.join(publicDir, `${musicKind(kind)}-music`);
const selectionFile = kind => path.join(root, '.tmp', `music-selection-${musicKind(kind)}.json`);
const libraryFile = kind => path.join(root, '.tmp', `music-library-${musicKind(kind)}.json`);

async function ensureMusicLibraries() {
  if (!migration) migration = (async () => {
    await Promise.all([...musicKinds].map(kind => mkdir(musicDir(kind), {recursive: true})));
    const legacy = (await readdir(publicDir, {withFileTypes: true}))
      .filter(entry => entry.isFile() && musicName.test(entry.name));
    for (const kind of musicKinds) {
      const marker = path.join(musicDir(kind), '.migrated-v2');
      try { await stat(marker); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const entry of kind === 'luxury' ? [] : legacy) {
        const target = path.join(musicDir(kind), entry.name);
        try { await stat(target); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await copyFile(path.join(publicDir, entry.name), target);
        }
      }
      const oldWeights = path.join(root, '.tmp', 'music-library.json');
      try { await stat(libraryFile(kind)); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (kind !== 'luxury') {
          try { await copyFile(oldWeights, libraryFile(kind)); }
          catch (copyError) { if (copyError.code !== 'ENOENT') throw copyError; }
        }
      }
      await writeFile(marker, 'v2');
    }
  })().catch(error => { migration = null; throw error; });
  return migration;
}

export async function listMusic(kind = 'ranking') {
  await ensureMusicLibraries();
  return (await readdir(musicDir(kind), {withFileTypes: true}))
    .filter(entry => entry.isFile() && musicName.test(entry.name))
    .map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'vi'));
}

async function readWeights(kind) {
  try {
    const data = JSON.parse(await readFile(libraryFile(kind), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function validWeight(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

export async function listMusicTracks(kind = 'ranking') {
  const [names, weights] = await Promise.all([listMusic(kind), readWeights(kind)]);
  return Promise.all(names.map(async name => {
    const info = await stat(path.join(musicDir(kind), name));
    return {name, weight: validWeight(weights[name]) ? weights[name] : 1,
      size: info.size, url: `/music/${kind}/${encodeURIComponent(name)}`};
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

export async function chooseMusic(kind = 'ranking') {
  musicKind(kind);
  const selection = (selectionQueues.get(kind) || Promise.resolve()).then(async () => {
    const tracks = await listMusicTracks(kind);
    let state = {};
    try { state = JSON.parse(await readFile(selectionFile(kind), 'utf8')); }
    catch { /* First selection or stale state. */ }
    const name = selectWeightedMusic(tracks, state.last);
    if (!name) return null;
    await mkdir(path.dirname(selectionFile(kind)), {recursive: true});
    await writeFile(selectionFile(kind), JSON.stringify({last: name, selectedAt: new Date().toISOString()}, null, 2));
    return {path: `${kind}-music/${name}`, original: name};
  });
  selectionQueues.set(kind, selection.catch(() => {}));
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
  await ensureMusicLibraries();
  const file = path.join(musicDir('quote'), name);
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

function queueLibraryChange(kind, change) {
  const result = (libraryQueues.get(kind) || Promise.resolve()).then(change);
  libraryQueues.set(kind, result.catch(() => {}));
  return result;
}

async function saveWeights(kind, weights) {
  const file = libraryFile(kind);
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(weights, null, 2));
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function setMusicWeight(name, weight, kind = 'ranking') {
  if (!musicName.test(name) || !validWeight(weight)) throw new Error('Tên nhạc hoặc trọng số không hợp lệ (0–10).');
  return queueLibraryChange(kind, async () => {
    if (!(await listMusic(kind)).includes(name)) throw new Error('Không tìm thấy bài nhạc.');
    const weights = await readWeights(kind);
    weights[name] = weight;
    await saveWeights(kind, weights);
    return {name, weight};
  });
}

export async function deleteMusic(name, kind = 'ranking') {
  if (!musicName.test(name)) throw new Error('Tên nhạc không hợp lệ.');
  return queueLibraryChange(kind, async () => {
    if (!(await listMusic(kind)).includes(name)) throw new Error('Không tìm thấy bài nhạc.');
    await unlink(path.join(musicDir(kind), name));
    const weights = await readWeights(kind);
    delete weights[name];
    await saveWeights(kind, weights);
  });
}

function audioHeaderMatches(header, extension) {
  if (extension === '.wav') return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE';
  if (extension === '.m4a') return header.toString('ascii', 4, 8) === 'ftyp';
  return header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
}

export async function uploadMusic(req, originalName, kind = 'ranking') {
  const base = path.basename(String(originalName || '').normalize('NFC')).replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').trim();
  if (!musicName.test(base)) throw new Error('Chỉ nhận file MP3, WAV hoặc M4A.');
  const extension = path.extname(base).toLowerCase();
  if (!base.slice(0, -extension.length).trim()) throw new Error('Tên bài nhạc không hợp lệ.');
  await ensureMusicLibraries();
  const temporary = path.join(musicDir(kind), `${randomUUID()}.upload`);
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
    return await queueLibraryChange(kind, async () => {
      const existing = new Set((await listMusic(kind)).map(name => name.toLocaleLowerCase('vi')));
      const stem = base.slice(0, -extension.length).slice(0, 150);
      let name = `${stem}${extension}`;
      for (let number = 2; existing.has(name.toLocaleLowerCase('vi')); number++) name = `${stem} (${number})${extension}`;
      await rename(temporary, path.join(musicDir(kind), name));
      return {name, weight: 1, size, url: `/music/${kind}/${encodeURIComponent(name)}`};
    });
  } finally { await unlink(temporary).catch(() => {}); }
}
