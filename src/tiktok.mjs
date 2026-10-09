import {open, stat} from 'node:fs/promises';
import path from 'node:path';
import {ask, requireEnv} from './common.mjs';

const api = 'https://open.tiktokapis.com';
const label = {PUBLIC_TO_EVERYONE: 'Công khai', MUTUAL_FOLLOW_FRIENDS: 'Bạn bè', FOLLOWER_OF_CREATOR: 'Người theo dõi', SELF_ONLY: 'Chỉ mình tôi'};

async function request(endpoint, token, body) {
  const response = await fetch(`${api}${endpoint}`, {method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8'},
    ...(body ? {body: JSON.stringify(body)} : {})});
  const json = await response.json();
  if (!response.ok || json.error?.code !== 'ok') throw new Error(`TikTok ${endpoint}: ${json.error?.code || response.status} ${json.error?.message || ''}`);
  return json.data;
}

const yes = async (question) => /^(y|yes|có)$/i.test(await ask(`${question} (y/N): `));

async function main() {
  const file = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || path.extname(file).toLowerCase() !== '.mp4') throw new Error('Cách dùng: npm run post -- output/video.mp4');
  const size = (await stat(file)).size;
  if (size === 0) throw new Error('File MP4 rỗng.');
  const token = requireEnv('TIKTOK_ACCESS_TOKEN');
  const info = await request('/v2/post/publish/creator_info/query/', token);
  if (info.max_video_post_duration_sec < 30) throw new Error('Tài khoản TikTok không hỗ trợ video 30 giây.');
  console.log(`Tài khoản: @${info.creator_username} (${info.creator_nickname})`);
  const title = await ask('Caption TikTok (có thể kèm hashtag): ');
  if (!title || title.length > 2200) throw new Error('Caption phải có nội dung và tối đa 2200 ký tự.');
  const options = info.privacy_level_options || [];
  options.forEach((option, index) => console.log(`${index + 1}. ${label[option] || option}`));
  const selected = Number(await ask(`Chọn quyền riêng tư (1-${options.length}): `));
  if (!Number.isInteger(selected) || selected < 1 || selected > options.length) throw new Error('Quyền riêng tư không hợp lệ.');
  const privacy = options[selected - 1];
  const allowComment = !info.comment_disabled && await yes('Cho phép bình luận?');
  const allowDuet = !info.duet_disabled && await yes('Cho phép Duet?');
  const allowStitch = !info.stitch_disabled && await yes('Cho phép Stitch?');
  console.log(`Sắp đăng ${path.basename(file)} (${(size / 1048576).toFixed(1)} MB) lên @${info.creator_username}, chế độ ${label[privacy] || privacy}.`);
  if (!(await yes('Bạn đồng ý gửi và đăng video này lên TikTok?'))) { console.log('Đã hủy.'); return; }
  const chunkSize = size <= 64000000 ? size : 10000000;
  const count = size <= 64000000 ? 1 : Math.floor(size / chunkSize);
  if (count < 1 || count > 1000) throw new Error('Dung lượng video ngoài giới hạn upload TikTok.');
  const initialized = await request('/v2/post/publish/video/init/', token, {
    post_info: {title, privacy_level: privacy, disable_comment: !allowComment, disable_duet: !allowDuet,
      disable_stitch: !allowStitch, video_cover_timestamp_ms: 1000, is_aigc: true},
    source_info: {source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count},
  });
  if (!initialized.upload_url) throw new Error('TikTok không trả upload_url.');
  const handle = await open(file, 'r');
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const length = i === count - 1 ? size - start : chunkSize;
      const bytes = Buffer.alloc(length);
      let received = 0;
      while (received < length) {
        const result = await handle.read(bytes, received, length - received, start + received);
        if (result.bytesRead === 0) throw new Error('Không đọc đủ dữ liệu MP4.');
        received += result.bytesRead;
      }
      const response = await fetch(initialized.upload_url, {method: 'PUT', headers: {
        'Content-Type': 'video/mp4', 'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${start + length - 1}/${size}`}, body: bytes});
      if (!response.ok) throw new Error(`TikTok upload chunk ${i + 1}/${count}: HTTP ${response.status} ${await response.text()}`);
      console.log(`Đã tải lên chunk ${i + 1}/${count}`);
    }
  } finally { await handle.close(); }
  console.log(`Đã gửi video. Publish ID: ${initialized.publish_id}`);
  console.log('TikTok có thể tiếp tục xử lý và xét duyệt; kiểm tra trong tài khoản trước khi coi là đã xuất bản.');
}

main().catch(error => { console.error(`Lỗi: ${error.message}`); process.exitCode = 1; });
