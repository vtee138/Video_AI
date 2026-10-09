import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSession} from './session.mjs';

test('groups video jobs into one running session with exact counts', () => {
  const parent = {id: 'batch', title: 'Phiên: Du lịch', status: 'processing', progress: .5};
  const session = summarizeSession(parent, [
    {status: 'done', progress: 1}, {status: 'rendering', progress: .5},
    {status: 'queued', progress: 0}, {status: 'error', progress: 0},
  ]);
  assert.equal(session.title, 'Du lịch');
  assert.equal(session.status, 'running');
  assert.deepEqual(session.counts, {total: 4, done: 1, running: 1, queued: 1,
    needsInput: 0, failed: 1, interrupted: 0});
});

test('shows interrupted work even when earlier videos finished', () => {
  const session = summarizeSession({id: 'batch', title: 'Phiên: Kinh tế', status: 'interrupted'}, [
    {status: 'done', progress: 1}, {status: 'done', progress: 1},
    {status: 'interrupted', progress: .9},
  ]);
  assert.equal(session.status, 'interrupted');
  assert.equal(session.counts.done, 2);
  assert.equal(session.counts.interrupted, 1);
  assert.equal(session.counts.total, 3);
});

test('keeps a paused session visible even when it still has queued videos', () => {
  const session = summarizeSession({id: 'batch', title: 'Phiên: Kinh tế', status: 'paused'}, [
    {status: 'done', progress: 1}, {status: 'queued', progress: .02},
  ]);
  assert.equal(session.status, 'paused');
  assert.equal(session.counts.queued, 1);
  assert.equal(session.progress, .51);
});

test('shows pausing while the current video is still rendering', () => {
  const session = summarizeSession({id: 'batch', title: 'Phiên: Kinh tế', status: 'pausing'}, [
    {status: 'rendering', progress: .8}, {status: 'queued', progress: .02},
  ]);
  assert.equal(session.status, 'pausing');
  assert.equal(session.counts.running, 1);
});
