// One source of truth for editable drafts and Auto/Super Auto posts.
const appendix = /(?:\r?\n){2}Nguồn dữ liệu \([^\r\n]*\):[\s\S]*$/u;
const genericTags = new Set(['fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'xuhuong']);

export function composePostCopy(title, caption) {
  const cleanTitle = String(title || '').trim().replace(/\s+/gu, ' ').slice(0, 100);
  const cleanCaption = String(caption || '').replace(appendix, '').trim();
  const lines = cleanCaption.split(/\r?\n/u);
  const tagLine = lines.at(-1) || '';
  const trailingTags = /^(?:\s*#[\p{L}\p{N}_]+\s*)+$/u.test(tagLine)
    ? (tagLine.match(/#[\p{L}\p{N}_]+/gu) || []) : [];
  const body = (trailingTags.length ? lines.slice(0, -1).join('\n') : cleanCaption).trim() || cleanTitle;
  const tags = [...new Set(trailingTags.filter(tag => !genericTags.has(tag.slice(1).toLowerCase())))];
  const withTags = (limit) => [body, tags.slice(0, limit).join(' ')].filter(Boolean).join('\n\n');
  return {
    tiktok: {caption: withTags(5).slice(0, 2200)},
    facebook: {title: cleanTitle, caption: withTags(3)},
    youtube: {title: cleanTitle, description: withTags(3)},
  };
}
