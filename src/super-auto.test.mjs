import test from 'node:test';
import assert from 'node:assert/strict';
import {isFootageShortage, nextPostAt, validateSuperFootageRepair, validateSuperPlan,
  validateSuperRetry} from './super-auto.mjs';

test('Super Auto validates local publishing cadence and start window', () => {
  const now = new Date('2026-10-07T03:00:00.000Z');
  const plan = validateSuperPlan({template: 'quote', mode: 'caption', focus: '  kỷ luật  ',
    intervalMinutes: 360, startAt: '2026-10-07T04:00:00.000Z'}, now);
  assert.equal(plan.focus, 'kỷ luật');
  assert.equal(plan.intervalMinutes, 360);
  assert.throws(() => validateSuperPlan({intervalMinutes: 0,
    startAt: '2026-10-07T04:00:00.000Z'}, now), /15 phút/);
  assert.throws(() => validateSuperPlan({intervalMinutes: 60,
    startAt: '2026-10-06T04:00:00.000Z'}, now), /Giờ đăng đầu tiên/);
});

test('Super Auto never schedules sooner than the previous upload gap', () => {
  assert.equal(nextPostAt('2026-10-07T04:00:00.000Z', '2026-10-07T05:10:00.000Z', 60),
    '2026-10-07T06:10:00.000Z');
  assert.equal(nextPostAt('2026-10-07T08:00:00.000Z', '2026-10-07T05:10:00.000Z', 60),
    '2026-10-07T08:00:00.000Z');
});

test('Super Auto only retries failed production before any posting attempt', () => {
  assert.doesNotThrow(() => validateSuperRetry({campaignStatus: 'active', itemStatus: 'failed',
    postId: null, hasPostHistory: false, hasNeedsReview: false}));
  assert.doesNotThrow(() => validateSuperRetry({campaignStatus: 'stopped', itemStatus: 'failed',
    postId: null, hasPostHistory: false, hasNeedsReview: false}));
  assert.throws(() => validateSuperRetry({campaignStatus: 'active', itemStatus: 'sent',
    postId: null, hasPostHistory: false, hasNeedsReview: false}), /trạng thái lỗi/);
  assert.throws(() => validateSuperRetry({campaignStatus: 'active', itemStatus: 'failed',
    postId: 'post-1', hasPostHistory: true, hasNeedsReview: false}), /tránh đăng trùng/);
  assert.throws(() => validateSuperRetry({campaignStatus: 'attention', itemStatus: 'failed',
    postId: null, hasPostHistory: false, hasNeedsReview: true}), /cần kiểm tra/);
  assert.throws(() => validateSuperRetry({campaignStatus: 'active', itemStatus: 'failed',
    postId: null, hasPostHistory: false, hasNeedsReview: false, hasOpenItem: true}), /video khác/);
});

test('Super Auto only opens manual footage for the matching safe shortage job', () => {
  const shortage = 'Chỉ tìm được 0/8 clip phù hợp. Hãy chạy thủ công để bổ sung footage.';
  assert.equal(isFootageShortage(shortage), true);
  assert.equal(isFootageShortage('Gemini không phản hồi.'), false);
  assert.doesNotThrow(() => validateSuperFootageRepair({itemStatus: 'failed', jobId: 'run-q01',
    postId: null, hasPostHistory: false, error: shortage}));
  assert.doesNotThrow(() => validateSuperFootageRepair({itemStatus: 'manual_review', jobId: 'run-q01',
    postId: null, hasPostHistory: false, error: null}));
  assert.throws(() => validateSuperFootageRepair({itemStatus: 'failed', jobId: null,
    postId: null, hasPostHistory: false, error: shortage}), /không còn job/);
  assert.throws(() => validateSuperFootageRepair({itemStatus: 'failed', jobId: 'run-q01',
    postId: 'post-1', hasPostHistory: true, error: shortage}), /đăng trùng/);
  assert.throws(() => validateSuperFootageRepair({itemStatus: 'failed', jobId: 'run-q01',
    postId: null, hasPostHistory: false, error: 'Gemini không phản hồi.'}), /không phải do thiếu footage/);
});
