import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {root} from './common.mjs';
import {downloadDatabaseBackup, uploadDatabaseBackup} from './storage.mjs';

const action = process.argv[2];
const database = String(process.env.DB_RESTORE_DATABASE || process.env.POSTGRES_DB || 'video_studio');
const user = String(process.env.POSTGRES_USER || 'video_studio');
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(user)) {
  throw new Error('Tên PostgreSQL database hoặc user không hợp lệ.');
}

async function docker(args, {inputFile = null, outputFile = null} = {}) {
  const child = spawn('docker', ['compose', ...args], {cwd: root, windowsHide: true,
    stdio: [inputFile ? 'pipe' : 'ignore', outputFile ? 'pipe' : 'inherit', 'pipe']});
  let errorText = '';
  child.stderr.on('data', chunk => { errorText += chunk.toString(); });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(
      `Docker Compose thất bại (${code}): ${errorText.trim() || 'không có chi tiết'}`)));
  });
  const streams = [];
  if (inputFile) streams.push(pipeline(createReadStream(inputFile), child.stdin));
  if (outputFile) streams.push(pipeline(child.stdout, createWriteStream(outputFile)));
  await Promise.all([closed, ...streams]);
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'video-studio-postgres-'));
const temporary = path.join(temporaryDirectory, 'database.dump');

try {
  if (action === 'backup') {
    await docker(['up', '-d', '--wait', 'postgres']);
    await docker(['exec', '-T', 'postgres', 'pg_dump', '-U', user, '-d',
      process.env.POSTGRES_DB || 'video_studio', '--format=custom', '--compress=6',
      '--no-owner', '--no-privileges'], {outputFile: temporary});
    const info = await stat(temporary);
    if (!info.size) throw new Error('pg_dump tạo file rỗng.');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versioned = await uploadDatabaseBackup(temporary, {name: `${timestamp}.dump`});
    const latest = await uploadDatabaseBackup(temporary);
    console.log(`Đã backup toàn bộ PostgreSQL lên R2: ${latest.key} (${(latest.size / 1024 / 1024).toFixed(2)} MB).`);
    console.log(`Bản lưu theo thời gian: ${versioned.key}`);
  } else if (action === 'restore') {
    await docker(['up', '-d', '--wait', 'postgres']);
    const backup = await downloadDatabaseBackup(temporary);
    const mainDatabase = database === String(process.env.POSTGRES_DB || 'video_studio');
    if (mainDatabase) await docker(['stop', 'app']);
    try {
      await docker(['exec', '-T', 'postgres', 'pg_restore', '-U', user, '-d', database,
        '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error'], {inputFile: temporary});
    } finally {
      if (mainDatabase) await docker(['up', '-d', '--wait', 'app']);
    }
    console.log(`Đã restore toàn bộ PostgreSQL từ R2: ${backup.key}.`);
  } else {
    throw new Error('Cách dùng: node src/db-transfer.mjs backup|restore');
  }
} finally {
  await rm(temporaryDirectory, {recursive: true, force: true}).catch(() => {});
}
