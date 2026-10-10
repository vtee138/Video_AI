import test from 'node:test';
import assert from 'node:assert/strict';
import {sameUiOrigin} from './request-origin.mjs';

const request = (host, origin) => ({headers: {host, ...(origin === undefined ? {} : {origin})}});

test('UI origin works through localhost, LAN, and HTTPS reverse proxy', () => {
  assert.equal(sameUiOrigin(request('127.0.0.1:4173', 'http://127.0.0.1:4173')), true);
  assert.equal(sameUiOrigin(request('192.168.1.20:4173', 'http://192.168.1.20:4173')), true);
  assert.equal(sameUiOrigin(request('video.example.com', 'https://video.example.com')), true);
  assert.equal(sameUiOrigin(request('127.0.0.1:4173')), true);
  assert.equal(sameUiOrigin(request('video.example.com'), {requireOrigin: true}), false);
});

test('UI origin rejects other sites and malformed origins', () => {
  assert.equal(sameUiOrigin(request('video.example.com', 'https://other.example.com')), false);
  assert.equal(sameUiOrigin(request('video.example.com', 'https://video.example.com:4173')), false);
  assert.equal(sameUiOrigin(request('video.example.com', 'null')), false);
  assert.equal(sameUiOrigin(request('video.example.com', 'file:///video')), false);
  assert.equal(sameUiOrigin(request('video.example.com', 'https://video.example.com/path')), false);
});
