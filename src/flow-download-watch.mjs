import {readdir, lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

const imageName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpe?g|webp)$/i;
const autoName = /^([0-9a-f-]{36})-(image\.(?:png|jpe?g|webp)|video-(\d+)\.mp4)$/i;
const eligible = new Set(['ready_image', 'auth_required', 'needs_attention']);
const contentType = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp'};

export async function scanFlowDownloads({directory, baseUrl = 'http://127.0.0.1:4173',
  request = fetch, now = Date.now(), handled = new Set()} = {}) {
  const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let imported = 0;
  for (const entry of entries) {
    const match = imageName.exec(entry.name);
    const automatic = autoName.exec(entry.name);
    if (!entry.isFile() || !match && !automatic) continue;
    const file = path.join(directory, entry.name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 16 ||
      info.size > (automatic?.[3] ? 250_000_000 : 20_000_000) ||
      now - info.mtimeMs < 1500) continue;
    const signature = `${entry.name}:${info.size}:${info.mtimeMs}`;
    if (handled.has(signature)) continue;
    const jobId = (match || automatic)[1];
    const jobResponse = await request(`${baseUrl}/api/flow/jobs/${jobId}`);
    if (!jobResponse.ok) { handled.add(signature); continue; }
    const {job} = await jobResponse.json();
    const isVideo = !!automatic?.[3];
    if (automatic ? job?.state !== (isVideo ? 'generating_video' : 'generating_image') :
      !eligible.has(job?.state)) { handled.add(signature); continue; }
    const body = await readFile(file);
    const response = await request(`${baseUrl}/api/flow/jobs/${jobId}/${isVideo ? 'import-segment' : 'import-image'}`, {
      method: 'POST', headers: {'Content-Type': isVideo ? 'video/mp4' :
        contentType[(match?.[2] || automatic[2].split('.')[1]).toLowerCase()]}, body,
    });
    if (!response.ok) throw new Error(`Không nhập được ảnh cho job ${jobId}: HTTP ${response.status}`);
    handled.add(signature);
    imported++;
    process.stdout.write(`Đã nhập ảnh Flow vào job ${jobId}.\n`);
  }
  return imported;
}

export async function watchFlowDownloads({directory = process.env.FLOW_DOWNLOAD_DIR ||
  path.join(os.homedir(), 'Downloads', 'flow-tryon'), baseUrl = 'http://127.0.0.1:4173',
  intervalMs = 2000} = {}) {
  const handled = new Set();
  process.stdout.write(`Đang theo dõi ảnh Flow trong ${directory}\n`);
  while (true) {
    try { await scanFlowDownloads({directory, baseUrl, handled}); }
    catch (error) { process.stderr.write(`Flow download watcher: ${error.message}\n`); }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await watchFlowDownloads();
