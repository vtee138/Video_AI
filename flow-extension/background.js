const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pending = null;
const matchedDownloads = new Set();

async function wakeFlowTab() {
  const tabs = await chrome.tabs.query({url: ['https://flow.google.com/*', 'https://labs.google/*']});
  const tab = tabs.find(value => /^https:\/\/flow\.google\.com\/project\//.test(value.url || ''));
  if (!tab?.id) return;
  const response = await fetch('http://127.0.0.1:4173/api/flow/auto/next',
    {headers: {'X-Flow-Extension': '1'}});
  if (!response.ok) return;
  const {task} = await response.json();
  if (!task) {
    const recovery = await fetch('http://127.0.0.1:4173/api/flow/auto/batches',
      {headers: {'X-Flow-Extension': '1'}});
    if (!recovery.ok) return;
    const {batches} = await recovery.json();
    if (!batches.some(batch => batch.status === 'active' && batch.items.some(item =>
      ['generating_image', 'generating_video'].includes(item.state)))) return;
    await chrome.tabs.update(tab.id, {active: true});
    if (tab.status === 'complete') await chrome.scripting.executeScript({
      target: {tabId: tab.id}, files: ['flow-auto-content.js']});
    return;
  }
  await chrome.tabs.update(tab.id, {active: true});
  if (tab.status !== 'complete') return;
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['flow-auto-content.js']});
}

void chrome.alarms.get('flow-poll').then(alarm => {
  if (!alarm) return chrome.alarms.create('flow-poll', {periodInMinutes: 0.5});
}).catch(() => {});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'flow-poll') void wakeFlowTab().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => void wakeFlowTab().catch(() => {}));
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete') void wakeFlowTab().catch(() => {});
});

function flowSource(item) {
  return [item.url, item.finalUrl, item.referrer].some(value =>
    /^(?:blob:)?https:\/\/(?:flow\.google\.com|labs\.google)(?:\/|$)/i.test(value || ''));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'flow-api') {
    const pathname = String(message.path || '');
    if (!/^\/api\/flow\/(?:auto\/|jobs\/|assets\/)/.test(pathname) || pathname.includes('..')) {
      sendResponse({error: 'Đường dẫn API không hợp lệ.'}); return;
    }
    (async () => {
      const response = await fetch(`http://127.0.0.1:4173${pathname}`, {
        method: message.method === 'POST' ? 'POST' : 'GET',
        headers: message.method === 'POST' ?
          {'Content-Type': 'application/json', 'X-Flow-Extension': '1'} : {'X-Flow-Extension': '1'},
        body: message.method === 'POST' ? JSON.stringify(message.body || {}) : undefined,
      });
      if (message.binary) {
        if (!response.ok) throw new Error(`Media HTTP ${response.status}`);
        const buffer = new Uint8Array(await response.arrayBuffer());
        let value = '';
        for (let i = 0; i < buffer.length; i += 32768)
          value += String.fromCharCode(...buffer.subarray(i, i + 32768));
        sendResponse({data: btoa(value), mimeType: response.headers.get('content-type')});
      } else {
        const data = await response.json().catch(() => ({}));
        sendResponse(response.ok ? data : {error: data.error || `HTTP ${response.status}`});
      }
    })().catch(error => sendResponse({error: error.message}));
    return true;
  }
  if (message?.type === 'flow-download-ready') {
    if (!jobIdPattern.test(message.jobId || '') || !['image', 'video'].includes(message.kind) ||
      !Number.isInteger(message.segment) || message.segment < 0 || message.segment > 10) return;
    pending = {jobId: message.jobId, kind: message.kind, segment: message.segment,
      tabId: sender.tab?.id, deadline: Date.now() + 90_000};
    void chrome.storage.local.set({pendingDownload: pending});
    sendResponse({ready: true}); return;
  }
  if (message?.type !== 'flow-image-ready') return;
  const origin = sender.url || sender.tab?.url || '';
  if (!/^(?:https:\/\/flow\.google\.com|https:\/\/labs\.google)\//.test(origin)) return;
  if (!jobIdPattern.test(message.jobId || '')) return;
  pending = {jobId: message.jobId, kind: 'legacy-image', segment: 0,
    tabId: sender.tab?.id, deadline: Date.now() + 90_000};
  void chrome.storage.local.set({pendingDownload: pending});
  chrome.storage.local.set({status: 'Đã thấy ảnh mới; đang tải từ Flow.'});
  sendResponse({ready: true});
});

function suggestName(item, suggest, current) {
  if (!current || Date.now() > current.deadline ||
    (item.tabId !== current.tabId && !flowSource(item))) return false;
  const extension = /\.(png|jpe?g|webp|mp4)$/i.exec(item.filename || '')?.[1]?.toLowerCase();
  if (!extension) return false;
  if (['image', 'legacy-image'].includes(current.kind) && extension === 'mp4' ||
    current.kind === 'video' && extension !== 'mp4') return false;
  const normalized = extension === 'jpeg' ? 'jpg' : extension;
  matchedDownloads.add(item.id);
  void chrome.storage.local.set({[`flowDownload${item.id}`]: true});
  const filename = current.kind === 'video' ?
    `${current.jobId}-video-${current.segment + 1}.mp4` :
    current.kind === 'legacy-image' ? `${current.jobId}.${normalized}` : `${current.jobId}-image.${normalized}`;
  suggest({filename: `flow-tryon/${filename}`, conflictAction: 'overwrite'});
  return true;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (pending) { suggestName(item, suggest, pending); return; }
  chrome.storage.local.get('pendingDownload').then(data => {
    if (!suggestName(item, suggest, data.pendingDownload)) suggest();
  }).catch(() => suggest());
  return true;
});

chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state) return;
  if (!matchedDownloads.has(delta.id) &&
      !(await chrome.storage.local.get(`flowDownload${delta.id}`))[`flowDownload${delta.id}`]) return;
  matchedDownloads.delete(delta.id);
  await chrome.storage.local.remove(`flowDownload${delta.id}`);
  if (delta.state.current === 'complete') {
    pending = null;
    await chrome.storage.local.remove('pendingDownload');
    await chrome.storage.local.set({armedJobId: null, status: 'Ảnh đã tải. App local đang nhập vào job.'});
  } else if (delta.state.current === 'interrupted') {
    pending = null;
    await chrome.storage.local.remove('pendingDownload');
    await chrome.storage.local.set({status: 'Tải ảnh bị gián đoạn; hãy thử lại trên Flow.'});
  }
});
