import assert from 'node:assert/strict';
import {writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {postFacebook, postTikTok, postYouTube, publishConfig, tiktokCreator} from './publish.mjs';
import {zernioAccounts, zernioConnectUrl, zernioPost, zernioPostStatus} from './zernio.mjs';

test('Zernio connect selects the default profile and returns a Facebook OAuth URL', async () => {
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldProfile = process.env.ZERNIO_PROFILE_ID;
  const oldFetch = globalThis.fetch;
  process.env.ZERNIO_API_KEY = `sk_${'a'.repeat(64)}`;
  delete process.env.ZERNIO_PROFILE_ID;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/profiles')) return Response.json({profiles: [
      {_id: 'a'.repeat(24), name: 'Other', isDefault: false},
      {_id: 'b'.repeat(24), name: 'Default', isDefault: true}]});
    return Response.json({authUrl: 'https://www.facebook.com/v24.0/dialog/oauth?client_id=test'});
  };
  try {
    const redirectUrl = 'http://127.0.0.1:4173/?zernio_platform=facebook&zernio_state=test';
    const result = await zernioConnectUrl('facebook', redirectUrl);
    assert.equal(result.profileId, 'b'.repeat(24));
    const request = new URL(calls[1]);
    assert.equal(request.searchParams.get('profileId'), 'b'.repeat(24));
    assert.equal(request.searchParams.get('redirect_url'), redirectUrl);
    assert.equal(new URL(result.authUrl).hostname, 'www.facebook.com');
    globalThis.fetch = async url => String(url).endsWith('/profiles')
      ? Response.json({profiles: [{_id: 'b'.repeat(24), isDefault: true}]})
      : Response.json({authUrl: 'https://example.com/steal'});
    await assert.rejects(zernioConnectUrl('facebook', redirectUrl), /URL xác thực không hợp lệ/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = oldKey;
    if (oldProfile === undefined) delete process.env.ZERNIO_PROFILE_ID; else process.env.ZERNIO_PROFILE_ID = oldProfile;
  }
});

test('Zernio account, creator info, presigned upload and TikTok post use the API key correctly', async () => {
  const file = path.join(import.meta.dirname, 'zernio-test.mp4');
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldFacebookToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const oldFetch = globalThis.fetch;
  const calls = [];
  process.env.ZERNIO_API_KEY = `sk_${'a'.repeat(64)}`;
  await writeFile(file, Buffer.from('test-video'));
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({address, options});
    if (address.endsWith('/accounts')) return Response.json({accounts: [
      {_id: 'account1', platform: 'tiktok', username: 'topdata52', isActive: true},
      {_id: 'account2', platform: 'facebook', username: 'Page', isActive: true},
      {_id: 'account3', platform: 'youtube', username: 'Channel', isActive: true}]});
    if (address.includes('/creator-info')) return Response.json({creator: {nickname: 'topdata'},
      privacyLevels: [{value: 'PUBLIC_TO_EVERYONE', label: 'Public'}],
      postingLimits: {maxVideoDurationSec: 600, interactionSettings: {
        allow_comment: {enabled: true}, allow_duet: {enabled: true}, allow_stitch: {enabled: false}}}});
    if (address.endsWith('/media/presign')) return Response.json({
      uploadUrl: 'https://bucket.r2.cloudflarestorage.com/temp/test.mp4?signature=fake',
      publicUrl: 'https://media.zernio.com/temp/test.mp4'});
    if (address.startsWith('https://bucket.r2.')) return new Response('', {status: 200});
    if (address.endsWith('/posts')) {
      const platform = JSON.parse(options.body).platforms[0].platform;
      return Response.json({post: {_id: `post-${platform}`, status: 'published',
        platforms: [{platform, status: 'published', platformPostUrl: null}]}}, {status: 201});
    }
    if (address.endsWith('/posts/post1')) return Response.json({post: {_id: 'post1', status: 'published',
      platforms: [{platform: 'tiktok', status: 'published', platformPostUrl: 'https://www.tiktok.com/@topdata52/video/1'}]}});
    throw new Error(`Unexpected request: ${address}`);
  };
  try {
    const creator = await tiktokCreator('account1');
    assert.deepEqual(creator.privacy_level_options, ['PUBLIC_TO_EVERYONE']);
    assert.equal(creator.stitch_disabled, true);
    const result = await postTikTok(file, {accountId: 'account1', caption: 'Video thử',
      privacy: 'PUBLIC_TO_EVERYONE', allowComment: true, allowDuet: false, allowStitch: false, isAigc: true});
    assert.equal(result.id, 'post-tiktok');
    assert.equal(result.provider, 'zernio');
    const upload = calls.find(call => call.address.startsWith('https://bucket.r2.'));
    assert.equal(upload.options.headers.Authorization, undefined);
    const create = calls.find(call => call.address.endsWith('/posts'));
    const body = JSON.parse(create.options.body);
    assert.equal(body.publishNow, true);
    assert.equal(body.platforms[0].platformSpecificData.tiktokSettings.express_consent_given, true);
    assert.equal(body.platforms[0].platformSpecificData.tiktokSettings.privacy_level, 'PUBLIC_TO_EVERYONE');
    assert.equal(create.options.headers.Authorization, `Bearer ${process.env.ZERNIO_API_KEY}`);
    const status = await zernioPostStatus('post1', 'tiktok');
    assert.equal(status.url, 'https://www.tiktok.com/@topdata52/video/1');
    await zernioPost('facebook', 'https://media.zernio.com/temp/test.mp4', {
      accountId: 'account2', title: 'Reel title', caption: 'Reel caption'});
    await zernioPost('youtube', 'https://media.zernio.com/temp/test.mp4', {
      accountId: 'account3', title: 'Short title', description: 'Short description', privacy: 'private'});
    const created = calls.filter(call => call.address.endsWith('/posts')).map(call => JSON.parse(call.options.body));
    assert.deepEqual(created[1].platforms[0].platformSpecificData, {contentType: 'reel', title: 'Reel title'});
    assert.equal(created[2].platforms[0].platformSpecificData.visibility, 'private');
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'page-token';
    const facebook = await postFacebook(file, {accountId: 'account2', title: 'Reel title', caption: 'Reel caption'});
    assert.equal(facebook.provider, 'zernio');
    assert.equal(calls.at(-1).address, 'https://zernio.com/api/v1/posts');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = oldKey;
    if (oldFacebookToken === undefined) delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    else process.env.FACEBOOK_PAGE_ACCESS_TOKEN = oldFacebookToken;
    await unlink(file);
  }
});

test('Zernio reconciles a timed-out Facebook post instead of reporting failure', async () => {
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldFetch = globalThis.fetch;
  const mediaUrl = 'https://media.zernio.com/temp/timeout-test.mp4';
  const calls = [];
  process.env.ZERNIO_API_KEY = `sk_${'a'.repeat(64)}`;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({address, options});
    if (address.endsWith('/accounts')) return Response.json({accounts: [
      {_id: 'fb-account', platform: 'facebook', isActive: true}]});
    if (address.endsWith('/posts')) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (address.includes('/posts?page=1&limit=50')) return Response.json({posts: [{
      _id: 'published-reel', mediaItems: [{type: 'video', url: mediaUrl}],
      platforms: [{platform: 'facebook', accountId: 'fb-account', status: 'published',
        platformPostUrl: 'https://www.facebook.com/reel/123'}]}], pagination: {pages: 1}});
    throw new Error(`Unexpected request: ${address}`);
  };
  try {
    const result = await zernioPost('facebook', mediaUrl, {accountId: 'fb-account',
      title: 'Test', caption: 'Caption'});
    assert.equal(result.state, 'published');
    assert.equal(result.id, 'published-reel');
    assert.equal(result.url, 'https://www.facebook.com/reel/123');
    const create = calls.find(call => call.address.endsWith('/posts'));
    assert.equal(create.options.headers['Idempotency-Key'], create.options.headers['x-request-id']);
    assert.ok(create.options.headers['Idempotency-Key']);
    assert.equal(create.options.signal.aborted, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = oldKey;
  }
});

test('Zernio keeps an unresolved timeout pending for later verification', async () => {
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldFetch = globalThis.fetch;
  const mediaUrl = 'https://media.zernio.com/temp/pending-test.mp4';
  process.env.ZERNIO_API_KEY = `sk_${'a'.repeat(64)}`;
  globalThis.fetch = async (url) => {
    const address = String(url);
    if (address.endsWith('/accounts')) return Response.json({accounts: [
      {_id: 'fb-account', platform: 'facebook', isActive: true}]});
    if (address.endsWith('/posts')) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (address.includes('/posts?page=1&limit=50')) return Response.json({posts: [], pagination: {pages: 1}});
    throw new Error(`Unexpected request: ${address}`);
  };
  try {
    const result = await zernioPost('facebook', mediaUrl, {accountId: 'fb-account', caption: 'Caption'});
    assert.equal(result.state, 'verifying');
    assert.equal(result.mediaUrl, mediaUrl);
    assert.equal(result.accountId, 'fb-account');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = oldKey;
  }
});

test('a separate YouTube Zernio key handles account lookup, upload, post and status', async () => {
  const file = path.join(import.meta.dirname, 'zernio-youtube-test.mp4');
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldYouTubeKey = process.env.ZERNIO_YOUTUBE_API_KEY;
  const oldFetch = globalThis.fetch;
  const mainKey = `sk_${'a'.repeat(64)}`;
  const youtubeKey = `sk_${'b'.repeat(64)}`;
  const calls = [];
  process.env.ZERNIO_API_KEY = mainKey;
  process.env.ZERNIO_YOUTUBE_API_KEY = youtubeKey;
  await writeFile(file, Buffer.from('test-video'));
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({address, options});
    if (address.endsWith('/accounts')) {
      if (options.headers.Authorization === `Bearer ${youtubeKey}`) return Response.json({accounts: [
        {_id: 'yt-account', platform: 'youtube', username: 'New channel', isActive: true}]});
      if (options.headers.Authorization === `Bearer ${mainKey}`) return Response.json({accounts: [
        {_id: 'tt-account', platform: 'tiktok', isActive: true},
        {_id: 'fb-account', platform: 'facebook', isActive: true}]});
    }
    if (address.endsWith('/media/presign')) return Response.json({
      uploadUrl: 'https://bucket.r2.cloudflarestorage.com/temp/youtube.mp4',
      publicUrl: 'https://media.zernio.com/temp/youtube.mp4'});
    if (address.startsWith('https://bucket.r2.')) return new Response('', {status: 200});
    if (address.endsWith('/posts')) return Response.json({post: {_id: 'yt-post',
      platforms: [{platform: 'youtube', accountId: 'yt-account', status: 'processing'}]}}, {status: 201});
    if (address.endsWith('/posts/yt-post')) return Response.json({post: {_id: 'yt-post',
      platforms: [{platform: 'youtube', accountId: 'yt-account', status: 'published',
        platformPostUrl: 'https://www.youtube.com/watch?v=short1'}]}});
    throw new Error(`Unexpected request: ${address}`);
  };
  try {
    const accounts = await zernioAccounts();
    assert.deepEqual(accounts.map(account => account.platform).sort(), ['facebook', 'tiktok', 'youtube']);
    assert.equal(publishConfig().youtube.provider, 'zernio');
    const posted = await postYouTube(file, {accountId: 'yt-account', title: 'Short title',
      description: 'Short description', privacy: 'private'});
    assert.equal(posted.id, 'yt-post');
    const status = await zernioPostStatus('yt-post', 'youtube');
    assert.equal(status.url, 'https://www.youtube.com/watch?v=short1');
    const youtubeCalls = calls.filter(call => call.address.includes('zernio.com/api/v1') &&
      (call.address.endsWith('/media/presign') || call.address.endsWith('/posts') ||
        call.address.endsWith('/posts/yt-post') ||
        call.address.endsWith('/accounts') && call.options.headers.Authorization === `Bearer ${youtubeKey}`));
    assert.equal(youtubeCalls.length, 6);
    for (const call of youtubeCalls) {
      assert.equal(call.options.headers.Authorization, `Bearer ${youtubeKey}`);
    }
    const postCall = calls.find(call => call.address.endsWith('/posts'));
    assert.equal(JSON.parse(postCall.options.body).platforms[0].platformSpecificData.visibility, 'private');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = oldKey;
    if (oldYouTubeKey === undefined) delete process.env.ZERNIO_YOUTUBE_API_KEY;
    else process.env.ZERNIO_YOUTUBE_API_KEY = oldYouTubeKey;
    await unlink(file);
  }
});

test('Facebook Pages from both Zernio keys appear and post through their owning key', async () => {
  const file = path.join(import.meta.dirname, 'zernio-second-facebook-test.mp4');
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldYouTubeKey = process.env.ZERNIO_YOUTUBE_API_KEY;
  const oldFetch = globalThis.fetch;
  const primaryKey = `sk_${'a'.repeat(64)}`;
  const secondaryKey = `sk_${'b'.repeat(64)}`;
  const calls = [];
  process.env.ZERNIO_API_KEY = primaryKey;
  process.env.ZERNIO_YOUTUBE_API_KEY = secondaryKey;
  await writeFile(file, Buffer.from('test-video'));
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({address, options});
    const credential = options.headers?.Authorization;
    if (address.endsWith('/accounts')) return Response.json({accounts: credential === `Bearer ${primaryKey}`
      ? [{_id: 'fb-main', platform: 'facebook', username: 'Topdata', isActive: true}]
      : [{_id: 'fb-second', platform: 'facebook', username: 'Thương Trường', isActive: true},
        {_id: 'yt-second', platform: 'youtube', username: 'YouTube', isActive: true}]});
    if (address.endsWith('/media/presign')) return Response.json({
      uploadUrl: 'https://bucket.r2.cloudflarestorage.com/temp/facebook.mp4',
      publicUrl: 'https://media.zernio.com/temp/facebook.mp4'});
    if (address.startsWith('https://bucket.r2.')) return new Response('', {status: 200});
    if (address.endsWith('/posts')) return Response.json({post: {_id: 'fb-post',
      platforms: [{platform: 'facebook', accountId: 'fb-second', status: 'processing'}]}}, {status: 201});
    if (address.endsWith('/posts/fb-post')) return Response.json({post: {_id: 'fb-post',
      platforms: [{platform: 'facebook', accountId: 'fb-second', status: 'published'}]}});
    throw new Error(`Unexpected request: ${address}`);
  };
  try {
    const accounts = await zernioAccounts('facebook');
    assert.deepEqual(accounts.map(account => account.username), ['Topdata', 'Thương Trường']);
    const posted = await postFacebook(file, {accountId: 'fb-second', title: 'Reel', caption: 'Caption'});
    assert.equal(posted.accountId, 'fb-second');
    assert.equal(posted.id, 'fb-post');
    const status = await zernioPostStatus('fb-post', 'facebook', posted.accountId);
    assert.equal(status.state, 'published');
    for (const call of calls.filter(call => call.address.endsWith('/media/presign') ||
      call.address.endsWith('/posts') || call.address.endsWith('/posts/fb-post'))) {
      assert.equal(call.options.headers.Authorization, `Bearer ${secondaryKey}`);
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [['ZERNIO_API_KEY', oldKey], ['ZERNIO_YOUTUBE_API_KEY', oldYouTubeKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await unlink(file);
  }
});

test('YouTube Zernio connect uses its own key and profile', async () => {
  const oldKey = process.env.ZERNIO_API_KEY;
  const oldYouTubeKey = process.env.ZERNIO_YOUTUBE_API_KEY;
  const oldPrimaryProfile = process.env.ZERNIO_PROFILE_ID;
  const oldYouTubeProfile = process.env.ZERNIO_YOUTUBE_PROFILE_ID;
  const oldFetch = globalThis.fetch;
  const youtubeKey = `sk_${'b'.repeat(64)}`;
  process.env.ZERNIO_API_KEY = `sk_${'a'.repeat(64)}`;
  process.env.ZERNIO_YOUTUBE_API_KEY = youtubeKey;
  process.env.ZERNIO_PROFILE_ID = 'primary-profile';
  process.env.ZERNIO_YOUTUBE_PROFILE_ID = 'youtube-profile';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url: String(url), options});
    if (String(url).endsWith('/profiles')) return Response.json({profiles: [
      {_id: 'youtube-profile', name: 'YouTube'}]});
    return Response.json({authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test'});
  };
  try {
    const result = await zernioConnectUrl('youtube', 'http://127.0.0.1:4173/');
    assert.equal(result.profileId, 'youtube-profile');
    assert.ok(calls.every(call => call.options.headers.Authorization === `Bearer ${youtubeKey}`));
    assert.equal(new URL(calls[1].url).searchParams.get('profileId'), 'youtube-profile');
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [['ZERNIO_API_KEY', oldKey], ['ZERNIO_YOUTUBE_API_KEY', oldYouTubeKey],
      ['ZERNIO_PROFILE_ID', oldPrimaryProfile], ['ZERNIO_YOUTUBE_PROFILE_ID', oldYouTubeProfile]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
