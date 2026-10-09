export function nextRunnableJobIndex(pendingJobs, runs) {
  return pendingJobs.findIndex(id => !runs.get(runs.get(id)?.parentId)?.pauseRequested);
}

export function queueStatus(parent, items, activeJobs) {
  const finished = items.filter(item => ['done', 'error'].includes(item.status));
  if (items.length && finished.length === items.length) {
    return finished.some(item => item.status === 'error') ? 'done_with_errors' : 'done';
  }
  if (!parent.pauseRequested) return 'processing';
  return items.some(item => activeJobs.has(item.id)) ? 'pausing' : 'paused';
}
