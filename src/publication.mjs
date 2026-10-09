export function publicationStatus(video, posts) {
  const results = posts.flatMap(post => Object.values(post.results || {}));
  if (video.manualPublication === 'posted' || results.some(result => result.state === 'published')) return 'posted';
  if (results.some(result => ['queued', 'uploading', 'processing', 'verifying'].includes(result.state))) return 'posting';
  if (results.some(result => ['failed', 'interrupted'].includes(result.state))) return 'failed';
  if (results.some(result => result.state === 'ready')) return 'uploaded';
  return video.manualPublication || 'unknown';
}
