import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {root} from './common.mjs';

test('tiện ích chỉ gán file ảnh tải từ đúng tab Flow vào job đã chọn', async () => {
  const listeners = {};
  const chrome = {
    runtime: {onMessage: {addListener: listener => { listeners.message = listener; }},
      onInstalled: {addListener: () => {}}},
    downloads: {
      onDeterminingFilename: {addListener: listener => { listeners.filename = listener; }},
      onChanged: {addListener: listener => { listeners.changed = listener; }},
    },
    alarms: {get: async () => null, create: async () => {}, onAlarm: {addListener: () => {}}},
    tabs: {query: async () => [], onUpdated: {addListener: () => {}}},
    scripting: {executeScript: async () => {}},
    storage: {local: {set: async () => {}}},
  };
  const source = await readFile(path.join(root, 'flow-extension', 'background.js'), 'utf8');
  vm.runInNewContext(source, {chrome, Date, Set});
  const id = '11111111-2222-4333-8444-555555555555';
  let acknowledged;
  listeners.message({type: 'flow-image-ready', jobId: id},
    {url: 'https://flow.google.com/project/1', tab: {id: 4}}, value => { acknowledged = value; });
  assert.equal(acknowledged.ready, true);
  const suggested = [];
  const item = {id: 3, tabId: 4, filename: 'Flow image.png', url: 'https://storage.googleapis.com/image'};
  listeners.filename({...item, tabId: 7}, value => suggested.push(value));
  assert.equal(suggested.length, 0);
  listeners.filename(item, value => suggested.push(value));
  assert.equal(suggested[0].filename, `flow-tryon/${id}.png`);
  listeners.message({type: 'flow-download-ready', jobId: id, kind: 'video', segment: 1},
    {url: 'https://flow.google.com/project/1', tab: {id: 4}}, value => { acknowledged = value; });
  assert.equal(acknowledged.ready, true);
  listeners.filename({...item, id: 5, filename: 'Flow video.mp4'}, value => suggested.push(value));
  assert.equal(suggested[1].filename, `flow-tryon/${id}-video-2.mp4`);
});
