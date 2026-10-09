import {mkdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import {root} from './common.mjs';

const profile = path.join(root, '.cache', 'flow-browser');
const chrome = process.env.FLOW_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let contextPromise;
const exec = promisify(execFile);

async function context() {
  if (!contextPromise) {
    contextPromise = chromium.launchPersistentContext(profile, {
      executablePath: chrome, headless: false, viewport: null,
      acceptDownloads: true, args: ['--start-maximized'],
    }).then(value => {
      value.on('close', () => { contextPromise = null; });
      return value;
    }).catch(error => { contextPromise = null; throw error; });
  }
  return contextPromise;
}

async function visible(locator, timeout = 1500) {
  try { return await locator.first().isVisible({timeout}); } catch { return false; }
}

async function clickFirst(page, candidates) {
  for (const locator of candidates) {
    if (await visible(locator)) { await locator.first().click({timeout: 5000}); return true; }
  }
  return false;
}

async function prepare(page) {
  await page.goto('https://flow.google.com/', {waitUntil: 'domcontentloaded', timeout: 45_000});
  if (page.url().includes('/about')) {
    await clickFirst(page, [page.getByRole('button', {name: /Create with Google Flow|Try Google Flow|Get started/i}),
      page.getByRole('link', {name: /Create with Google Flow|Try Google Flow|Get started/i})]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  if (/accounts\.google\.com|signin|login/i.test(page.url())) {
    const error = new Error('Hãy đăng nhập Google trong cửa sổ Chrome của Flow, sau đó bấm thử lại trong app.');
    error.code = 'FLOW_AUTH';
    throw error;
  }
}

export async function openFlowBrowser() {
  const browser = await context();
  const page = browser.pages()[0] || await browser.newPage();
  try { await prepare(page); return {ready: true, url: page.url()}; }
  catch (error) {
    if (error.code === 'FLOW_AUTH') return {ready: false, authRequired: true, url: page.url()};
    throw error;
  }
}

async function debug(page, directory) {
  await mkdir(directory, {recursive: true});
  await page.screenshot({path: path.join(directory, 'flow-debug.png'), fullPage: false}).catch(() => {});
  const controls = await page.locator('button, [role="button"], input, textarea, [contenteditable="true"]')
    .evaluateAll(nodes => nodes.slice(0, 150).map(node => ({tag: node.tagName,
      text: (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').slice(0, 120),
      type: node.getAttribute('type')}))).catch(() => []);
  await writeFile(path.join(directory, 'flow-debug.json'), JSON.stringify({url: page.url(), controls}, null, 2));
}

async function openProject(page) {
  if (!await clickFirst(page, [page.getByRole('button', {name: /^(?:\+?\s*New|New project|Create project|Dự án mới|Tạo dự án)$/i}),
    page.getByRole('link', {name: /^(?:\+?\s*New|New project|Create project|Dự án mới|Tạo dự án)$/i})]))
    throw new Error('Không mở được dự án mới trên Flow.');
}

async function selectMode(page, mode) {
  const names = mode === 'image' ? /Images|Image|Hình ảnh|Ảnh/i : /Videos|Video/i;
  await clickFirst(page, [page.getByRole('button', {name: names}), page.getByRole('tab', {name: names}),
    page.getByText(names, {exact: true})]);
}

async function uploadReferences(page, files) {
  const valid = files.filter(Boolean);
  if (!valid.length) return;
  await clickFirst(page, [page.getByRole('button', {name: /Add media|Add ingredient|Upload|Thêm phương tiện|Tải lên|Ingredients/i}),
    page.getByText(/Add media|Upload files|Tải lên/i, {exact: true})]);
  const inputs = page.locator('input[type="file"]');
  if (!await inputs.count()) throw new Error('Flow chưa hiển thị vùng tải ảnh tham chiếu.');
  for (const file of valid) {
    await inputs.last().setInputFiles(file);
    await page.waitForTimeout(1200);
  }
}

async function promptAndGenerate(page, prompt) {
  const editor = page.locator('textarea:visible, [contenteditable="true"]:visible, [role="textbox"]:visible').last();
  if (!await visible(editor)) throw new Error('Không tìm thấy ô prompt trong Flow.');
  await editor.fill(prompt);
  if (!await clickFirst(page, [page.getByRole('button', {name: /^(?:Generate|Tạo)(?: Image| Video| ảnh| video)?$/i}).last(),
    page.locator('button[aria-label*="Generate"], button[aria-label*="Create"]')]))
    throw new Error('Không tìm thấy nút Generate trong Flow.');
}

function downloadCount(page) {
  return Promise.all([page.getByRole('button', {name: /Download|Tải xuống/i}).count(),
    page.getByRole('link', {name: /Download|Tải xuống/i}).count()]).then(values => values[0] + values[1]);
}

async function downloadResult(page, extension, output, previousCount) {
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    if (await downloadCount(page) <= previousCount) { await page.waitForTimeout(5000); continue; }
    const downloadButtons = [page.getByRole('button', {name: /Download|Tải xuống/i}).last(),
      page.getByRole('link', {name: /Download|Tải xuống/i}).last()];
    for (const button of downloadButtons) {
      if (!await visible(button)) continue;
      const pending = page.waitForEvent('download', {timeout: 15_000}).catch(() => null);
      await button.click();
      const download = await pending;
      if (download) {
        const suggested = download.suggestedFilename().toLowerCase();
        if (suggested.endsWith(extension)) { await download.saveAs(output); return; }
        if (extension === '.png' && /\.(jpe?g|webp)$/.test(suggested)) {
          const source = `${output}${path.extname(suggested)}`;
          await download.saveAs(source);
          await exec('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source,
            '-frames:v', '1', '-y', output], {timeout: 30_000});
          return;
        }
      }
    }
    await page.waitForTimeout(5000);
  }
  throw new Error('Flow chưa có file để tải. Hãy kiểm tra kết quả trong cửa sổ Flow.');
}

async function setVideoOptions(page, hasAction) {
  await clickFirst(page, [page.getByRole('button', {name: /Model|Mô hình/i})]);
  const model = hasAction ? /Gemini Omni Flash/i : /Veo 3\.1.*Lite/i;
  if (!await clickFirst(page, [page.getByRole('option', {name: model}), page.getByText(model)]))
    throw new Error('Không xác nhận được model Flow theo hạn mức credit.');
  await clickFirst(page, [page.getByRole('button', {name: /Duration|Thời lượng/i})]);
  if (!await clickFirst(page, [page.getByRole('option', {name: /8 seconds|8 giây|8s/i}),
    page.getByText(/8 seconds|8 giây|8s/i, {exact: true})]))
    throw new Error('Không xác nhận được thời lượng 8 giây trong Flow.');
  await clickFirst(page, [page.getByRole('button', {name: /Aspect ratio|Tỷ lệ/i})]);
  if (!await clickFirst(page, [page.getByRole('option', {name: /9:16|Portrait|Vertical|Dọc/i}),
    page.getByText(/9:16|Portrait|Vertical|Dọc/i, {exact: true})]))
    throw new Error('Không xác nhận được tỷ lệ 9:16 trong Flow.');
}

async function setSingleOutput(page) {
  const combo = page.getByRole('combobox', {name: /outputs?|kết quả|số lượng/i});
  if (await visible(combo)) {
    const tag = await combo.first().evaluate(node => node.tagName);
    if (tag === 'SELECT') { await combo.first().selectOption('1'); return; }
    await combo.first().click();
  } else {
    await clickFirst(page, [page.getByRole('button', {name: /outputs?|kết quả|số lượng/i})]);
  }
  if (!await clickFirst(page, [page.getByRole('option', {name: /^1(?: output| result| video| ảnh| kết quả)?$/i}),
    page.getByRole('menuitem', {name: /^1(?: output| result| video| ảnh| kết quả)?$/i}),
    page.getByText(/^1(?: output| result| video| ảnh| kết quả)?$/i, {exact: true})]))
    throw new Error('Không xác nhận được chế độ tạo một kết quả; đã dừng để tránh dùng thêm credit.');
}

export async function composeFlowVideo(parts, target, seconds, directory) {
  const ffprobe = async file => {
    const {stdout} = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file], {timeout: 30_000});
    return Number(stdout.trim()) || 0;
  };
  const list = [...parts];
  let total = 0;
  for (const part of list) total += await ffprobe(part);
  if (!total) throw new Error('Flow trả video không có thời lượng hợp lệ.');
  while (total < seconds) { list.push(list.at(-1)); total += await ffprobe(list.at(-1)); }
  const escape = file => path.resolve(file).replace(/'/g, "'\\''").replace(/\\/g, '/');
  const manifest = path.join(directory, 'concat.txt');
  await writeFile(manifest, list.map(file => `file '${escape(file)}'`).join('\n'));
  await exec('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', manifest, '-t', String(seconds), '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', '-y', target], {timeout: 30 * 60_000});
}

async function actionSegment(source, index, directory) {
  if (!source) return null;
  const {stdout} = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', source], {timeout: 30_000});
  const duration = Number(stdout.trim());
  if (!duration) throw new Error('Clip hành động không có thời lượng hợp lệ.');
  if (duration <= 8) return source;
  const start = Math.min(index * 8, Math.max(0, duration - 8));
  const target = path.join(directory, `action-segment-${index + 1}.mp4`);
  await exec('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(start),
    '-i', source, '-t', '8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-y', target], {timeout: 5 * 60_000});
  return target;
}

function imagePrompt(job) {
  return `Create a photorealistic full-body fashion image of one adult female model wearing the exact ${job.category || 'garment'} in the product reference. Preserve garment cut, fabric, color, print, seams, silhouette and length. Use the selected background reference as the setting. ${job.modelId ? 'Use the woman in the model reference consistently.' : 'The model must look like a real adult woman.'} Vertical 9:16 fashion video keyframe, natural anatomy, realistic fabric drape, clean studio lighting, no text, no logos added, no extra people.`;
}

function videoPrompt(job) {
  return `Make a vertical 9:16 realistic fashion try-on video from the approved first frame. The adult woman gently turns and takes a few natural steps, showing the garment clearly. Keep her face, body, garment color, cut, print, hem, background and lighting consistent in every frame. ${job.hasAction ? 'Follow the movement in the uploaded action reference video.' : 'Use subtle natural movement.'} No outfit changes, no cuts, no added text.`;
}

export async function runFlowBrowser({stage, job, garment, background, model, action, still, output, directory}) {
  const browser = await context();
  const page = browser.pages()[0] || await browser.newPage();
  try {
    await prepare(page);
    if (stage === 'image') {
      await openProject(page);
      await selectMode(page, stage);
      await clickFirst(page, [page.getByRole('button', {name: /Model|Mô hình/i})]);
      if (!await clickFirst(page, [page.getByRole('option', {name: /Nano Banana 2 Lite/i}),
        page.getByText(/Nano Banana 2 Lite/i)]))
        throw new Error('Không xác nhận được model ảnh Nano Banana 2 Lite miễn phí.');
      await setSingleOutput(page);
      await uploadReferences(page, [garment, background, model]);
      const previousCount = await downloadCount(page);
      await promptAndGenerate(page, imagePrompt(job));
      await downloadResult(page, '.png', output, previousCount);
    } else {
      if (!still) throw new Error('Chưa có ảnh thử đồ đã duyệt.');
      const parts = [];
      const required = Math.ceil(job.duration / 8);
      let newParts = 0;
      for (let index = 0; index < required; index++) {
        const part = path.join(directory, `segment-${index + 1}.mp4`);
        if (await stat(part).then(info => info.size > 0).catch(() => false)) {
          parts.push(part);
          continue;
        }
        await openProject(page);
        await selectMode(page, 'video');
        await setVideoOptions(page, !!action);
        await setSingleOutput(page);
        await uploadReferences(page, [still, await actionSegment(action, index, directory)]);
        const previousCount = await downloadCount(page);
        await promptAndGenerate(page, `${videoPrompt(job)} Shot ${index + 1}: ${['front view and gentle pose','small turn to show the side','walk slowly toward camera','turn back toward camera'][index % 4]}.`);
        await downloadResult(page, '.mp4', part, previousCount);
        parts.push(part);
        newParts++;
        if (action && !job.continuousVideo && index < required - 1)
          return {pause: true, generatedSegments: newParts};
      }
      await composeFlowVideo(parts, output, job.duration, directory);
    }
  } catch (error) {
    await debug(page, directory);
    throw error;
  }
}
