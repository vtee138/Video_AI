import test from 'node:test';
import assert from 'node:assert/strict';
import {concurrencyConfig, Semaphore} from './concurrency.mjs';

test('NucBox defaults keep two jobs but serialize Remotion renders', () => {
  assert.deepEqual(concurrencyConfig({}), {jobs: 2, renders: 1, downloads: 2, publishes: 2});
});

test('concurrency limits reject invalid values and cap unsafe values', () => {
  assert.deepEqual(concurrencyConfig({MAX_CONCURRENT_JOBS: '0', MAX_CONCURRENT_RENDERS: '20',
    MAX_CONCURRENT_DOWNLOADS: 'nope', MAX_CONCURRENT_PUBLISHES: '3'}),
  {jobs: 2, renders: 4, downloads: 2, publishes: 3});
});

test('semaphore never exceeds its limit and releases capacity after failure', async () => {
  const semaphore = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const work = async (fail = false) => semaphore.use(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (fail) throw new Error('expected');
  });
  const results = await Promise.allSettled([work(), work(true), work(), work()]);
  assert.equal(peak, 2);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual(semaphore.snapshot(), {limit: 2, active: 0, waiting: 0});
});
