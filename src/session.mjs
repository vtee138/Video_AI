const runningStates = new Set(['thinking', 'researching', 'preparing', 'downloading', 'rendering', 'publishing']);
const queuedStates = new Set(['queued', 'render_queued']);
const reviewStates = new Set(['ideas', 'review', 'footage_review']);

export function summarizeSession(parent, children) {
  const items = children.length ? children : parent.outputName ? [parent] : [];
  const counts = {total: items.length, done: 0, running: 0, queued: 0, needsInput: 0,
    failed: 0, interrupted: 0};
  for (const item of items) {
    if (item.status === 'done') counts.done++;
    else if (item.status === 'error') counts.failed++;
    else if (item.status === 'interrupted') counts.interrupted++;
    else if (runningStates.has(item.status)) counts.running++;
    else if (queuedStates.has(item.status)) counts.queued++;
    else if (reviewStates.has(item.status)) counts.needsInput++;
  }
  const status = ['paused', 'pausing'].includes(parent.status) ? parent.status :
    counts.running ? 'running' : counts.queued ? 'queued' :
    counts.needsInput ? 'needs_input' : counts.interrupted ? 'interrupted' :
      counts.failed ? 'error' : counts.total && counts.done === counts.total ? 'done' :
        runningStates.has(parent.status) || parent.status === 'processing' ? 'running' :
          reviewStates.has(parent.status) ? 'needs_input' : parent.status === 'interrupted' ? 'interrupted' :
            parent.status === 'error' ? 'error' : 'done';
  const updatedAt = [parent, ...children].map(item => item.updatedAt).filter(Boolean).sort().at(-1);
  return {id: parent.id, title: parent.title.replace(/^Phiên:\s*/u, ''), template: parent.template,
    mode: parent.mode,
    auto: parent.auto || children.some(item => item.auto), status, counts,
    progress: counts.total ? items.reduce((sum, item) => sum + (item.progress || 0), 0) / counts.total : parent.progress || 0,
    step: parent.step, updatedAt, items: children};
}
