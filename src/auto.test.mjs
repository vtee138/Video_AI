import assert from 'node:assert/strict';
import {test} from 'node:test';
import {autoPostTargets, selectAutoFootage, validateAutoSettings} from './auto.mjs';

test('Auto mode chọn footage Ranking theo nhiều truy vấn và không lặp clip', () => {
  const candidates = Array.from({length: 16}, (_, index) => ({id: String(index), query: index < 8 ? 'cảnh A' : 'cảnh B'}));
  const selected = selectAutoFootage(candidates, 'ranking', 8);
  assert.equal(selected.length, 12);
  assert.deepEqual(selected.slice(0, 4).map(item => item.query), ['cảnh A', 'cảnh B', 'cảnh A', 'cảnh B']);
  assert.equal(new Set(selected.map(item => item.id)).size, 12);
});

test('Auto mode bắt buộc đồng ý, tài khoản hợp lệ và quyền riêng tư TikTok', async () => {
  const config = {provider: 'zernio', platforms: {tiktok: {provider: 'zernio', configured: true}},
    accounts: [{id: 'account-1', platform: 'tiktok', active: true}]};
  const creator = async () => ({privacy_level_options: ['SELF_ONLY'], duet_disabled: true});
  const input = {enabled: true, consent: true,
    targets: {tiktok: {accountId: 'account-1', privacy: 'SELF_ONLY', allowComment: true, allowDuet: true, isAigc: true}}};
  await assert.rejects(validateAutoSettings({...input, consent: false}, config, creator), /đồng ý/);
  await assert.rejects(validateAutoSettings({...input, targets: {tiktok: {...input.targets.tiktok, accountId: 'other'}}}, config, creator), /tài khoản/);
  await assert.rejects(validateAutoSettings({...input, targets: {tiktok: {...input.targets.tiktok, privacy: 'PUBLIC_TO_EVERYONE'}}}, config, creator), /Quyền riêng tư/);
  const settings = await validateAutoSettings(input, config, creator);
  assert.deepEqual(settings.tiktok, {accountId: 'account-1', privacy: 'SELF_ONLY',
    allowComment: true, allowDuet: false, allowStitch: false, isAigc: true});
});

test('Nội dung đăng tự động lấy từ video đã render', () => {
  const targets = autoPostTargets({facebook: {state: 'PUBLISHED'}, youtube: {privacy: 'private'}},
    'Video mẫu', 'Caption mẫu');
  assert.deepEqual(targets.facebook, {state: 'PUBLISHED', title: 'Video mẫu', caption: 'Caption mẫu'});
  assert.deepEqual(targets.youtube, {privacy: 'private', title: 'Video mẫu', description: 'Caption mẫu'});
});

test('Auto/Super Auto mặc định công khai và dùng bản đăng riêng theo nền tảng', async () => {
  const config = {platforms: {
    tiktok: {provider: 'direct', configured: true},
    facebook: {provider: 'direct', configured: true},
    youtube: {provider: 'direct', configured: true},
  }, accounts: []};
  const creator = async () => ({privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY']});
  const settings = await validateAutoSettings({enabled: true, consent: true,
    targets: {tiktok: {}, facebook: {}, youtube: {}}}, config, creator);
  assert.equal(settings.tiktok.privacy, 'PUBLIC_TO_EVERYONE');
  assert.equal(settings.youtube.privacy, 'public');
  assert.equal(settings.facebook.state, 'PUBLISHED');
  assert.equal(settings.tiktok.isAigc, false);
  assert.equal(settings.youtube.madeForKids, false);
  assert.equal(settings.youtube.containsSyntheticMedia, false);
  const targets = autoPostTargets(settings, 'Top xe bán chạy',
    'Toyota dẫn đầu bảng năm 2025.\n\n#oto #fyp #toyota #doanhso #xehoi');
  assert.equal(targets.tiktok.caption,
    'Toyota dẫn đầu bảng năm 2025.\n\n#oto #toyota #doanhso #xehoi');
  assert.equal(targets.facebook.caption,
    'Toyota dẫn đầu bảng năm 2025.\n\n#oto #toyota #doanhso');
  assert.equal(targets.youtube.description, targets.facebook.caption);
  assert.equal(targets.youtube.title, 'Top xe bán chạy');
});

test('Auto giữ lựa chọn riêng tư rõ ràng và chặn mặc định TikTok không được hỗ trợ', async () => {
  const config = {platforms: {tiktok: {provider: 'direct', configured: true},
    youtube: {provider: 'direct', configured: true}}, accounts: []};
  const creator = async () => ({privacy_level_options: ['SELF_ONLY']});
  await assert.rejects(validateAutoSettings({enabled: true, consent: true,
    targets: {tiktok: {}}}, config, creator), /Quyền riêng tư/);
  const settings = await validateAutoSettings({enabled: true, consent: true,
    targets: {tiktok: {privacy: 'SELF_ONLY'}, youtube: {privacy: 'unlisted'}}}, config, creator);
  assert.equal(settings.tiktok.privacy, 'SELF_ONLY');
  assert.equal(settings.youtube.privacy, 'unlisted');
  assert.equal(autoPostTargets({youtube: {}}, 'Tiêu đề', 'Nội dung').youtube.privacy, 'public');
});
