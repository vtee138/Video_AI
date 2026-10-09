export function quoteDuration(musicSeconds, quietEnding = 35) {
  if (!Number.isFinite(musicSeconds) || musicSeconds <= 0) return 35;
  if (musicSeconds < 30) return 30;
  if (musicSeconds <= 40) return Math.max(30, Math.floor(musicSeconds));
  return Math.min(40, Math.max(30, Math.round(quietEnding)));
}

export function hasFiveQuotePoints(caption) {
  const content = String(caption || '').trim();
  const points = [...content.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+/gu)];
  return points.length === 5 && points[0].index === 0 && points.every((point, index) =>
    Number(point[1]) === index + 1 &&
    content.slice(point.index + point[0].length, points[index + 1]?.index ?? content.length).trim().length >= 40);
}

export function quoteCaption(idea) {
  let content = String(idea?.captionText || '').trim();
  if (hasFiveQuotePoints(content)) {
    content = content.replace(/\n\s*(?=[2-5][.)]\s)/gu, '\n\n');
  } else if (content.length >= 400 && !/\n\s*\n/u.test(content)) {
    const breaks = [...content.matchAll(/[.!?](?=\s|$)/gu)]
      .map(match => match.index + 1)
      .filter(index => index > content.length * .3 && index < content.length * .7);
    if (breaks.length) {
      const middle = breaks.reduce((best, index) =>
        Math.abs(index - content.length / 2) < Math.abs(best - content.length / 2) ? index : best);
      content = `${content.slice(0, middle).trim()}\n\n${content.slice(middle).trim()}`;
    }
  }
  const hashtags = (idea?.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
  return `${content}\n\n${hashtags}`.trim();
}
