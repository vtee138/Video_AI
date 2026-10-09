import 'node:process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ask, root, saveJson} from './common.mjs';
import {brainstorm, research, writeStory} from './ai.mjs';
import {normalizeResearch, checkSources} from './facts.mjs';
import {chooseMusic, listMusic} from './media.mjs';
import {downloadFootage, findFootage} from './stock.mjs';
import {renderVideo} from './render.mjs';
import {rankingCaption} from './caption.mjs';

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim() || await ask('Nhập chủ đề ranking: ');
  if (!prompt) throw new Error('Cần nhập chủ đề.');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(root, '.tmp', runId);
  await mkdir(runDir, {recursive: true});
  console.log('Đang lên ý tưởng...');
  const ideas = await brainstorm(prompt);
  await saveJson(path.join(runDir, 'ideas.json'), ideas);
  const statusText = {actual: 'số công bố', estimate: 'ước tính', forecast: 'dự báo'};
  ideas.forEach((idea, i) => console.log(`${i + 1}. ${idea.title}\n   ${idea.whyInteresting} · Dữ liệu: ${idea.latestPeriod} (${statusText[idea.dataStatus]})`));
  const answer = await ask(`Chọn ý tưởng (Enter = 1, hoặc 1-${ideas.length}): `);
  const selection = answer ? Number(answer) : 1;
  if (!Number.isInteger(selection) || selection < 1 || selection > ideas.length) throw new Error('Lựa chọn không hợp lệ.');
  const idea = ideas[selection - 1];
  console.log('Đang tìm dữ liệu có nguồn...');
  const raw = await research(idea);
  await saveJson(path.join(runDir, 'research.json'), raw);
  const facts = normalizeResearch(raw);
  await checkSources(facts);
  await saveJson(path.join(runDir, 'fact-bundle.json'), facts);
  console.log(`\n${facts.title} — ${facts.metricName} (${facts.metricPeriod})`);
  facts.top10.forEach(x => console.log(`#${x.rank} ${x.entity}: ${x.displayValue} — ${x.sourceUrl}`));
  const approved = (await ask('Kiểm tra số liệu/nguồn rồi gõ yes để render: ')).toLowerCase();
  if (approved !== 'yes') { console.log(`Đã giữ kết quả nghiên cứu tại ${runDir}`); return; }
  console.log('Đang viết lời và chọn footage...');
  const story = await writeStory(facts, idea, await listMusic());
  await saveJson(path.join(runDir, 'story.json'), story);
  const caption = rankingCaption(story);
  await writeFile(path.join(runDir, 'caption.txt'), caption, 'utf8');
  const {candidates, warnings} = await findFootage(story.backgroundQueries);
  await saveJson(path.join(runDir, 'footage-candidates.json'), candidates.map(({downloadUrl, previewUrl, ...item}) => item));
  candidates.forEach((item, index) => console.log(`${index + 1}. [${item.provider}] ${item.subject} · ${item.duration}s · ${item.sourceUrl}`));
  if (warnings.length) console.log(`${warnings.length} lượt tìm kiếm footage không hoàn tất.`);
  if (candidates.length < 8) throw new Error(`Chỉ có ${candidates.length} clip gợi ý; cần ít nhất 8. Dùng giao diện web để thêm MP4 local.`);
  const picks = await ask('Chọn 8–20 số clip, cách nhau bằng dấu phẩy (Enter = 8 clip đầu): ');
  const indices = picks ? picks.split(',').map(value => Number(value.trim()) - 1) : candidates.slice(0, 8).map((_, index) => index);
  if (indices.length < 8 || indices.length > 20 || new Set(indices).size !== indices.length ||
      indices.some(index => !Number.isInteger(index) || index < 0 || index >= candidates.length)) {
    throw new Error('Cần chọn 8–20 clip khác nhau từ danh sách.');
  }
  const clips = await downloadFootage(indices.map(index => candidates[index]), runId);
  const music = await chooseMusic();
  if (music) console.log(`Nhạc nền: ${music.original}`);
  else console.log('Chưa có nhạc trong public; video sẽ không có nhạc nền.');
  const detectedCountries = facts.top10.filter(item => item.countryCode).length;
  const spec = {width: 1080, height: 1920, fps: 30, duration: 30,
    title: story.title, subtitle: story.subtitle,
    entityType: detectedCountries >= 7 ? 'country' : story.entityType,
    rows: facts.top10.map(({rank, entity, displayValue, countryCode}) => ({rank, entity, displayValue, countryCode})),
    backgroundClips: clips.map(x => x.path), musicPath: music?.path || null,
    sourceText: `${facts.top10[0].sourceTitle} · ${facts.metricPeriod}`};
  await saveJson(path.join(runDir, 'video-spec.json'), spec);
  await saveJson(path.join(runDir, 'media-sources.json'), clips);
  const file = await renderVideo(spec, runId);
  console.log(`MP4: ${file}`);
  console.log(`Caption: ${path.join(runDir, 'caption.txt')}`);
  console.log(`Nguồn dữ liệu và video: ${runDir}`);
}

main().catch(error => { console.error(`Lỗi: ${error.message}`); process.exitCode = 1; });
