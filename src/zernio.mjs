import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';

const base = 'https://zernio.com/api/v1';

function primaryApiKey() {
  // Older local setups put a Zernio sk_ key in TIKTOK_ACCESS_TOKEN.
  const legacy = process.env.TIKTOK_ACCESS_TOKEN || '';
  return process.env.ZERNIO_API_KEY || (/^sk_[0-9a-f]{64}$/i.test(legacy) ? legacy : '');
}

export function zernioApiKey(platform) {
  const primary = primaryApiKey();
  const secondary = process.env.ZERNIO_YOUTUBE_API_KEY || '';
  return platform === 'youtube' ? secondary || primary : primary || secondary;
}

function keyForCredential(credential, platform) {
  if (credential === 'primary') return primaryApiKey();
  if (credential === 'secondary') return process.env.ZERNIO_YOUTUBE_API_KEY || '';
  return zernioApiKey(platform);
}

async function request(route, {platform, credential, method = 'GET', body, requestId, idempotencyKey, timeoutMs = 45000} = {}) {
  const key = keyForCredential(credential, platform);
  if (!key) throw new Error(`Thiếu ${platform === 'youtube' ? 'ZERNIO_YOUTUBE_API_KEY' : 'ZERNIO_API_KEY'} trong .env.`);
  const response = await fetch(`${base}${route}`, {method, headers: {
    Authorization: `Bearer ${key}`,
    ...(body ? {'Content-Type': 'application/json'} : {}),
    ...(requestId ? {'x-request-id': requestId} : {}),
    ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}),
  }, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(timeoutMs)});
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {error: raw.slice(0, 300)}; }
  if (!response.ok || !data || typeof data !== 'object') {
    throw new Error(`Zernio: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

function accountList(data, credential) {
  return (data.accounts || []).filter(account => ['tiktok', 'facebook', 'youtube'].includes(account.platform))
    .map(account => ({id: account._id || account.id, platform: account.platform,
      username: account.username || account.displayName || '', active: Boolean(account.isActive),
      profileId: account.profileId?._id || account.profileId || '', credential}));
}

export async function zernioAccounts(platform) {
  const primary = primaryApiKey();
  const secondary = process.env.ZERNIO_YOUTUBE_API_KEY || '';
  const credentials = [primary && 'primary', secondary && secondary !== primary && 'secondary'].filter(Boolean);
  if (!credentials.length) return [];
  const results = await Promise.allSettled(credentials.map(credential => request('/accounts', {credential})));
  if (results.every(result => result.status === 'rejected')) throw results[0].reason;
  const accounts = new Map();
  for (const [index, result] of results.entries()) {
    if (result.status !== 'fulfilled') continue;
    for (const account of accountList(result.value, credentials[index])) {
      const key = `${account.platform}:${account.id}`;
      const existing = accounts.get(key);
      if (!existing || !existing.active && account.active ||
          existing.active === account.active && account.platform === 'youtube' && account.credential === 'secondary') {
        accounts.set(key, account);
      }
    }
  }
  return [...accounts.values()].filter(account => !platform || account.platform === platform);
}

export async function zernioProfiles(platform) {
  const data = await request('/profiles', {platform});
  return (data.profiles || []).map(profile => ({id: profile._id || profile.id,
    name: profile.name || '', isDefault: Boolean(profile.isDefault)}));
}

export async function zernioConnectUrl(platform, redirectUrl) {
  const hosts = {facebook: ['facebook.com', 'www.facebook.com'],
    tiktok: ['www.tiktok.com'], youtube: ['accounts.google.com']};
  if (!hosts[platform]) throw new Error('Nền tảng kết nối Zernio không hợp lệ.');
  const profiles = await zernioProfiles(platform);
  const profileVariable = platform === 'youtube' && process.env.ZERNIO_YOUTUBE_API_KEY
    ? 'ZERNIO_YOUTUBE_PROFILE_ID' : 'ZERNIO_PROFILE_ID';
  const requestedId = process.env[profileVariable] || '';
  const profile = requestedId ? profiles.find(item => item.id === requestedId) :
    profiles.find(item => item.isDefault) || (profiles.length === 1 ? profiles[0] : null);
  if (!profile) throw new Error(requestedId
    ? `${profileVariable} không thuộc các hồ sơ mà API key có thể truy cập.`
    : `Không xác định được hồ sơ Zernio. Hãy đặt ${profileVariable} trong .env.`);
  const route = `/connect/${platform}?${new URLSearchParams({profileId: profile.id, redirect_url: redirectUrl})}`;
  const data = await request(route, {platform});
  const authUrl = new URL(data.authUrl);
  if (authUrl.protocol !== 'https:' || !hosts[platform].includes(authUrl.hostname) ||
      authUrl.username || authUrl.password) {
    throw new Error('Zernio trả URL xác thực không hợp lệ.');
  }
  return {authUrl: authUrl.toString(), profileId: profile.id};
}

export async function zernioAccount(platform, id) {
  const accounts = (await zernioAccounts(platform)).filter(account => account.active);
  if (id) {
    const found = accounts.find(account => account.id === id);
    if (!found) throw new Error(`Tài khoản ${platform} đã chọn không còn kết nối trong Zernio.`);
    return found;
  }
  if (accounts.length === 1) return accounts[0];
  if (!accounts.length) throw new Error(`Chưa kết nối tài khoản ${platform} trong Zernio.`);
  throw new Error(`Có nhiều tài khoản ${platform} trong Zernio. Hãy chọn tài khoản trước khi đăng.`);
}

export async function zernioTikTokCreator(accountId) {
  const account = await zernioAccount('tiktok', accountId);
  const data = await request(`/accounts/${encodeURIComponent(account.id)}/tiktok/creator-info?mediaType=video`, {platform: 'tiktok'});
  const limits = data.postingLimits || {};
  const interactions = limits.interactionSettings || {};
  return {provider: 'zernio', accountId: account.id, creator_username: account.username,
    creator_nickname: data.creator?.nickname || account.username,
    privacy_level_options: (data.privacyLevels || []).map(level => level.value),
    comment_disabled: interactions.allow_comment?.enabled === false,
    duet_disabled: interactions.allow_duet?.enabled === false,
    stitch_disabled: interactions.allow_stitch?.enabled === false,
    max_video_post_duration_sec: limits.maxVideoDurationSec || 0,
    can_post_more: data.creator?.canPostMore !== false};
}

export async function zernioUpload(file, progress = () => {}, platform, accountId) {
  const size = (await stat(file)).size;
  if (!size || size > 5_000_000_000) throw new Error('Video vượt giới hạn 5 GB của Zernio.');
  const account = accountId ? await zernioAccount(platform, accountId) : null;
  const data = await request('/media/presign', {platform, credential: account?.credential, method: 'POST', body: {
    filename: path.basename(file), contentType: 'video/mp4', size}});
  const uploadUrl = new URL(data.uploadUrl);
  const publicUrl = new URL(data.publicUrl);
  if (uploadUrl.protocol !== 'https:' || !uploadUrl.hostname.endsWith('.r2.cloudflarestorage.com') ||
      publicUrl.protocol !== 'https:' || publicUrl.hostname !== 'media.zernio.com') {
    throw new Error('Zernio trả URL upload không hợp lệ.');
  }
  const response = await fetch(uploadUrl, {method: 'PUT', headers: {
    'Content-Type': 'video/mp4', 'Content-Length': String(size)},
    body: Readable.toWeb(createReadStream(file)), duplex: 'half', signal: AbortSignal.timeout(300000)});
  if (!response.ok) throw new Error(`Zernio upload video: HTTP ${response.status}`);
  progress(1);
  return publicUrl.toString();
}

function stateOf(entry) {
  if (entry?.status === 'published') return 'published';
  if (['failed', 'cancelled'].includes(entry?.status)) return 'failed';
  return 'processing';
}

function postResult(post, platform, accountId) {
  if (!post?._id) throw new Error('Zernio chưa trả ID bài đăng.');
  const target = post.platforms?.find(item => item.platform === platform &&
    (item.accountId?._id || item.accountId) === accountId)
    || post.platforms?.find(item => item.platform === platform);
  if (!target) throw new Error(`Zernio chưa trả trạng thái đăng ${platform}.`);
  const state = stateOf(target);
  return {id: post._id, provider: 'zernio', state, accountId,
    remoteStatus: target.status || post.status, url: target.platformPostUrl || null,
    ...(target.errorMessage ? {error: target.errorMessage} : {}),
    message: state === 'published' ? 'Zernio đã đăng; đường dẫn có thể xuất hiện sau.' :
      state === 'failed' ? 'Zernio báo đăng bài thất bại.' : 'Zernio đã nhận video và đang xử lý.'};
}

export async function zernioFindPost(platform, accountId, mediaUrl) {
  if (!mediaUrl) return null;
  const account = await zernioAccount(platform, accountId);
  for (let page = 1; page <= 3; page++) {
    const data = await request(`/posts?${new URLSearchParams({page: String(page), limit: '50'})}`,
      {platform, credential: account.credential, timeoutMs: 20000});
    const found = data.posts?.find(post => post.mediaItems?.some(item => item.url === mediaUrl) &&
      post.platforms?.some(item => item.platform === platform &&
        (item.accountId?._id || item.accountId) === accountId));
    if (found) return postResult(found, platform, accountId);
    if (!data.posts?.length || page >= (data.pagination?.pages || 1)) break;
  }
  return null;
}

export async function zernioPost(platform, mediaUrl, input) {
  const account = await zernioAccount(platform, input.accountId);
  const content = String(input.caption || input.description || '').trim();
  if (!content) throw new Error('Caption không được để trống.');
  const entry = {platform, accountId: account.id};
  if (platform === 'facebook') {
    entry.platformSpecificData = {contentType: 'reel', title: String(input.title || '')};
  } else if (platform === 'youtube') {
    entry.platformSpecificData = {title: String(input.title || ''),
      visibility: input.privacy || 'private', madeForKids: Boolean(input.madeForKids),
      containsSyntheticMedia: Boolean(input.containsSyntheticMedia)};
  } else if (platform === 'tiktok') {
    const creator = await zernioTikTokCreator(account.id);
    if (!creator.privacy_level_options.includes(input.privacy)) {
      throw new Error('Quyền riêng tư TikTok không thuộc lựa chọn của tài khoản Zernio.');
    }
    entry.platformSpecificData = {tiktokSettings: {
      privacy_level: input.privacy, allow_comment: Boolean(input.allowComment),
      allow_duet: Boolean(input.allowDuet), allow_stitch: Boolean(input.allowStitch),
      video_made_with_ai: Boolean(input.isAigc),
      content_preview_confirmed: true, express_consent_given: true}};
  }
  let response;
  try {
    const key = randomUUID();
    response = await request('/posts', {platform, credential: account.credential, method: 'POST', requestId: key, idempotencyKey: key,
      timeoutMs: 120000, body: {
        content, mediaItems: [{type: 'video', url: mediaUrl}], platforms: [entry], publishNow: true}});
  } catch (error) {
    if (error.name !== 'TimeoutError' && !/aborted due to timeout/i.test(error.message)) throw error;
    try {
      const found = await zernioFindPost(platform, account.id, mediaUrl);
      if (found) return found;
    } catch { /* A status check can also time out; keep the result unresolved. */ }
    return {provider: 'zernio', state: 'verifying', accountId: account.id, mediaUrl,
      message: 'Zernio chưa trả lời sau thời gian chờ. Kiểm tra trạng thái trước khi đăng lại để tránh trùng bài.'};
  }
  const post = response.post || response.existingPost;
  return postResult(post, platform, account.id);
}

export async function zernioPostStatus(id, platform, accountId) {
  const account = accountId ? await zernioAccount(platform, accountId) : null;
  const {post} = await request(`/posts/${encodeURIComponent(id)}`, {platform, credential: account?.credential});
  const target = post?.platforms?.find(item => item.platform === platform);
  if (!target) throw new Error(`Không tìm thấy trạng thái ${platform} trong bài đăng Zernio.`);
  return {state: stateOf(target), remoteStatus: target?.status || post?.status,
    url: target?.platformPostUrl || null, error: target?.errorMessage || null};
}
