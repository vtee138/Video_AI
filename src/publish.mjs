import {createReadStream} from 'node:fs';
import {open, stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {zernioApiKey, zernioPost, zernioPostStatus, zernioTikTokCreator, zernioUpload} from './zernio.mjs';

const tiktokApi = 'https://open.tiktokapis.com';
const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v26.0';

export const platformNames = {tiktok: 'TikTok', facebook: 'Facebook Reels', youtube: 'YouTube Shorts'};

export function publishConfig() {
  const direct = {
    tiktok: {provider: 'direct', configured: Boolean(process.env.TIKTOK_ACCESS_TOKEN), requirement: 'TIKTOK_ACCESS_TOKEN (video.publish)'},
    facebook: {provider: 'direct', configured: Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN), requirement: 'FACEBOOK_PAGE_ACCESS_TOKEN (pages_manage_posts)'},
    youtube: {provider: 'direct', configured: Boolean(process.env.YOUTUBE_ACCESS_TOKEN ||
      (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN)),
    requirement: 'YOUTUBE_ACCESS_TOKEN hoặc YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REFRESH_TOKEN (youtube.upload)'},
  };
  for (const platform of Object.keys(platformNames)) {
    if (zernioApiKey(platform) && (platform !== 'facebook' || !direct.facebook.configured)) {
      direct[platform] = {provider: 'zernio', configured: true,
        requirement: `${platform === 'youtube' && process.env.ZERNIO_YOUTUBE_API_KEY ? 'ZERNIO_YOUTUBE_API_KEY' : 'ZERNIO_API_KEY'} và tài khoản đã kết nối trong Zernio`};
    }
  }
  return direct;
}

function token(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu ${name}. Xem .env.example.`);
  return value;
}

async function checked(response, label) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {message: raw.slice(0, 300)}; }
  if (!response.ok || data.error?.code && data.error.code !== 'ok' || data.success === false) {
    const error = data.error;
    throw new Error(`${label}: ${error?.message || data.message || error?.code || `HTTP ${response.status}`}`);
  }
  return data;
}

async function tiktokRequest(endpoint, accessToken, payload) {
  const response = await fetch(`${tiktokApi}${endpoint}`, {method: 'POST', headers: {
    Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8'},
    body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(30000)});
  const result = await checked(response, 'TikTok');
  return result.data;
}

export async function tiktokCreator(accountId) {
  if (zernioApiKey()) return zernioTikTokCreator(accountId);
  return tiktokRequest('/v2/post/publish/creator_info/query/', token('TIKTOK_ACCESS_TOKEN'));
}

export async function tiktokStatus(publishId) {
  return tiktokRequest('/v2/post/publish/status/fetch/', token('TIKTOK_ACCESS_TOKEN'), {publish_id: publishId});
}

export async function postTikTok(file, input, progress = () => {}) {
  if (zernioApiKey()) {
    const creator = await zernioTikTokCreator(input.accountId);
    if (!creator.privacy_level_options.includes(input.privacy)) {
      throw new Error('Quyền riêng tư TikTok không thuộc lựa chọn của tài khoản Zernio.');
    }
    const caption = String(input.caption || '').trim();
    if (!caption || caption.length > 2200) throw new Error('Caption TikTok cần từ 1 đến 2200 ký tự.');
    const mediaUrl = await zernioUpload(file, progress, 'tiktok', input.accountId);
    return zernioPost('tiktok', mediaUrl, input);
  }
  const accessToken = token('TIKTOK_ACCESS_TOKEN');
  const creator = await tiktokCreator();
  const privacy = String(input.privacy || '');
  if (!creator.privacy_level_options?.includes(privacy)) throw new Error('Quyền riêng tư TikTok không thuộc lựa chọn của tài khoản.');
  if (creator.max_video_post_duration_sec < 30) throw new Error('Tài khoản TikTok không hỗ trợ video 30 giây.');
  const caption = String(input.caption || '').trim();
  if (!caption || caption.length > 2200) throw new Error('Caption TikTok cần từ 1 đến 2200 ký tự.');
  const size = (await stat(file)).size;
  const chunkSize = size <= 64_000_000 ? size : 10_000_000;
  const count = size <= 64_000_000 ? 1 : Math.floor(size / chunkSize);
  if (!size || count > 1000) throw new Error('Dung lượng MP4 không hợp lệ cho TikTok.');
  const initialized = await tiktokRequest('/v2/post/publish/video/init/', accessToken, {
    post_info: {title: caption, privacy_level: privacy,
      disable_comment: creator.comment_disabled || !input.allowComment,
      disable_duet: creator.duet_disabled || !input.allowDuet,
      disable_stitch: creator.stitch_disabled || !input.allowStitch,
      video_cover_timestamp_ms: 1000, is_aigc: Boolean(input.isAigc)},
    source_info: {source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count},
  });
  if (!initialized?.upload_url || !initialized.publish_id) throw new Error('TikTok không trả thông tin upload.');
  const handle = await open(file, 'r');
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const length = i === count - 1 ? size - start : chunkSize;
      const bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const result = await handle.read(bytes, read, length - read, start + read);
        if (!result.bytesRead) throw new Error('Không đọc đủ dữ liệu MP4.');
        read += result.bytesRead;
      }
      const response = await fetch(initialized.upload_url, {method: 'PUT', headers: {
        'Content-Type': 'video/mp4', 'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${start + length - 1}/${size}`}, body: bytes,
      signal: AbortSignal.timeout(180000)});
      if (!response.ok) throw new Error(`TikTok tải lên chunk ${i + 1}/${count}: HTTP ${response.status}`);
      progress((i + 1) / count);
    }
  } finally { await handle.close(); }
  return {id: initialized.publish_id, creatorUsername: creator.creator_username,
    state: 'processing', message: 'TikTok đã nhận video và đang xử lý.'};
}

async function facebookRequest(endpoint, accessToken, fields, method = 'POST') {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${endpoint}`);
  if (method === 'GET') for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  const response = await fetch(url, {method, headers: {Authorization: `Bearer ${accessToken}`,
    ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})},
    ...(method === 'POST' ? {body: new URLSearchParams(fields)} : {}), signal: AbortSignal.timeout(30000)});
  return checked(response, 'Facebook');
}

export async function facebookStatus(id) {
  return facebookRequest(id, token('FACEBOOK_PAGE_ACCESS_TOKEN'), {fields: 'status'}, 'GET');
}

export async function postFacebook(file, input, progress = () => {}) {
  if (input.state && input.state !== 'PUBLISHED') throw new Error('Facebook Reels hiện chỉ hỗ trợ đăng ngay.');
  if (zernioApiKey('facebook') && (input.accountId || !process.env.FACEBOOK_PAGE_ACCESS_TOKEN)) {
    const mediaUrl = await zernioUpload(file, progress, 'facebook', input.accountId);
    return zernioPost('facebook', mediaUrl, input);
  }
  const accessToken = token('FACEBOOK_PAGE_ACCESS_TOKEN');
  const size = (await stat(file)).size;
  const started = await facebookRequest('me/video_reels', accessToken, {upload_phase: 'start'});
  if (!started.video_id || !started.upload_url) throw new Error('Facebook không trả thông tin upload Reel.');
  // Meta's upload URL is an API response, but restrict the destination before sending the Page token.
  const uploadUrl = new URL(started.upload_url);
  if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'rupload.facebook.com') {
    throw new Error('Facebook trả URL upload không hợp lệ.');
  }
  const response = await fetch(uploadUrl, {method: 'POST', headers: {
    Authorization: `OAuth ${accessToken}`, offset: '0', file_size: String(size),
    'Content-Type': 'application/octet-stream', 'Content-Length': String(size)},
    body: Readable.toWeb(createReadStream(file)), duplex: 'half', signal: AbortSignal.timeout(300000)});
  await checked(response, 'Facebook upload Reel');
  progress(1);
  const finished = await facebookRequest('me/video_reels', accessToken, {
    upload_phase: 'finish', video_id: started.video_id, video_state: input.state || 'PUBLISHED',
    title: String(input.title || ''), description: String(input.caption || '')});
  if (!finished.success) throw new Error('Facebook chưa xác nhận bước xuất bản Reel.');
  return {id: started.video_id, provider: 'direct', state: 'processing', message: 'Facebook đã nhận Reel và đang xử lý.'};
}

async function youtubeToken() {
  if (process.env.YOUTUBE_ACCESS_TOKEN) return process.env.YOUTUBE_ACCESS_TOKEN;
  const clientId = token('YOUTUBE_CLIENT_ID');
  const clientSecret = token('YOUTUBE_CLIENT_SECRET');
  const refreshToken = token('YOUTUBE_REFRESH_TOKEN');
  const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token'}), signal: AbortSignal.timeout(30000)});
  const result = await checked(response, 'YouTube OAuth');
  if (!result.access_token) throw new Error('YouTube OAuth không trả access token.');
  return result.access_token;
}

export async function youtubeStatus(id) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'status,processingDetails');
  url.searchParams.set('id', id);
  const response = await fetch(url, {headers: {Authorization: `Bearer ${await youtubeToken()}`},
    signal: AbortSignal.timeout(30000)});
  const data = await checked(response, 'YouTube trạng thái');
  return data.items?.[0] || null;
}

export async function postYouTube(file, input, progress = () => {}) {
  if (!['private', 'unlisted', 'public'].includes(input.privacy || 'private')) {
    throw new Error('Quyền riêng tư YouTube không hợp lệ.');
  }
  if (zernioApiKey('youtube')) {
    const mediaUrl = await zernioUpload(file, progress, 'youtube', input.accountId);
    return zernioPost('youtube', mediaUrl, input);
  }
  const accessToken = await youtubeToken();
  const size = (await stat(file)).size;
  const metadata = {snippet: {title: String(input.title || '').trim(),
    description: String(input.description || ''), categoryId: '22'},
    status: {privacyStatus: input.privacy || 'private',
      selfDeclaredMadeForKids: Boolean(input.madeForKids),
      containsSyntheticMedia: Boolean(input.containsSyntheticMedia)}};
  if (!metadata.snippet.title || metadata.snippet.title.length > 100) {
    throw new Error('Tiêu đề YouTube cần từ 1 đến 100 ký tự.');
  }
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4'},
    body: JSON.stringify(metadata), signal: AbortSignal.timeout(30000)});
  if (!start.ok) await checked(start, 'YouTube khởi tạo upload');
  const location = start.headers.get('location');
  if (!location) throw new Error('YouTube không trả URL upload.');
  const uploadUrl = new URL(location);
  if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'www.googleapis.com') {
    throw new Error('YouTube trả URL upload không hợp lệ.');
  }
  const uploaded = await fetch(uploadUrl, {method: 'PUT', headers: {
    Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size)},
    body: Readable.toWeb(createReadStream(file)), duplex: 'half', signal: AbortSignal.timeout(300000)});
  const result = await checked(uploaded, 'YouTube upload');
  if (!result.id) throw new Error('YouTube chưa trả ID video.');
  progress(1);
  return {id: result.id, state: 'processing', url: `https://www.youtube.com/watch?v=${result.id}`,
    message: 'YouTube đã nhận video; đang xử lý và phân loại Shorts.'};
}

export const publishers = {tiktok: postTikTok, facebook: postFacebook, youtube: postYouTube};
export {zernioPostStatus};
