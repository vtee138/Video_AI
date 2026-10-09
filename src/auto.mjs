import {composePostCopy} from '../web/post-copy.mjs';

export function selectAutoFootage(candidates, template, requiredClips) {
  const count = 12;
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.query || candidate.subject || candidate.provider;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const selected = [];
  while (selected.length < count && [...groups.values()].some(group => group.length)) {
    for (const group of groups.values()) {
      if (group.length && selected.length < count) selected.push(group.shift());
    }
  }
  return selected;
}

export async function validateAutoSettings(input, config, getTikTokCreator) {
  if (!input || input.enabled !== true || input.consent !== true) {
    throw new Error('Cần bật Auto mode và đồng ý đăng tự động trước khi chạy.');
  }
  const targets = input.targets;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    throw new Error('Hãy chọn ít nhất một nền tảng để đăng tự động.');
  }
  const platforms = Object.keys(targets);
  if (!platforms.length || platforms.some(key => !['tiktok', 'facebook', 'youtube'].includes(key))) {
    throw new Error('Hãy chọn ít nhất một nền tảng hợp lệ để đăng tự động.');
  }
  const selected = {};
  for (const platform of platforms) {
    const options = targets[platform];
    if (!config.platforms[platform]?.configured || !options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error(`${platform} chưa được kết nối hoặc tùy chọn không hợp lệ.`);
    }
    const accountId = String(options.accountId || '');
    if (config.platforms[platform].provider === 'zernio' && !config.accounts.some(account =>
      String(account.id) === accountId && account.platform === platform && account.active)) {
      throw new Error(`Hãy chọn tài khoản Zernio đang kết nối cho ${platform}.`);
    }
    selected[platform] = config.platforms[platform].provider === 'zernio' ? {accountId} : {};
    if (platform === 'tiktok') {
      const creator = await getTikTokCreator(accountId || undefined);
      const privacy = options.privacy || 'PUBLIC_TO_EVERYONE';
      if (!creator.privacy_level_options?.includes(privacy)) {
        throw new Error('Quyền riêng tư TikTok không thuộc lựa chọn của tài khoản.');
      }
      selected.tiktok = {...selected.tiktok, privacy,
        allowComment: Boolean(options.allowComment) && !creator.comment_disabled,
        allowDuet: Boolean(options.allowDuet) && !creator.duet_disabled,
        allowStitch: Boolean(options.allowStitch) && !creator.stitch_disabled,
        isAigc: Boolean(options.isAigc)};
    }
    if (platform === 'facebook') selected.facebook.state = 'PUBLISHED';
    if (platform === 'youtube') {
      const privacy = options.privacy || 'public';
      if (!['private', 'unlisted', 'public'].includes(privacy)) {
        throw new Error('Quyền riêng tư YouTube không hợp lệ.');
      }
      selected.youtube = {...selected.youtube, privacy,
        madeForKids: Boolean(options.madeForKids),
        containsSyntheticMedia: Boolean(options.containsSyntheticMedia)};
    }
  }
  return selected;
}

export function autoPostTargets(settings, title, caption) {
  const copy = composePostCopy(title, caption);
  return Object.fromEntries(Object.entries(settings).map(([platform, options]) => [platform,
    {...(platform === 'youtube' ? {privacy: 'public'} : platform === 'facebook' ? {state: 'PUBLISHED'} : {}),
      ...options, ...copy[platform]}]));
}
