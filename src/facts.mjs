import {isIP} from 'node:net';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const countries = require('i18n-iso-countries');
countries.registerLocale(require('i18n-iso-countries/langs/vi.json'));
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

const canonical = (s) => s.replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const countryAliases = new Map([
  ['hoaky', 'US'], ['my', 'US'], ['brunei', 'BN'], ['lao', 'LA'],
  ['nga', 'RU'], ['hanquoc', 'KR'], ['trieutien', 'KP'], ['conghoasec', 'CZ'],
  ['dailoan', 'TW'], ['vatican', 'VA'], ['bolivia', 'BO'], ['venezuela', 'VE'],
]);

function countryCode(entity) {
  return countryAliases.get(canonical(entity)) ||
    countries.getAlpha2Code(entity.trim(), 'vi') ||
    countries.getAlpha2Code(entity.trim(), 'en') || '';
}

function periodInfo(value) {
  const text = String(value || '');
  const years = [...text.matchAll(/(?:19|20)\d{2}/g)].map(match => Number(match[0]));
  if (!years.length) return null;
  const quarter = text.match(/(?:Q|quý)\s*([1-4])/i)?.[1] || null;
  const status = /dự báo|dự phóng|forecast|projection|projected/i.test(text) ? 'forecast'
    : /ước tính|estimate|estimated/i.test(text) ? 'estimate'
      : /thực tế|actual|final/i.test(text) ? 'actual' : null;
  return {year: Math.max(...years), quarter, status};
}

function shortPeriod(info, original) {
  if (!info) return original.trim();
  const statusText = {forecast: 'dự báo', estimate: 'ước tính', actual: 'thực tế'};
  return `${info.quarter ? `Q${info.quarter} ` : ''}${info.year}${info.status ? ` (${statusText[info.status]})` : ''}`;
}

function checkedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`URL nguồn không hợp lệ: ${raw}`); }
  if (url.protocol !== 'https:' || isIP(url.hostname) || !url.hostname.includes('.') ||
      url.hostname.endsWith('.local') || url.username || url.password) {
    throw new Error(`URL nguồn phải là website HTTPS công khai: ${raw}`);
  }
  return url;
}

function probeUrl(raw) {
  const url = checkedUrl(raw);
  if (url.hostname === 'data.worldbank.org') {
    const indicator = url.pathname.match(/^\/indicator\/([A-Z0-9.]+)$/i)?.[1];
    if (indicator) {
      return `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=1`;
    }
  }
  return url.href;
}

export function normalizeResearch(result) {
  if (!result || !Array.isArray(result.items)) throw new Error('Research JSON không hợp lệ.');
  const {metricName, metricUnit, metricPeriod} = result;
  if (![metricName, metricUnit, metricPeriod].every(x => typeof x === 'string' && x.trim())) throw new Error('Thiếu metric/unit/period.');
  const mainPeriod = periodInfo(metricPeriod);
  const displayPeriod = shortPeriod(mainPeriod, metricPeriod);
  const seen = new Set();
  const items = result.items.map((item, index) => {
    if (typeof item.entity !== 'string' || !item.entity.trim()) throw new Error(`Entity rỗng tại dòng ${index + 1}.`);
    if (typeof item.value !== 'number' || !Number.isFinite(item.value)) throw new Error(`Value không hợp lệ: ${item.entity}`);
    if (typeof item.unit !== 'string' || item.unit.trim() !== metricUnit.trim()) throw new Error(`Unit không khớp: ${item.entity}`);
    const rowPeriod = periodInfo(item.period);
    if (!mainPeriod || !rowPeriod || rowPeriod.year !== mainPeriod.year ||
      (mainPeriod.quarter && rowPeriod.quarter !== mainPeriod.quarter) ||
      (mainPeriod.status && rowPeriod.status && rowPeriod.status !== mainPeriod.status)) {
      throw new Error(`Kỳ dữ liệu không khớp: ${item.entity} (${item.period})`);
    }
    const key = canonical(item.entity);
    if (seen.has(key)) throw new Error(`Entity trùng: ${item.entity}`);
    seen.add(key);
    const url = checkedUrl(item.sourceUrl);
    if (!item.sourceTitle?.trim() || !item.evidence?.trim()) throw new Error(`Thiếu title/evidence: ${item.entity}`);
    return {...item, period: displayPeriod, sourceUrl: url.href};
  });
  if (items.length < 10) throw new Error(`Research đã tự thử lại nhưng chỉ có ${items.length} dòng; cần ít nhất 10. Hãy chọn góc khác có bảng dữ liệu đầy đủ hơn.`);
  items.sort((a, b) => b.value - a.value || a.entity.localeCompare(b.entity));
  const displayValue = (value, unit) => {
    const simpleUnit = unit.replace(/\b(hiện hành|current)\b/gi, '').replace(/\s+/g, ' ').trim();
    let shown = value;
    let shownUnit = simpleUnit;
    if (/triệu\s*(usd|đô la)/i.test(simpleUnit) && Math.abs(value) >= 1000) {
      shown = value / 1000;
      shownUnit = simpleUnit.replace(/triệu/i, 'tỷ');
    } else if (/^(usd|đô la mỹ)$/i.test(simpleUnit) && Math.abs(value) >= 1_000_000_000) {
      shown = value / 1_000_000_000;
      shownUnit = 'tỷ USD';
    }
    const decimals = Math.abs(shown) >= 100 ? 0 : Math.abs(shown) >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat('vi-VN', {maximumFractionDigits: decimals}).format(shown)} ${shownUnit}`;
  };
  return {title: result.topicTitle, metricName, metricUnit, metricPeriod: displayPeriod,
    top10: items.slice(0, 10).map((item, index) => ({...item, rank: index + 1,
      countryCode: countryCode(item.entity),
      displayValue: displayValue(item.value, metricUnit)}))};
}

export async function checkSources(facts) {
  const sources = new Map();
  for (const item of facts.top10) {
    const probe = probeUrl(item.sourceUrl);
    if (!sources.has(probe)) sources.set(probe, item.sourceUrl);
  }
  let reachable = 0;
  const failures = [];
  for (const [probe, original] of sources) {
    try {
      let current = probe;
      let res;
      for (let hop = 0; hop < 4; hop++) {
        res = await fetch(current, {method: 'GET', redirect: 'manual',
          signal: AbortSignal.timeout(20000), headers: {'User-Agent': 'Mozilla/5.0'}});
        if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) break;
        current = checkedUrl(new URL(res.headers.get('location'), current).href).href;
        await res.body?.cancel();
      }
      if (res.status >= 300 && res.status < 400) throw new Error('quá nhiều lần chuyển hướng');
      if ([401, 403].includes(res.status)) {
        failures.push(`${original}: HTTP ${res.status} (website chặn kiểm tra tự động)`);
        await res.body?.cancel();
        reachable++;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.body?.cancel();
      reachable++;
    } catch (error) {
      failures.push(`${original}: ${error.message}`);
    }
  }
  failures.forEach(message => console.warn(`Cảnh báo nguồn tạm thời không phản hồi: ${message}`));
  if (reachable === 0) {
    throw new Error(`Không kiểm tra được bất kỳ nguồn nào trong ${sources.size} nguồn. Chi tiết đã được ghi ở trên.`);
  }
  return failures;
}
