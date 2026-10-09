import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSources, normalizeResearch} from './facts.mjs';

test('chấp nhận kỳ dữ liệu cũ khi bảng vẫn đủ và nhất quán', () => {
  const period = '2024 (ước tính)';
  const facts = normalizeResearch({topicTitle: 'Chi tiêu quốc phòng NATO', metricName: 'Tỷ lệ GDP',
    metricUnit: '% GDP', metricPeriod: period,
    items: Array.from({length: 10}, (_, index) => ({entity: `Quốc gia ${index + 1}`,
      value: 10 - index / 10, unit: '% GDP', period,
      sourceUrl: `https://example.com/data/${index + 1}`, sourceTitle: 'NATO', evidence: 'Bảng dữ liệu'}))});
  assert.equal(facts.metricPeriod, period);
  assert.equal(facts.top10.length, 10);
});

test('nguồn chặn bot bằng HTTP 403 vẫn được ghi cảnh báo thay vì làm hỏng video', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', {status: 403});
  try {
    const failures = await checkSources({top10: [
      {sourceUrl: 'https://data.example.com/report'},
      {sourceUrl: 'https://data.example.com/report'},
    ]});
    assert.equal(failures.length, 1);
    assert.match(failures[0], /HTTP 403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
