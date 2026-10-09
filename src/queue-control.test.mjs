import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRunnableJobIndex, queueStatus} from './queue-control.mjs';

test('a paused session does not block another runnable session', () => {
  const runs = new Map([
    ['paused', {pauseRequested: true}], ['ready', {pauseRequested: false}],
    ['a', {parentId: 'paused'}], ['b', {parentId: 'ready'}],
  ]);
  assert.equal(nextRunnableJobIndex(['a', 'b'], runs), 1);
  assert.equal(nextRunnableJobIndex(['a'], runs), -1);
  runs.get('paused').pauseRequested = false;
  assert.equal(nextRunnableJobIndex(['a', 'b'], runs), 0);
});

test('queue waits for active work to stop and resumes from remaining jobs', () => {
  const parent = {pauseRequested: true};
  const items = [{id: 'a', status: 'rendering'}, {id: 'b', status: 'queued'}];
  const active = new Set(['a']);
  assert.equal(queueStatus(parent, items, active), 'pausing');
  active.delete('a');
  items[0].status = 'render_queued';
  assert.equal(queueStatus(parent, items, active), 'paused');
  parent.pauseRequested = false;
  assert.equal(queueStatus(parent, items, active), 'processing');
  items[0].status = 'done';
  items[1].status = 'error';
  assert.equal(queueStatus(parent, items, active), 'done_with_errors');
});
