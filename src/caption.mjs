export function rankingCaption(story) {
  const hook = String(story.hookText || '').trim();
  const detail = String(story.caption || '').trim();
  const body = hook && detail.toLocaleLowerCase('vi-VN').startsWith(hook.toLocaleLowerCase('vi-VN'))
    ? detail : [hook, detail].filter(Boolean).join('\n\n');
  const hashtags = (story.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
  return [body, hashtags].filter(Boolean).join('\n\n');
}

export function withoutSourceAppendix(caption) {
  return String(caption || '').replace(/(?:\r?\n){2}Nguồn dữ liệu \([^\r\n]*\):[\s\S]*$/u, '').trim();
}
