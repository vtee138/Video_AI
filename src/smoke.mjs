import path from 'node:path';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderStill, renderMedia} from '@remotion/renderer';
import {root, publicDir} from './common.mjs';
import {listMusic} from './media.mjs';
import {listQuoteImages} from './quote-images.mjs';

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;

const music = (await listMusic())[0] || null;
let quoteImage = (await listQuoteImages())[0]?.url.slice(1);
if (!quoteImage) {
  quoteImage = 'runs/smoke/quote-image.png';
  await mkdir(path.join(publicDir, 'runs', 'smoke'), {recursive: true});
  await writeFile(path.join(publicDir, quoteImage), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
}
async function sampleClips() {
  const runsDir = path.join(publicDir, 'runs');
  try {
    const runs = (await readdir(runsDir, {withFileTypes: true})).filter(entry => entry.isDirectory());
    for (const run of runs.reverse()) {
      const files = (await readdir(path.join(runsDir, run.name))).filter(name => /\.mp4$/i.test(name)).sort();
      if (files.length) return files.slice(0, 4).map(name => `runs/${run.name}/${name}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return [];
}

const entities = ['Hoa Kỳ', 'Trung Quốc', 'Đức', 'Ấn Độ', 'Nhật Bản',
  'Vương quốc Anh', 'Pháp', 'Ý', 'Brazil', 'Canada'];
const spec = {title: 'TOP 10 NỀN KINH TẾ LỚN NHẤT', subtitle: 'GDP danh nghĩa · 2025 (ước tính)',
  entityType: 'country',
  sourceText: 'IMF World Economic Outlook · 2025',
  rows: entities.map((entity, i) => ({rank: i + 1, entity,
    countryCode: ['US', 'CN', 'DE', 'IN', 'JP', 'GB', 'FR', 'IT', 'BR', 'CA'][i],
    displayValue: `${32 - i * 2}.400 tỷ USD`})),
  backgroundClips: await sampleClips(), musicPath: music};
const serveUrl = await bundle({entryPoint: path.join(root, 'remotion', 'index.jsx'), publicDir});
const composition = await selectComposition({serveUrl, id: 'RankingVideo', inputProps: {spec}, browserExecutable});
const out = path.join(root, '.tmp', 'smoke.png');
await mkdir(path.dirname(out), {recursive: true});
await renderStill({serveUrl, composition, inputProps: {spec}, frame: 170, output: out, imageFormat: 'png', browserExecutable});
console.log(out);
const iconOut = path.join(root, '.tmp', 'smoke-icons.png');
const iconSpec = {...spec, entityType: 'company',
  rows: spec.rows.map(({countryCode: _countryCode, ...row}) => row)};
const iconComposition = await selectComposition({serveUrl, id: 'RankingVideo', inputProps: {spec: iconSpec}, browserExecutable});
await renderStill({serveUrl, composition: iconComposition, inputProps: {spec: iconSpec},
  frame: 170, output: iconOut, imageFormat: 'png', browserExecutable});
console.log(iconOut);
const mp4 = path.join(root, '.tmp', 'smoke.mp4');
await renderMedia({serveUrl, composition, inputProps: {spec}, outputLocation: mp4,
  codec: 'h264', frameRange: [150, 179], browserExecutable});
console.log(mp4);

const quoteSpecs = [
  {type: 'quote', mode: 'onscreen', title: 'Quote trên video', duration: 35,
    quoteText: 'Có những ngày bạn không cần chứng minh điều gì. Chỉ cần âm thầm tiến về phía trước, để kết quả lên tiếng thay mình.',
    hookText: '', backgroundImage: quoteImage, musicPath: music},
  {type: 'quote', mode: 'caption', title: 'Quote ở caption', duration: 35,
    quoteText: '', hookText: 'Lúc công việc khó nhất mới biết một lời hứa có giá trị đến đâu.',
    backgroundImage: quoteImage, musicPath: music},
];
for (const [index, quoteSpec] of quoteSpecs.entries()) {
  const quoteComposition = await selectComposition({serveUrl, id: 'QuoteVideo', inputProps: {spec: quoteSpec}, browserExecutable});
  const image = path.join(root, '.tmp', `smoke-quote-${index + 1}.png`);
  await renderStill({serveUrl, composition: quoteComposition, inputProps: {spec: quoteSpec},
    frame: 90, output: image, imageFormat: 'png', browserExecutable});
  console.log(image);
  const video = path.join(root, '.tmp', `smoke-quote-${index + 1}.mp4`);
  await renderMedia({serveUrl, composition: quoteComposition, inputProps: {spec: quoteSpec},
    outputLocation: video, codec: 'h264', frameRange: [30, 59], browserExecutable});
  console.log(video);
}
