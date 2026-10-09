import {stat, unlink} from 'node:fs/promises';
import path from 'node:path';
import {checkR2Connection, listLocalMedia, r2Enabled, uploadLocalMedia} from './storage.mjs';
import {root} from './common.mjs';

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const force = args.has('--force');
const removeLocal = args.has('--remove-local');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function transientUploadError(error) {
  const messages = [];
  for (let current = error; current; current = current.cause) {
    messages.push(current.code, current.name, current.message, current?.$metadata?.httpStatusCode);
  }
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|Timeout|socket hang up|SlowDown|InternalError|\b50[0234]\b/i
    .test(messages.filter(Boolean).join(' '));
}

async function uploadWithRetry(file, options) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { return await uploadLocalMedia(file, options); }
    catch (error) {
      lastError = error;
      if (attempt === 5 || !transientUploadError(error)) throw error;
      const seconds = Math.min(30, 2 ** attempt);
      console.warn(`R2 tạm mất kết nối · thử lại ${attempt}/5 sau ${seconds}s · ${path.relative(process.cwd(), file)}`);
      await delay(seconds * 1000);
    }
  }
  throw lastError;
}

if (!r2Enabled()) throw new Error('Đặt MEDIA_STORAGE=r2 trong .env trước khi dùng R2.');
const destination = await checkR2Connection();
console.log(`Đã kết nối R2: ${destination.bucket}/${destination.prefix}`);

if (!checkOnly) {
  if (removeLocal && process.env.R2_ALLOW_REMOVE_LOCAL_AFTER_SYNC !== 'true') {
    throw new Error('Để xóa bản local sau khi upload, đặt R2_ALLOW_REMOVE_LOCAL_AFTER_SYNC=true và chạy lại với --remove-local.');
  }
  const files = await listLocalMedia();
  const concurrency = Math.min(8, Math.max(1, Number(process.env.R2_SYNC_CONCURRENCY || 4) || 4));
  let uploaded = 0;
  let skipped = 0;
  let removed = 0;
  let bytes = 0;
  let completed = 0;
  let nextIndex = 0;
  let fatalError = null;
  console.log(`Tìm thấy ${files.length} file phương tiện local · ${concurrency} luồng upload.`);
  const worker = async () => {
    while (!fatalError) {
      const index = nextIndex++;
      if (index >= files.length) return;
      const file = files[index];
      try {
        const info = await stat(file);
        const label = path.relative(process.cwd(), file);
        const result = await uploadWithRetry(file, {force, partConcurrency: 1});
        if (result.status === 'uploaded') uploaded++;
        else skipped++;
        bytes += info.size;
        const projectPath = path.relative(root, file).split(path.sep).join('/');
        if (removeLocal && projectPath.startsWith('output/')) {
          await unlink(file);
          removed++;
        }
        completed++;
        console.log(`[${completed}/${files.length}] ${result.status === 'uploaded' ? 'đã upload' : 'đã có'} ${label}`);
      } catch (error) {
        fatalError = new Error(`${path.relative(process.cwd(), file)}: ${error.message}`, {cause: error});
      }
    }
  };
  await Promise.allSettled(Array.from({length: concurrency}, worker));
  if (fatalError) throw fatalError;
  console.log(`Hoàn tất: upload ${uploaded}, bỏ qua ${skipped}, xóa ${removed} video trong output/, đã kiểm tra ${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB.`);
}
