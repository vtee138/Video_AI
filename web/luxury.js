const $ = selector => document.querySelector(selector);
const state = {scenes: [], categories: [], footage: [], tracks: [], session: null,
  selected: [], postCaption: '', defaultPostCaption: '', activeScene: 0, polling: null};
const currentSessionKey = 'luxury-current-session';
const localDraftKey = 'luxury-local-draft';
let draftTimer = null;
let draftSave = Promise.resolve();
let pendingDraft = null;

function localDraft() {
  try { return JSON.parse(localStorage.getItem(localDraftKey) || 'null'); }
  catch { return null; }
}

function draftData() {
  return {ids: [...state.selected], postCaption: state.postCaption, musicName: $('#musicSelect').value};
}

function queueDraftSave() {
  if (state.session?.status !== 'ready') return;
  const payload = {id: state.session.id, at: Date.now(), draft: draftData()};
  pendingDraft = payload;
  try { localStorage.setItem(localDraftKey, JSON.stringify(payload)); }
  catch { /* Server save still works when browser storage is unavailable. */ }
  $('#saveStatus').textContent = 'Đang lưu phiên…';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => void flushDraftSave().catch(() => {}), 250);
}

async function flushDraftSave() {
  clearTimeout(draftTimer); draftTimer = null;
  const payload = pendingDraft; pendingDraft = null;
  if (!payload) return draftSave;
  draftSave = draftSave.catch(() => {}).then(async () => {
    await api(`/api/luxury/sessions/${encodeURIComponent(payload.id)}/draft`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload.draft)});
    if (state.session?.id === payload.id && !pendingDraft) $('#saveStatus').textContent = 'Đã lưu phiên Luxury.';
  }).catch(error => {
    if (state.session?.id === payload.id) $('#saveStatus').textContent = `Chưa lưu được phiên: ${error.message}`;
    throw error;
  });
  return draftSave;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Máy chủ trả lỗi ${response.status}.`);
  return data;
}

function errorMessage(error) {
  $('#luxuryError').textContent = error instanceof Error ? error.message : String(error);
  $('#luxuryError').hidden = false;
  $('#luxuryError').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function clearError() { $('#luxuryError').hidden = true; $('#luxuryError').textContent = ''; }

function renderMusic() {
  const select = $('#musicSelect');
  const previous = select.value;
  select.replaceChildren(new Option(state.tracks.length ? 'Chọn nhạc Luxury' : 'Chưa có nhạc Luxury', ''));
  for (const track of state.tracks) select.add(new Option(track.name, track.name));
  select.value = state.tracks.some(track => track.name === previous) ? previous : state.tracks.length === 1 ? state.tracks[0].name : '';
  updateMusicPreview();
  updateReady();
}

function updateMusicPreview() {
  const track = state.tracks.find(item => item.name === $('#musicSelect').value);
  const player = $('#musicPreview');
  player.hidden = !track;
  if (track) player.src = track.url;
  else player.removeAttribute('src');
}

function updatePreview() {
  const index = state.activeScene;
  const clip = state.session?.candidates.find(item => item.slot === index && item.id === state.selected[index]);
  const player = $('#scenePreviewVideo');
  if (clip && player.dataset.clipId !== clip.id) {
    player.src = clip.previewUrl;
    player.poster = clip.thumbnail || '';
    player.dataset.clipId = clip.id;
  } else if (!clip && player.dataset.clipId) {
    player.pause(); player.removeAttribute('src'); player.removeAttribute('poster');
    delete player.dataset.clipId;
  }
}

function updateReady() {
  const ready = state.session?.status === 'ready' && state.scenes.every((_, index) =>
    state.selected[index]) &&
    new Set(state.selected).size === state.scenes.length && Boolean($('#musicSelect').value);
  $('#renderButton').disabled = !ready;
  $('#exportHint').textContent = ready
    ? 'Đã đủ 8 clip riêng và nhạc. Video sẽ render ở 1080 × 1920, không có chữ trên hình.'
    : 'Chọn đủ 8 clip khác nhau từ kho Luxury và một bản nhạc để render.';
}

function renderScenes() {
  const list = $('#sceneList');
  list.replaceChildren();
  state.scenes.forEach((scene, index) => {
    const row = document.createElement('article');
    row.className = 'luxury-scene';
    row.tabIndex = 0;
    const start = index * 3.75;
    const time = document.createElement('div');
    time.className = 'luxury-scene-time';
    time.textContent = `${start.toFixed(2)}–${(start + 3.75).toFixed(2)}s`;
    const main = document.createElement('div');
    main.className = 'luxury-scene-main';
    const head = document.createElement('div');
    head.className = 'luxury-scene-heading';
    const name = document.createElement('strong');
    name.textContent = scene.name;
    const count = document.createElement('span');
    const candidates = (state.session?.candidates || []).filter(item => item.slot === index);
    count.textContent = `${candidates.length} clip`;
    head.append(name, count);
    const selectWrap = document.createElement('div');
    selectWrap.className = 'luxury-scene-select';
    const selected = candidates.find(item => item.id === state.selected[index]);
    if (selected?.thumbnail) {
      const image = document.createElement('img'); image.src = selected.thumbnail;
      image.alt = ''; image.loading = 'lazy'; selectWrap.append(image);
    } else {
      const placeholder = document.createElement('span'); placeholder.className = 'luxury-no-image';
      placeholder.textContent = selected?.provider === 'Local' ? 'MP4' : 'Chưa có clip';
      selectWrap.append(placeholder);
    }
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Footage cho ${scene.name}`);
    select.add(new Option(candidates.length ? 'Chọn clip' : 'Chưa có clip · tải MP4 lên', ''));
    for (const candidate of candidates) select.add(new Option(
      `${candidate.provider} · ${candidate.description || scene.name}`.slice(0, 80), candidate.id));
    select.value = selected?.id || '';
    select.addEventListener('change', () => { state.selected[index] = select.value; state.activeScene = index; renderScenes(); updatePreview(); updateReady(); queueDraftSave(); });
    selectWrap.append(select);
    if (selected) {
      const preview = document.createElement('a');
      preview.href = selected.previewUrl; preview.target = '_blank'; preview.rel = 'noopener noreferrer';
      preview.textContent = 'Xem clip'; selectWrap.append(preview);
    }
    const actions = document.createElement('div'); actions.className = 'luxury-scene-actions';
    const library = document.createElement('a'); library.href = '#footageTitle';
    library.textContent = `Thêm clip vào nhóm ${state.categories.find(item => item.id === scene.category)?.name || scene.category}`;
    actions.append(library);
    main.append(head, selectWrap, actions); row.append(time, main);
    row.addEventListener('focus', () => { state.activeScene = index; updatePreview(); });
    row.addEventListener('click', () => { state.activeScene = index; updatePreview(); });
    list.append(row);
  });
}

function showSession(session) {
  if (state.polling) { clearInterval(state.polling); state.polling = null; }
  state.session = session;
  const local = localDraft();
  const draft = local?.id === session.id && local.at > Date.parse(session.updatedAt || 0)
    ? local.draft : session.draft;
  state.selected = state.scenes.map((_, index) => draft?.ids?.[index] ?? session.suggestedIds?.[index] ?? '');
  state.postCaption = draft?.postCaption ?? state.defaultPostCaption;
  $('#postCaption').value = state.postCaption;
  $('#postCaption').disabled = session.status !== 'ready';
  const musicName = draft?.musicName || (state.tracks.length === 1 ? state.tracks[0].name : '');
  $('#musicSelect').value = state.tracks.some(track => track.name === musicName) ? musicName : '';
  updateMusicPreview();
  try { localStorage.setItem(currentSessionKey, session.id); } catch { /* Optional browser hint. */ }
  const missing = state.selected.filter(value => !value).length;
  const limited = state.scenes.filter((_, index) =>
    session.candidates.filter(item => item.slot === index).length === 1).length;
  $('#searchStatus').textContent = `${session.candidates.length} clip trong 8 cảnh · ${missing
    ? `${missing} cảnh cần tải MP4 bổ sung` : 'đã chọn đủ 8 clip'}${limited
    ? ` · ${limited} cảnh chỉ có một clip` : ''}. ${session.summary || ''}`;
  $('#saveStatus').textContent = local?.id === session.id && local.at > Date.parse(session.updatedAt || 0)
    ? 'Đã khôi phục chỉnh sửa gần nhất; đang đồng bộ lên server.' : 'Đã lưu phiên Luxury.';
  $('#searchButton').textContent = 'Tạo bộ footage khác từ kho';
  $('#searchButton').disabled = ['queued', 'downloading', 'rendering'].includes(session.status);
  $('#renderResult').hidden = session.status !== 'done';
  $('#renderProgress').hidden = !['queued', 'downloading', 'rendering', 'done'].includes(session.status);
  if (session.status === 'done' && session.outputUrl) {
    $('#resultVideo').src = session.outputUrl;
    $('#downloadLink').href = session.outputUrl;
  } else $('#resultVideo').removeAttribute('src');
  if (session.status === 'error') errorMessage(session.error);
  if (['queued', 'downloading', 'rendering'].includes(session.status)) {
    updateProgress();
    state.polling = setInterval(() => void poll(), 1500);
  } else if (session.status === 'done') updateProgress();
  renderScenes(); updatePreview(); updateReady();
  if (local?.id === session.id && local.at > Date.parse(session.updatedAt || 0) && session.status === 'ready') queueDraftSave();
}

async function openSession(id) {
  clearError();
  await flushDraftSave();
  const {session} = await api(`/api/luxury/sessions/${encodeURIComponent(id)}`);
  showSession(session);
}

async function loadSessions() {
  const target = $('#luxurySessions');
  const {sessions} = await api('/api/luxury/sessions');
  target.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement('p'); empty.textContent = 'Chưa có phiên nào. Tạo bộ footage để bắt đầu.';
    target.append(empty); return sessions;
  }
  for (const session of sessions.slice(0, 8)) {
    const row = document.createElement('div'); row.className = 'luxury-session-row';
    const info = document.createElement('span');
    const status = session.status === 'ready' ? 'Bản nháp' : session.status === 'done' ? 'Hoàn tất'
      : ['queued', 'downloading', 'rendering'].includes(session.status) ? 'Đang dựng' : 'Lỗi';
    info.textContent = `${status} · ${session.selectedCount}/8 clip · ${new Date(session.updatedAt).toLocaleString('vi-VN')}`;
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = state.session?.id === session.id ? 'Đang mở' : 'Mở phiên';
    button.disabled = state.session?.id === session.id;
    button.addEventListener('click', () => void openSession(session.id).then(loadSessions).catch(errorMessage));
    row.append(info, button); target.append(row);
  }
  return sessions;
}

async function search() {
  clearError();
  const button = $('#searchButton'); button.disabled = true;
  $('#renderButton').disabled = true;
  $('#searchStatus').textContent = 'Đang chọn ngẫu nhiên clip từ kho Luxury…';
  try {
    await flushDraftSave();
    const {session} = await api('/api/luxury/search', {method: 'POST'});
    showSession(session);
    void loadSessions().catch(errorMessage);
  } catch (error) { errorMessage(error); $('#searchStatus').textContent = 'Không tìm được footage. Hãy thử lại.'; }
  finally { button.disabled = false; }
}

async function loadFootage() {
  const {clips} = await api('/api/luxury/footage');
  state.footage = clips;
  const target = $('#footageLibrary'); target.replaceChildren();
  for (const category of state.categories) {
    const group = document.createElement('div'); group.className = 'luxury-footage-group';
    const heading = document.createElement('h3');
    heading.textContent = category.name;
    const entries = clips.filter(item => item.category === category.id);
    const count = document.createElement('span'); count.textContent = `${entries.length} clip · cần ${category.required}`;
    heading.append(count); group.append(heading);
    if (!entries.length) {
      const empty = document.createElement('p'); empty.textContent = 'Chưa có MP4 trong nhóm này.';
      group.append(empty);
    }
    for (const clip of entries) {
      const row = document.createElement('div'); row.className = 'luxury-footage-row';
      const name = document.createElement('strong'); name.textContent = clip.name;
      const duration = document.createElement('span'); duration.textContent = `${Number(clip.duration).toFixed(1)}s`;
      const preview = document.createElement('a'); preview.href = clip.previewUrl;
      preview.target = '_blank'; preview.rel = 'noopener noreferrer'; preview.textContent = 'Xem';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Xóa';
      remove.addEventListener('click', () => void deleteFootage(clip).catch(errorMessage));
      row.append(name, duration, preview, remove); group.append(row);
    }
    target.append(group);
  }
  $('#footageStatus').textContent = `${clips.length} MP4 trong kho Luxury. ${state.categories
    .filter(category => clips.filter(item => item.category === category.id).length < category.required)
    .length} nhóm cần thêm clip để đủ 8 cảnh.`;
}

async function uploadFootage() {
  const input = $('#footageInput'); const files = [...(input.files || [])]; input.value = '';
  if (!files.length) return;
  clearError();
  try {
    const category = $('#footageCategory').value;
    for (const [index, file] of files.entries()) {
      $('#footageStatus').textContent = `Đang tải ${index + 1}/${files.length}: ${file.name}`;
      await api(`/api/luxury/footage/${category}`, {method: 'POST',
        headers: {'Content-Type': 'video/mp4', 'X-File-Name': encodeURIComponent(file.name)}, body: file});
    }
    await loadFootage();
    if (state.session?.status === 'ready') await openSession(state.session.id);
    $('#footageStatus').textContent = `Đã thêm ${files.length} MP4 vào kho Luxury.`;
  } catch (error) { await loadFootage().catch(() => {}); errorMessage(error); }
}

async function deleteFootage(clip) {
  if (!window.confirm(`Xóa ${clip.name} khỏi kho footage Luxury?`)) return;
  await api(`/api/luxury/footage/${encodeURIComponent(clip.id)}`, {method: 'DELETE'});
  await loadFootage();
  if (state.session?.status === 'ready') await openSession(state.session.id);
}

async function uploadMusic() {
  const input = $('#musicInput'); const file = input.files?.[0]; input.value = '';
  if (!file) return;
  clearError();
  try {
    const {track} = await api('/api/music?kind=luxury', {method: 'POST',
      headers: {'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name)}, body: file});
    state.tracks.push(track); renderMusic(); $('#musicSelect').value = track.name;
    updateMusicPreview(); updateReady(); queueDraftSave();
  } catch (error) { errorMessage(error); }
}

async function render() {
  clearError();
  const button = $('#renderButton'); button.disabled = true;
  try {
    await flushDraftSave();
    const {session} = await api(`/api/luxury/sessions/${state.session.id}/render`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids: state.selected, postCaption: state.postCaption, musicName: $('#musicSelect').value})});
    state.session = session;
    $('#postCaption').disabled = true;
    $('#saveStatus').textContent = 'Đã lưu phiên Luxury; đang dựng video.';
    $('#renderProgress').hidden = false;
    $('#searchButton').disabled = true;
    updateProgress();
    state.polling = setInterval(() => void poll(), 1500);
  } catch (error) { errorMessage(error); updateReady(); }
}

function updateProgress() {
  const session = state.session;
  $('#progressFill').style.width = `${Math.round((session.progress || 0) * 100)}%`;
  $('#progressText').textContent = session.status === 'downloading' ? 'Đang tải footage…'
    : session.status === 'rendering' ? `Đang render · ${Math.round(session.progress * 100)}%`
      : session.status === 'done' ? 'Video đã hoàn tất.' : 'Đang chờ lượt render…';
}

async function poll() {
  try {
    const {session} = await api(`/api/luxury/sessions/${state.session.id}`);
    state.session = session; updateProgress();
    if (session.status === 'done' || session.status === 'error') {
      clearInterval(state.polling); state.polling = null;
      $('#searchButton').disabled = false;
      $('#searchButton').textContent = 'Tạo bộ footage khác từ kho';
      void loadSessions().catch(errorMessage);
      if (session.status === 'error') { errorMessage(session.error); return; }
      $('#renderResult').hidden = false;
      $('#resultVideo').src = session.outputUrl;
      $('#downloadLink').href = session.outputUrl;
      void loadHistory();
    }
  } catch (error) { clearInterval(state.polling); state.polling = null; $('#searchButton').disabled = false; errorMessage(error); }
}

async function loadHistory() {
  const target = $('#luxuryHistory');
  try {
    const {outputs} = await api('/api/outputs?kind=luxury');
    target.replaceChildren();
    if (!outputs.length) {
      const empty = document.createElement('p'); empty.textContent = 'Chưa có video Luxury nào.';
      target.append(empty); return;
    }
    for (const item of outputs) {
      const row = document.createElement('div'); row.className = 'luxury-history-row';
      const details = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = item.title;
      const date = document.createElement('small');
      date.textContent = new Date(item.modifiedAt).toLocaleString('vi-VN');
      details.append(title, date);
      const link = document.createElement('a'); link.href = item.outputUrl;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Xem MP4';
      row.append(details, link); target.append(row);
    }
  } catch (error) {
    target.textContent = `Không tải được thư viện: ${error.message}`;
  }
}

async function init() {
  try {
    const {scenes, categories, defaultPostCaption, tracks} = await api('/api/luxury/plan');
    state.scenes = scenes; state.categories = categories; state.tracks = tracks;
    state.defaultPostCaption = defaultPostCaption; state.postCaption = defaultPostCaption;
    state.selected = scenes.map(() => '');
    $('#postCaption').value = defaultPostCaption;
    $('#postCaption').disabled = true;
    const categorySelect = $('#footageCategory');
    categorySelect.replaceChildren(...categories.map(category => new Option(category.name, category.id)));
    renderScenes(); renderMusic(); updatePreview(); updateReady();
    await loadFootage();
    const saved = await loadSessions();
    let remembered;
    try { remembered = localStorage.getItem(currentSessionKey); } catch { /* Optional browser hint. */ }
    const id = saved.find(item => item.id === remembered)?.id ||
      saved.find(item => ['queued', 'downloading', 'rendering'].includes(item.status))?.id ||
      saved.find(item => item.status === 'ready')?.id;
    if (id) { await openSession(id); await loadSessions(); }
    void loadHistory();
  } catch (error) { errorMessage(error); }
}

$('#searchButton').addEventListener('click', () => void search());
$('#footageInput').addEventListener('change', () => void uploadFootage());
$('#musicInput').addEventListener('change', () => void uploadMusic());
$('#musicSelect').addEventListener('change', () => { updateMusicPreview(); updateReady(); queueDraftSave(); });
$('#postCaption').addEventListener('input', () => { state.postCaption = $('#postCaption').value; queueDraftSave(); });
$('#renderButton').addEventListener('click', () => void render());
$('#copyCaption').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.postCaption); $('#copyCaption').textContent = 'Đã sao chép'; }
  catch (error) { errorMessage(error); }
});
void init();
