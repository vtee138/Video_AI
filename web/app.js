const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// Mirrors web/post-copy.mjs so an already-running local server can serve this update.
function composePostCopy(title, caption) {
  const cleanTitle = String(title || '').trim().replace(/\s+/gu, ' ').slice(0, 100);
  const cleanCaption = String(caption || '').replace(/(?:\r?\n){2}Nguồn dữ liệu \([^\r\n]*\):[\s\S]*$/u, '').trim();
  const lines = cleanCaption.split(/\r?\n/u);
  const tagLine = lines.at(-1) || '';
  const trailingTags = /^(?:\s*#[\p{L}\p{N}_]+\s*)+$/u.test(tagLine)
    ? (tagLine.match(/#[\p{L}\p{N}_]+/gu) || []) : [];
  const body = (trailingTags.length ? lines.slice(0, -1).join('\n') : cleanCaption).trim() || cleanTitle;
  const genericTags = new Set(['fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'xuhuong']);
  const tags = [...new Set(trailingTags.filter(tag => !genericTags.has(tag.slice(1).toLowerCase())))];
  const withTags = (limit) => [body, tags.slice(0, limit).join(' ')].filter(Boolean).join('\n\n');
  return {
    tiktok: {caption: withTags(5).slice(0, 2200)},
    facebook: {title: cleanTitle, caption: withTags(3)},
    youtube: {title: cleanTitle, description: withTags(3)},
  };
}

const state = {
  template: 'ranking',
  quoteMode: 'caption',
  runId: null,
  ideas: [],
  selectedIdeas: new Set(),
  queue: [],
  queueStatus: null,
  queueCanPause: false,
  queueActionPending: false,
  currentStage: 'topic',
  currentPage: 'overview',
  maxStage: 0,
  polling: null,
  activeResultId: null,
  reviewJobId: null,
  reviewSelections: new Set(),
  quoteImages: [],
  recoverId: null,
  publishItem: null,
  publishSelectedPlatform: null,
  postId: null,
  postPolling: null,
  tiktokCreatorRequest: 0,
  publishProvider: 'direct',
  publishPlatforms: {},
  savedOutput: null,
  recentOutputs: [],
  autoConfig: null,
  autoConfigPromise: null,
  autoCreatorRequest: 0,
  musicTracks: [],
};

const stageOrder = ['topic', 'ideas', 'queue', 'footage', 'results'];
const stagePaths = {topic: '/create', ideas: '/create/ideas', queue: '/create/queue',
  footage: '/create/footage', results: '/create/results'};
const pagePaths = {overview: '/', automation: '/automation', flow: '/flow', publishing: '/publishing',
  library: '/library', music: '/music'};
const pageCopy = {
  overview: ['Tổng quan', 'Bắt đầu một video mới hoặc tiếp tục công việc đang dở.'],
  automation: ['Tự động hóa', 'Thiết lập Auto mode và quản lý chiến dịch Super Auto.'],
  flow: ['Thử đồ Flow', 'Tạo ảnh thử đồ, duyệt ảnh và theo dõi video từ Google Flow.'],
  publishing: ['Xuất bản', 'Kiểm soát kết quả đăng của từng video trên từng nền tảng.'],
  library: ['Thư viện', 'Xem lại video đã tạo và trạng thái đăng bài.'],
  music: ['Kho nhạc', 'Thêm và điều chỉnh nhạc nền dùng cho video mới.'],
};
const stageCopy = {
  topic: 'Hôm nay bạn muốn xếp hạng điều gì?',
  ideas: 'Chọn nhiều góc cho một lần sản xuất',
  queue: 'Hàng chờ đang tạo video tuần tự',
  footage: 'Chọn cảnh cho video',
  results: 'Kết quả trong phiên sản xuất',
};

const quickPrompts = {
  ranking: [
    ['Quốc gia', 'Dân số thế giới', 'Các quốc gia có dân số lớn nhất hiện nay'],
    ['Du lịch', 'Thành phố hút khách', 'Các thành phố đón nhiều khách quốc tế nhất'],
    ['Công nghệ', 'Doanh nghiệp dẫn đầu', 'Các công ty công nghệ giá trị nhất thế giới'],
  ],
  quote: [
    ['Kỷ luật', 'Làm dù không ai nhìn', 'Kỷ luật là giữ lời hứa với bản thân khi không ai kiểm tra'],
    ['Kinh doanh', 'Cái giá của quyết định', 'Trong kinh doanh, quyết định chậm cũng có giá của nó'],
    ['Đàn ông', 'Giữ lời, chịu trách nhiệm', 'Bản lĩnh đàn ông thể hiện ở cách giữ lời và chịu trách nhiệm'],
  ],
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Máy chủ trả lỗi ${response.status}.`);
  return data;
}

function showError(error) {
  $('#errorText').textContent = error instanceof Error ? error.message : String(error);
  $('#errorNotice').hidden = false;
  $('#errorNotice').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function clearError() {
  $('#errorNotice').hidden = true;
  $('#errorText').textContent = '';
}

function setLoading(active, message = 'Đang xử lý…') {
  $('#loadingText').textContent = message;
  $('#loadingSheet').hidden = !active;
  $(`#stage-${state.currentStage}`).hidden = active;
}

function updatePageChrome(page) {
  state.currentPage = page;
  $('.app-shell').dataset.page = page;
  $$('.primary-link').forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#runId').hidden = page !== 'create';
  $('#stepCounter').hidden = page !== 'create';
}

function updatePath(path, replace = false) {
  if (window.location.pathname === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}

function setPage(page, {history = true, replace = false} = {}) {
  if (page === 'create') {
    setStage(state.currentStage, {history, replace});
    return;
  }
  if (!pageCopy[page]) return;
  updatePageChrome(page);
  $$('.page').forEach(section => { section.hidden = section.id !== `page-${page}`; });
  $$('.stage').forEach(section => { section.hidden = true; section.classList.remove('active'); });
  $('#loadingSheet').hidden = true;
  $('#pageTitle').textContent = pageCopy[page][0];
  $('#pageDescription').textContent = pageCopy[page][1];
  document.title = `${pageCopy[page][0]} · AI Video Studio`;
  if (history) updatePath(pagePaths[page], replace);
  if (page === 'publishing') void refreshOutputs();
  if (page === 'flow') void window.refreshFlow?.();
  if (page === 'music') void refreshMusic().catch(showError);
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function setStage(name, {history = true, replace = false} = {}) {
  if (name === 'footage' && !state.reviewJobId) return;
  if (!stageOrder.includes(name)) return;
  updatePageChrome('create');
  state.currentStage = name;
  const index = stageOrder.indexOf(name);
  state.maxStage = Math.max(state.maxStage, index);
  $$('.page').forEach(section => { section.hidden = true; });
  $$('.stage').forEach(section => {
    section.hidden = section.id !== `stage-${name}`;
    section.classList.toggle('active', section.id === `stage-${name}`);
  });
  $('#loadingSheet').hidden = true;
  $$('.workflow-step').forEach((step, stepIndex) => {
    step.disabled = stepIndex > state.maxStage || (step.dataset.stage === 'footage' && !state.reviewJobId);
    step.classList.toggle('active', step.dataset.stage === name);
    step.classList.toggle('complete', stepIndex < index);
  });
  $('#stepCounter').textContent = `${index + 1} / 5`;
  $('#pageTitle').textContent = name === 'topic' && state.template === 'quote'
    ? 'Hôm nay bạn muốn nói thẳng điều gì?'
    : name === 'footage' && state.template === 'quote' ? 'Chọn ảnh cho video'
    : stageCopy[name];
  $('#pageDescription').textContent = ['Chọn kiểu video và nhập chủ đề.', 'Chọn những ý tưởng muốn sản xuất.',
    'Theo dõi tiến độ từng video.', 'Duyệt clip trước khi render.', 'Xem, tải và đăng video hoàn tất.'][index];
  document.title = `${['Tạo video', 'Chọn video', 'Hàng chờ', 'Footage', 'Kết quả'][index]} · AI Video Studio`;
  if (history) updatePath(stagePaths[name], replace);
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function setRunSummary(text) {
  $('#runSummary p').textContent = text;
}

function statusLabel(status) {
  return {actual: 'Số công bố', estimate: 'Ước tính', forecast: 'Dự báo'}[status] || status;
}

function selectTemplate(template) {
  state.template = template;
  if (template === 'quote') state.quoteMode = 'caption';
  if (template === 'quote') void loadQuoteImages().catch(showError);
  $$('[data-template]').forEach(button => {
    const selected = button.dataset.template === template;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  $('#quoteMode').hidden = template !== 'quote';
  $('#topicLabel').textContent = template === 'quote' ? 'Chủ đề hoặc quy tắc sống' : 'Chủ đề video';
  $('#topicInput').placeholder = template === 'quote'
    ? 'Ví dụ: Kỷ luật khi không ai nhìn thấy'
    : 'Ví dụ: Các quốc gia có dân số lớn nhất hiện nay';
  $('#ideaButtonText').textContent = template === 'quote' ? 'Tạo 8 Quote' : 'Tạo góc nội dung';
  $('#quickDescription').textContent = template === 'quote'
    ? 'Chọn một góc nhìn về kỷ luật, kinh doanh hoặc bản lĩnh rồi chỉnh theo ý bạn.'
    : 'Chọn một chủ đề, sau đó sửa lại theo ý bạn.';
  $$('.prompt-list button').forEach((button, index) => {
    const [group, title, prompt] = quickPrompts[template][index];
    button.dataset.prompt = prompt;
    button.querySelector('span').textContent = group;
    button.querySelector('strong').textContent = title;
  });
  $('#specDuration').textContent = template === 'quote' ? '30–40 giây theo nhạc' : '30 giây';
  $('#specLayout').textContent = template === 'quote'
    ? (state.quoteMode === 'caption' ? 'Hook trên ảnh · caption' : 'Quote xuyên suốt')
    : 'Top 10 xuyên suốt';
  $('#previewEmpty').classList.toggle('quote', template === 'quote');
  $('#mockQuote').hidden = template !== 'quote';
  if (state.currentStage === 'topic') $('#pageTitle').textContent = template === 'quote'
    ? 'Hôm nay bạn muốn nói thẳng điều gì?' : stageCopy.topic;
}

function renderQuoteImages() {
  $('#quoteImageCount').textContent = state.quoteImages.length
    ? `${state.quoteImages.length} ảnh trong kho · JPG, PNG hoặc WebP · tối đa 20 MB mỗi ảnh`
    : 'Kho ảnh đang trống. Upload ít nhất một ảnh trước khi tạo video Quote.';
  $('#quoteImageList').replaceChildren(...state.quoteImages.map(item => {
    const card = document.createElement('div');
    card.className = 'quote-library-item';
    const image = document.createElement('img');
    image.src = item.url;
    image.alt = 'Ảnh trong kho Quote';
    image.loading = 'lazy';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Xóa';
    remove.setAttribute('aria-label', 'Xóa ảnh này khỏi kho Quote');
    remove.addEventListener('click', async () => {
      if (!window.confirm('Xóa ảnh này khỏi kho Quote?')) return;
      try {
        await api(`/api/quote-images/${encodeURIComponent(item.id)}`, {method: 'DELETE'});
        state.quoteImages = state.quoteImages.filter(image => image.id !== item.id);
        const job = state.queue.find(job => job.id === state.reviewJobId);
        if (job?.template === 'quote' && job.footage) {
          job.footage.candidates = job.footage.candidates.filter(image => image.id !== item.id);
          state.reviewSelections.delete(item.id);
          renderFootage();
        }
        renderQuoteImages();
      } catch (error) { showError(error); }
    });
    card.append(image, remove);
    return card;
  }));
}

async function loadQuoteImages() {
  const data = await api('/api/quote-images');
  state.quoteImages = data.images;
  renderQuoteImages();
}

function selectQuoteMode(mode) {
  state.quoteMode = mode;
  if (state.template === 'quote') $('#specLayout').textContent = mode === 'caption'
    ? 'Hook trên ảnh · caption' : 'Quote xuyên suốt';
}

function renderZernioConnectActions(selector, config) {
  const container = $(selector);
  container.replaceChildren();
  if (config.provider === 'direct') { container.hidden = true; return; }
  for (const [platform, label] of Object.entries(publishLabels)) {
    if (config.platforms?.[platform]?.provider !== 'zernio') continue;
    if (config.accounts?.some(account => account.platform === platform && account.active)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-button';
    button.textContent = `Kết nối ${label} qua Zernio`;
    button.addEventListener('click', () => startZernioConnect(platform));
    container.append(button);
  }
  container.hidden = !container.childElementCount;
}

async function startZernioConnect(platform) {
  try {
    const {authUrl, nonce, alreadyConnected, account} = await api('/api/posts/connect', {
      method: 'POST', body: JSON.stringify({platform}),
    });
    if (alreadyConnected) {
      $('#zernioNoticeText').textContent = `${publishLabels[platform]}: ${account.username || account.id}.`;
      $('#zernioNotice').hidden = false;
      state.autoConfig = null;
      if (!$('#publishPanel').hidden) await openPublish(state.publishItem, state.publishSelectedPlatform);
      else if ($('#autoModeToggle').checked) await loadAutoConfig();
      return;
    }
    const outputName = state.publishItem?.outputUrl?.split('/').pop() || '';
    sessionStorage.setItem('zernioConnect', JSON.stringify({platform, nonce, outputName,
      autoMode: $('#autoModeToggle').checked}));
    window.location.assign(authUrl);
  } catch (error) {
    if (!$('#publishPanel').hidden) showPublishError(error);
    else showError(error);
  }
}

async function restoreZernioConnect() {
  const params = new URLSearchParams(window.location.search);
  const nonce = params.get('zernio_state');
  if (!nonce) return;
  window.history.replaceState(null, '', window.location.pathname);
  const saved = sessionStorage.getItem('zernioConnect');
  sessionStorage.removeItem('zernioConnect');
  try {
    const pending = saved && JSON.parse(saved);
    if (!pending || pending.nonce !== nonce || pending.platform !== params.get('zernio_platform')) {
      throw new Error('Phiên kết nối Zernio không khớp. Hãy bắt đầu lại từ ứng dụng.');
    }
    if (params.has('error')) throw new Error(`Zernio chưa kết nối: ${(params.get('error_message') || params.get('error')).slice(0, 240)}`);
    if (params.get('connected') !== pending.platform || !params.get('accountId')) {
      throw new Error('Zernio chưa xác nhận tài khoản đã kết nối. Hãy thử lại.');
    }
    state.autoConfig = null;
    const config = await api('/api/posts/config');
    const account = config.accounts?.find(item => item.id === params.get('accountId') &&
      item.platform === pending.platform && item.active);
    if (!account) throw new Error('Zernio chưa trả tài khoản đang hoạt động. Hãy tải lại trang và thử lại.');
    $('#zernioNoticeText').textContent = `${publishLabels[pending.platform]}: ${account.username || account.id}.`;
    $('#zernioNotice').hidden = false;
    if (pending.outputName) {
      await refreshOutputs();
      const output = state.recentOutputs.find(item => item.outputUrl?.split('/').pop() === pending.outputName);
      if (output) {
        state.savedOutput = output;
        renderResults();
        setStage('results');
        await openPublish(output);
        const checkbox = $(`input[name="platform"][value="${pending.platform}"]`);
        checkbox.checked = true;
        $(`#${pending.platform}Account`).value = account.id;
        await updatePublishOptions();
      }
    } else if (pending.autoMode) {
      $('#autoModeToggle').checked = true;
      $('#autoModeToggle').dispatchEvent(new Event('change'));
    }
  } catch (error) { showError(error); }
}

async function loadAutoConfig() {
  if (state.autoConfig) return state.autoConfig;
  if (!state.autoConfigPromise) {
    $('#autoConfigHint').textContent = 'Đang kiểm tra tài khoản đã kết nối…';
    state.autoConfigPromise = api('/api/posts/config').then(config => {
      state.autoConfig = config;
      renderZernioConnectActions('#autoConnectActions', config);
      $$('input[name="autoPlatform"]').forEach(input => {
        input.disabled = !config.platforms[input.value]?.configured;
      });
      if (config.provider !== 'direct') {
        for (const platform of Object.keys(publishLabels)) {
          const accounts = config.accounts.filter(account => account.platform === platform && account.active);
          const options = accounts.map(account => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.username || account.id;
            return option;
          });
          if (options.length > 1) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'Chọn tài khoản';
            options.unshift(empty);
          }
          $(`#auto${platform[0].toUpperCase()}${platform.slice(1)}Account`).replaceChildren(...options);
        }
      }
      const available = Object.entries(config.platforms).filter(([, value]) => value.configured).map(([key]) => publishLabels[key]);
      $('#autoConfigHint').textContent = available.length
        ? `Đã kết nối: ${available.join(', ')}. Chọn nơi muốn đăng.`
        : 'Chưa có nền tảng đăng bài nào được kết nối. Kiểm tra .env hoặc Zernio.';
      updateAutoOptions();
      return config;
    }).finally(() => { state.autoConfigPromise = null; });
  }
  return state.autoConfigPromise;
}

function updateAutoOptions() {
  const selected = new Set($$('input[name="autoPlatform"]:checked').map(input => input.value));
  $('#autoAccountFields').hidden = ![...selected].some(platform => state.autoConfig?.platforms[platform]?.provider === 'zernio');
  for (const platform of Object.keys(publishLabels)) {
    $(`#auto${platform[0].toUpperCase()}${platform.slice(1)}AccountField`).hidden =
      state.autoConfig?.platforms[platform]?.provider !== 'zernio' || !selected.has(platform);
  }
  $('#autoTiktokOptions').hidden = !selected.has('tiktok');
  $('#autoYoutubeOptions').hidden = !selected.has('youtube');
  $('#autoFacebookNote').hidden = !selected.has('facebook');
  if (selected.has('tiktok')) void loadAutoTikTokCreator();
  else { state.autoCreatorRequest++; $('#autoTiktokPrivacy').replaceChildren(); }
}

async function loadAutoTikTokCreator() {
  const request = ++state.autoCreatorRequest;
  const accountId = state.autoConfig?.platforms.tiktok?.provider === 'zernio' ? $('#autoTiktokAccount').value : '';
  $('#autoTiktokPrivacy').replaceChildren();
  if (state.autoConfig?.platforms.tiktok?.provider === 'zernio' && !accountId) {
    $('#autoTiktokHint').textContent = 'Chọn tài khoản TikTok để lấy quyền riêng tư.';
    return;
  }
  $('#autoTiktokHint').textContent = 'Đang lấy quyền riêng tư TikTok…';
  try {
    const {creator} = await api(`/api/posts/tiktok/creator${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`);
    if (request !== state.autoCreatorRequest) return;
    if (!creator.privacy_level_options?.length) throw new Error('TikTok không trả lựa chọn quyền riêng tư.');
    const privacyPlaceholder = document.createElement('option');
    privacyPlaceholder.value = '';
    privacyPlaceholder.textContent = 'Chọn quyền riêng tư';
    $('#autoTiktokPrivacy').replaceChildren(privacyPlaceholder, ...creator.privacy_level_options.map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = privacyLabels[value] || value;
      return option;
    }));
    if (creator.privacy_level_options.includes('PUBLIC_TO_EVERYONE')) {
      $('#autoTiktokPrivacy').value = 'PUBLIC_TO_EVERYONE';
    }
    for (const [id, disabled] of [['autoTiktokComment', creator.comment_disabled],
      ['autoTiktokDuet', creator.duet_disabled], ['autoTiktokStitch', creator.stitch_disabled]]) {
      $( `#${id}`).disabled = Boolean(disabled);
      if (disabled) $(`#${id}`).checked = false;
    }
    $('#autoTiktokHint').textContent = `Đã kết nối @${creator.creator_username || 'TikTok'}.`;
  } catch (error) {
    if (request !== state.autoCreatorRequest) return;
    $('#autoTiktokHint').textContent = `Không thể lấy quyền riêng tư TikTok: ${error.message}`;
  }
}

async function autoInput({superMode = false} = {}) {
  if (!$('#autoModeToggle').checked) return null;
  await loadAutoConfig();
  const selected = $$('input[name="autoPlatform"]:checked').map(input => input.value);
  if (!selected.length) throw new Error('Auto mode cần ít nhất một nền tảng đã kết nối.');
  if (!(superMode ? $('#superConsent') : $('#autoConsent')).checked) {
    throw new Error(superMode ? 'Hãy đồng ý để Super Auto tự tạo và đăng bài.' :
      'Hãy đồng ý đăng tự động trước khi chạy Auto mode.');
  }
  const targets = {};
  for (const platform of selected) {
    const accountId = state.autoConfig.platforms[platform]?.provider === 'zernio'
      ? $(`#auto${platform[0].toUpperCase()}${platform.slice(1)}Account`).value : '';
    if (state.autoConfig.platforms[platform]?.provider === 'zernio' && !accountId) throw new Error(`Hãy chọn tài khoản ${publishLabels[platform]}.`);
    targets[platform] = accountId ? {accountId} : {};
  }
  if (targets.tiktok) {
    if (!$('#autoTiktokPrivacy').value) throw new Error('Hãy chọn quyền riêng tư TikTok trước khi chạy.');
    Object.assign(targets.tiktok, {privacy: $('#autoTiktokPrivacy').value,
      allowComment: $('#autoTiktokComment').checked, allowDuet: $('#autoTiktokDuet').checked,
      allowStitch: $('#autoTiktokStitch').checked, isAigc: $('#autoTiktokAigc').checked});
  }
  if (targets.youtube) Object.assign(targets.youtube, {privacy: $('#autoYoutubePrivacy').value,
    madeForKids: $('#autoYoutubeMadeForKids').checked,
    containsSyntheticMedia: $('#autoYoutubeSynthetic').checked});
  return {enabled: true, consent: true, targets};
}

const superTime = value => new Date(value).toLocaleString('vi-VN', {dateStyle: 'short', timeStyle: 'short'});
const superStatus = {active: 'Đang chạy', attention: 'Cần kiểm tra', stopped: 'Đã dừng',
  planning: 'Đang tìm chủ đề · Chưa đăng', producing: 'Đang tạo video · Chưa đăng',
  manual_review: 'Chờ bổ sung footage · Chưa đăng',
  scheduled: 'Chờ giờ đăng · Chưa đăng', publishing: 'Đang gửi bài', sent: 'Đã đăng',
  failed: 'Có lỗi · Chưa đăng', needs_review: 'Cần kiểm tra đã đăng hay chưa',
  canceled: 'Đã hủy · Chưa đăng'};

function superItemErrors(item) {
  const messages = [];
  if (item.error) messages.push(item.error);
  for (const [platform, result] of Object.entries(item.postResults || {})) {
    const message = result.error || result.statusError;
    if (message) messages.push(`${publishLabels[platform] || platform}: ${message}`);
  }
  return [...new Set(messages)];
}

async function retrySuperAutoItem(campaign, item, button) {
  const idleLabel = button.dataset.idleLabel || 'Retry video';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Đang Retry…';
  clearError();
  try {
    const {campaigns} = await api(`/api/super-auto/${encodeURIComponent(campaign.id)}/items/${encodeURIComponent(item.id)}/retry`,
      {method: 'POST'});
    renderSuperCampaigns(campaigns);
    const {sessions} = await api('/api/sessions');
    renderActivity(sessions, campaigns);
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = idleLabel;
    showError(error);
  }
}

async function retryAllFailedSuperAuto(campaign, button) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Đang xếp hàng…';
  clearError();
  try {
    const result = await api(`/api/super-auto/${encodeURIComponent(campaign.id)}/retry-failed`, {
      method: 'POST', body: JSON.stringify({}),
    });
    renderSuperCampaigns(result.campaigns);
    button.textContent = `Đã xếp ${result.queued} video`;
    const {sessions} = await api('/api/sessions');
    renderActivity(sessions, result.campaigns);
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'Retry tất cả video lỗi';
    showError(error);
  }
}

const isSuperFootageShortage = item => item.jobId &&
  /Chỉ tìm được \d+\/\d+ clip phù hợp\./u.test(String(item.error || '')) &&
  String(item.error).includes('Hãy chạy thủ công');

async function openSuperAutoFootage(campaign, item, button) {
  const idleLabel = button.dataset.idleLabel || 'Bổ sung footage';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Đang mở footage…';
  clearError();
  try {
    const {queue} = await api(`/api/super-auto/${encodeURIComponent(campaign.id)}/items/${encodeURIComponent(item.id)}/footage`,
      {method: 'POST'});
    if (state.polling) clearInterval(state.polling);
    state.runId = queue.id;
    state.maxStage = 3;
    $('#runId').textContent = `Video Super Auto · ${item.topic || 'chưa đặt tên'}`;
    $('#queueIntro').textContent = 'Video Super Auto đang chờ bạn bổ sung footage. Sau khi xác nhận, video sẽ tiếp tục render và trở lại lịch đăng nếu chiến dịch còn chạy.';
    updateQueue(queue);
    const reviewItem = state.queue.find(job => job.id === item.jobId) ||
      state.queue.find(job => job.status === 'footage_review');
    if (!reviewItem?.footage) throw new Error('Không mở được danh sách footage của video này.');
    state.polling = setInterval(pollQueue, 1500);
    openFootage(reviewItem.id);
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = idleLabel;
    showError(error);
  }
}

function renderSuperCampaigns(campaigns) {
  const list = $('#superCampaigns');
  list.replaceChildren();
  const busy = campaigns.some(campaign => ['active', 'attention'].includes(campaign.status));
  $('#superStartButton').disabled = busy;
  if (!campaigns.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Chưa có chiến dịch Super Auto.';
    list.append(empty);
    return;
  }
  for (const campaign of campaigns.slice(0, 3)) {
    const section = document.createElement('section');
    section.className = 'super-campaign';
    const heading = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${superStatus[campaign.status]} · ${campaign.template === 'quote' ? 'Quote' : 'Ranking'}`;
    heading.append(title);
    const detail = document.createElement('p');
    detail.textContent = campaign.status === 'stopped'
      ? `Đã dừng · khoảng cách đã đặt ${campaign.intervalMinutes} phút`
      : `Bài tiếp theo: từ ${superTime(campaign.nextAt)} · cách nhau tối thiểu ${campaign.intervalMinutes} phút`;
    section.append(heading, detail);
    const totals = document.createElement('p');
    const c = campaign.counts;
    const retryPending = campaign.items.filter(item => item.retryRequested).length;
    totals.textContent = `${c.sent} bài đã đăng · ${c.producing} đang tạo · ${c.scheduled} chờ giờ đăng · ${c.publishing} đang đăng` +
      `${c.manualReview ? ` · ${c.manualReview} chờ footage` : ''}` +
      `${retryPending ? ` · ${retryPending} chờ Retry` : ''}${c.failed ? ` · ${c.failed} lỗi` : ''}`;
    section.append(totals);
    if (campaign.error) {
      const error = document.createElement('p');
      error.textContent = campaign.error;
      section.append(error);
    }
    if (c.failed && !retryPending && c.producing + (c.manualReview || 0) + c.scheduled + c.publishing === 0) {
      const retryAll = document.createElement('button');
      retryAll.type = 'button';
      retryAll.className = 'mini-button';
      retryAll.textContent = campaign.status === 'stopped' ? 'Retry tất cả và chạy tiếp' : 'Retry tất cả video lỗi';
      retryAll.addEventListener('click', () => void retryAllFailedSuperAuto(campaign, retryAll));
      section.append(retryAll);
    }
    if (campaign.items.length) {
      const items = document.createElement('ul');
      const visibleItems = campaign.items.filter((item, index) => index < 5 ||
        ['failed', 'manual_review', 'needs_review'].includes(item.status));
      for (const item of visibleItems) {
        const row = document.createElement('li');
        row.className = `super-item ${item.status}`;
        const main = document.createElement('div');
        main.className = 'super-item-main';
        const label = document.createElement('strong');
        label.textContent = item.topic || 'Đang tìm chủ đề';
        const platforms = item.postResults ? Object.entries(item.postResults)
          .map(([key, result]) => `${publishLabels[key] || key}: ${result.state === 'published' ? 'đã đăng' : result.state === 'ready' ? 'đã tải lên' : result.state === 'failed' ? 'lỗi' : result.state === 'interrupted' ? 'cần kiểm tra' : 'đang xử lý'}`).join(' · ') : '';
        const meta = document.createElement('span');
        meta.textContent = `${item.retryRequested ? 'Đã xếp hàng Retry · Chưa đăng' : superStatus[item.status] || item.status}` +
          `${item.status === 'scheduled' ? ` lúc ${superTime(item.scheduledAt)}` : ''}` +
          `${platforms ? ` · ${platforms}` : ''}`;
        main.append(label, meta);
        for (const message of superItemErrors(item)) {
          const error = document.createElement('p');
          error.className = 'super-item-error';
          error.textContent = `Lỗi: ${message}`;
          main.append(error);
        }
        const actions = document.createElement('div');
        actions.className = 'super-item-actions';
        if (item.outputName) {
          const link = document.createElement('a');
          link.href = `/output/${encodeURIComponent(item.outputName)}`;
          link.textContent = 'Xem video';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          actions.append(link);
        }
        const canRetry = item.status === 'failed' && !item.retryRequested && !item.postId;
        const canRepairFootage = !item.retryRequested && !item.postId &&
          (item.status === 'manual_review' || canRetry && isSuperFootageShortage(item));
        if (canRepairFootage) {
          const repair = document.createElement('button');
          repair.type = 'button';
          repair.className = 'mini-button primary';
          repair.dataset.idleLabel = item.status === 'manual_review' ? 'Tiếp tục bổ sung' : 'Bổ sung footage';
          repair.textContent = repair.dataset.idleLabel;
          repair.addEventListener('click', () => void openSuperAutoFootage(campaign, item, repair));
          actions.append(repair);
        }
        if (canRetry && c.producing + (c.manualReview || 0) + c.scheduled + c.publishing === 0) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'mini-button';
          retry.dataset.idleLabel = campaign.status === 'stopped' ? 'Retry và chạy tiếp' : 'Retry video';
          retry.textContent = retry.dataset.idleLabel;
          retry.addEventListener('click', () => void retrySuperAutoItem(campaign, item, retry));
          actions.append(retry);
        }
        row.append(main);
        if (actions.childElementCount) row.append(actions);
        items.append(row);
      }
      section.append(items);
    }
    if (campaign.status === 'active' || campaign.status === 'attention') {
      const stop = document.createElement('button');
      stop.type = 'button'; stop.className = 'mini-button'; stop.textContent = 'Dừng Super Auto';
      stop.addEventListener('click', async () => {
        try {
          await api(`/api/super-auto/${encodeURIComponent(campaign.id)}/stop`, {method: 'POST'});
          await refreshSuperCampaigns();
        } catch (error) { showError(error); }
      });
      section.append(stop);
    }
    if (campaign.status === 'attention') {
      const resume = document.createElement('button');
      resume.type = 'button'; resume.className = 'mini-button';
      const unresolvedPost = campaign.items.some(item => item.status === 'needs_review');
      resume.textContent = unresolvedPost ? 'Đã kiểm tra, tiếp tục' : 'Thử lại';
      resume.addEventListener('click', async () => {
        if (unresolvedPost && !window.confirm('Bạn đã kiểm tra bài đang dở trên các nền tảng? Bài đó sẽ không được gửi lại tự động.')) return;
        try {
          await api(`/api/super-auto/${encodeURIComponent(campaign.id)}/resume`, {method: 'POST'});
          await refreshSuperCampaigns();
        } catch (error) { showError(error); }
      });
      section.append(resume);
    }
    list.append(section);
  }
}

async function refreshSuperCampaigns() {
  const [{sessions}, {campaigns}] = await Promise.all([api('/api/sessions'), api('/api/super-auto')]);
  renderSuperCampaigns(campaigns);
  renderActivity(sessions, campaigns);
}

function jobStatus(status) {
  return {
    queued: 'Đang chờ', researching: 'Tìm dữ liệu', review: 'Đã có dữ liệu',
    preparing: 'Chuẩn bị', footage_review: 'Chọn footage', render_queued: 'Chờ render',
    downloading: 'Đang tải clip', rendering: 'Đang render', publishing: 'Đang đăng', done: 'Hoàn tất', error: 'Có lỗi',
    paused: 'Tạm dừng', pausing: 'Đang chờ dừng',
  }[status] || status;
}

function renderIdeas() {
  const list = $('#ideaList');
  list.replaceChildren();
  state.ideas.forEach((idea, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'idea-option';
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', String(state.selectedIdeas.has(index)));
    button.dataset.index = String(index);

    const check = document.createElement('span');
    check.className = 'idea-radio';
    check.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('span');
    copy.className = 'idea-copy';
    const title = document.createElement('strong');
    title.textContent = idea.title;
    const description = document.createElement('p');
    description.textContent = state.template === 'quote'
      ? (state.quoteMode === 'caption' ? `${idea.hookText} · ${idea.captionText}` : idea.quoteText)
      : idea.whyInteresting;
    copy.append(title, description);

    const meta = document.createElement('span');
    meta.className = 'idea-meta';
    const period = document.createElement('span');
    period.className = 'tag';
    period.textContent = state.template === 'quote' ? 'Nguyên bản' : idea.latestPeriod;
    const status = document.createElement('span');
    status.className = `tag ${state.template === 'quote' ? 'quote' : idea.dataStatus}`;
    status.textContent = state.template === 'quote'
      ? (state.quoteMode === 'caption' ? 'Ở caption' : 'Trên video')
      : statusLabel(idea.dataStatus);
    meta.append(period, status);
    button.append(check, copy, meta);
    button.addEventListener('click', () => toggleIdea(index));
    list.append(button);
  });
  updateIdeaSelection();
}

function toggleIdea(index) {
  if (state.selectedIdeas.has(index)) state.selectedIdeas.delete(index);
  else state.selectedIdeas.add(index);
  updateIdeaSelection();
}

function updateIdeaSelection() {
  $$('.idea-option').forEach(button => {
    const selected = state.selectedIdeas.has(Number(button.dataset.index));
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  const count = state.selectedIdeas.size;
  $('#queueButton').disabled = count === 0;
  $('#queueButtonText').textContent = $('#autoModeToggle').checked
    ? count ? `Bắt đầu tự động với ${count} video` : 'Chọn video để bắt đầu'
    : count ? `Đưa ${count} video vào hàng chờ` : 'Đưa vào hàng chờ';
  $('#ideaHint').textContent = count ? `Đã chọn ${count}/${state.ideas.length} ý tưởng.` : 'Chưa chọn video nào.';
}

function updateIdeasIntro() {
  const autoEnabled = $('#autoModeToggle').checked;
  $('#ideasTitle').textContent = state.template === 'quote'
    ? autoEnabled ? 'Chọn Quote muốn tạo và đăng' : 'Chọn các Quote muốn tạo'
    : autoEnabled ? 'Chọn video muốn tạo và đăng' : 'Chọn các video muốn tạo';
  $('#ideasDescription').textContent = autoEnabled
    ? 'Chọn đúng các video bạn muốn đăng. Sau khi bấm bắt đầu, Auto mode sẽ tự lấy footage, render và đăng.'
    : state.template === 'quote'
      ? `8 nội dung nguyên bản · ${state.quoteMode === 'caption' ? 'hook trên video, 5 ý ở caption' : 'toàn bộ chữ trên video'}.`
      : 'Chọn nhiều góc. Hệ thống sẽ đưa tất cả vào hàng chờ và xử lý tuần tự.';
}

function progressPercent(value) {
  return Math.max(0, Math.min(100, Math.round((value || 0) * 100)));
}

function makeAction(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function showPreview(item, {openDialog = true} = {}) {
  if (!item?.outputUrl) return;
  state.activeResultId = item.id;
  $('#videoPreview').src = item.outputUrl;
  $('#videoPreview').hidden = false;
  $('#previewEmpty').hidden = true;
  $('#previewStatus').textContent = item.title;
  if (window.matchMedia('(max-width: 1180px)').matches && openDialog) {
    $('#videoPreview').pause();
    $('#previewDialogTitle').textContent = item.title;
    $('#dialogVideo').src = item.outputUrl;
    $('#previewDialog').showModal();
    $('#dialogVideo').play().catch(() => {});
  } else if (!window.matchMedia('(max-width: 1180px)').matches) {
    $('#videoPreview').play().catch(() => {});
  }
  renderResults();
}

async function copyCaption(item, button) {
  try {
    await navigator.clipboard.writeText(cleanCaption(item.caption));
    const old = button.textContent;
    button.textContent = 'Đã sao chép';
    setTimeout(() => { button.textContent = old; }, 1600);
  } catch {
    showError('Trình duyệt không cho phép sao chép. Caption vẫn được lưu trong thư mục .tmp của video.');
  }
}

function cleanCaption(caption) {
  return String(caption || '').replace(/(?:\r?\n){2}Nguồn dữ liệu \([^\r\n]*\):[\s\S]*$/u, '').trim();
}

function createJobCard(item, index) {
  const card = document.createElement('article');
  card.className = `queue-card status-${item.status}`;
  const top = document.createElement('div');
  top.className = 'queue-card-top';
  const order = document.createElement('span');
  order.className = 'queue-order';
  order.textContent = String(index + 1).padStart(2, '0');
  const copy = document.createElement('div');
  copy.className = 'queue-copy';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const step = document.createElement('p');
  step.textContent = item.error || item.step;
  copy.append(title, step);
  const badge = document.createElement('span');
  badge.className = `job-badge ${item.status}`;
  badge.textContent = item.template === 'quote' && item.status === 'footage_review' ? 'Chọn ảnh' : jobStatus(item.status);
  top.append(order, copy, badge);
  const track = document.createElement('div');
  track.className = 'job-progress';
  const fill = document.createElement('i');
  fill.style.transform = `scaleX(${progressPercent(item.progress) / 100})`;
  track.append(fill);
  card.append(top, track);
  if (item.status === 'footage_review') {
    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    actions.append(makeAction(item.template === 'quote'
      ? `Chọn ảnh · ${item.footage?.candidates.length || 0} trong kho`
      : `Chọn footage · ${item.footage?.candidates.length || 0} gợi ý`,
      'mini-button primary', () => openFootage(item.id)));
    card.append(actions);
  }
  if (item.status === 'done' && item.outputUrl) {
    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    actions.append(makeAction('Xem trước', 'mini-button', () => showPreview(item)));
    const download = document.createElement('a');
    download.className = 'mini-button primary';
    download.href = item.outputUrl;
    download.download = '';
    download.textContent = 'Tải MP4';
    actions.append(download);
    card.append(actions);
  }
  return card;
}

function renderQueue() {
  $('#queueList').replaceChildren(...state.queue.map(createJobCard));
  const completed = state.queue.filter(item => item.status === 'done').length;
  const failed = state.queue.filter(item => item.status === 'error').length;
  const reviewing = state.queue.filter(item => item.status === 'footage_review').length;
  const average = state.queue.length
    ? state.queue.reduce((sum, item) => sum + (item.progress || 0), 0) / state.queue.length : 0;
  const percent = progressPercent(average);
  $('#queueCount').textContent = `${completed}/${state.queue.length} hoàn tất`;
  const pauseButton = $('#queuePauseButton');
  const terminal = ['done', 'done_with_errors'].includes(state.queueStatus);
  pauseButton.hidden = terminal || !state.queue.length || !state.queueCanPause;
  pauseButton.disabled = Boolean(state.queueActionPending);
  pauseButton.textContent = state.queueActionPending ? 'Đang cập nhật…'
    : ['paused', 'pausing'].includes(state.queueStatus) ? 'Tiếp tục hàng chờ'
      : 'Tạm dừng tiến trình';
  $('#batchProgressBar').style.transform = `scaleX(${percent / 100})`;
  $('.batch-progress .progress-track').setAttribute('aria-valuenow', String(percent));
  $('#batchProgressValue').textContent = `${percent}%`;
  $('#batchProgressText').textContent = state.queueStatus === 'paused'
    ? `${completed} hoàn tất · hàng chờ đã tạm dừng`
    : state.queueStatus === 'pausing' ? `${completed} hoàn tất · đang chờ video hiện tại`
    : failed
    ? `${completed} hoàn tất · ${failed} lỗi · các video khác vẫn tiếp tục`
    : `${completed} hoàn tất · ${state.queue.length - completed} đang chờ hoặc xử lý`;
  $('#viewResultsButton').disabled = completed + failed === 0;
  $('#queueFooter').textContent = state.queueStatus === 'paused'
    ? 'Hàng chờ đã tạm dừng. Bấm Tiếp tục hàng chờ để xử lý các video còn lại.'
    : state.queueStatus === 'pausing'
      ? 'Đang dừng render. Video này sẽ dựng lại từ đầu khi tiếp tục; bước khác đang chạy sẽ hoàn tất trước khi dừng.'
      : !terminal
    ? reviewing ? `${reviewing} video đang chờ bạn chọn ${state.template === 'quote' ? 'ảnh' : 'footage'}. Các video khác tiếp tục chuẩn bị.`
      : 'Hàng chờ chạy tuần tự; có thể giữ trang mở để theo dõi.'
    : `Đã xử lý xong ${state.queue.length} video trong hàng chờ.`;
}

$('#queuePauseButton').addEventListener('click', async () => {
  if (!state.runId || state.queueActionPending) return;
  const action = ['paused', 'pausing'].includes(state.queueStatus) ? 'resume' : 'pause';
  state.queueActionPending = true;
  renderQueue();
  try {
    const {queue} = await api(`/api/runs/${encodeURIComponent(state.runId)}/queue/${action}`, {method: 'POST'});
    updateQueue(queue);
  } catch (error) { showError(error); }
  finally { state.queueActionPending = false; renderQueue(); }
});

function openFootage(id) {
  const item = state.queue.find(job => job.id === id);
  if (!item?.footage) return;
  state.reviewJobId = id;
  state.reviewSelections = new Set(item.footage.preselectedIds || []);
  renderFootage();
  setStage('footage');
}

function renderFootage() {
  const item = state.queue.find(job => job.id === state.reviewJobId);
  if (!item?.footage) return;
  $('#footageTitle').textContent = item.title;
  $('#footageIntro').textContent = item.template === 'quote'
    ? `Video ${item.duration} giây dùng đúng một ảnh. Ảnh đã được chọn ngẫu nhiên; bạn có thể đổi trước khi render.`
    : item.manualSuperReview
      ? 'Bổ sung MP4 cho đúng video Super Auto này, sau đó chọn 8–20 clip. Thứ tự chọn là thứ tự cắt cảnh trong video.'
      : 'Xem từng clip, chọn 8–20 clip khác nhau. Thứ tự chọn là thứ tự cắt cảnh trong video.';
  const candidates = item.footage.candidates;
  $('#localClipLabel').hidden = item.template === 'quote';
  $('#quoteImageLabel').hidden = item.template !== 'quote';
  const counts = Object.entries(candidates.reduce((acc, candidate) => {
    acc[candidate.provider] = (acc[candidate.provider] || 0) + 1;
    return acc;
  }, {})).map(([name, count]) => `${name} ${count}`);
  $('#footageSources').textContent = item.template === 'quote'
    ? `${candidates.length} ảnh trong kho Quote${candidates.length ? ' · chọn một ảnh' : ' · upload ảnh để bắt đầu'}`
    : `${candidates.length} clip gợi ý · ${counts.join(' · ') || 'Thêm MP4 local để bắt đầu'}`;
  const warning = item.footage.warnings || [];
  $('#footageWarning').hidden = warning.length === 0;
  $('#footageWarning').textContent = warning.length ? `${warning.length} lượt tìm kiếm không hoàn tất. Bạn vẫn có thể chọn clip hiện có hoặc thêm MP4 local.` : '';
  const nodes = candidates.map(candidate => {
    const card = document.createElement('article');
    card.className = 'footage-card';
    if (item.template === 'quote') card.classList.add('quote-image-card');
    card.classList.toggle('selected', state.reviewSelections.has(candidate.id));
    const visual = document.createElement('div');
    visual.className = 'footage-visual';
    if (item.template === 'quote' || candidate.thumbnail) {
      const image = document.createElement('img');
      image.src = item.template === 'quote' ? candidate.url : candidate.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      visual.append(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.textContent = 'MP4';
      visual.append(placeholder);
    }
    const video = item.template === 'quote' ? null : document.createElement('video');
    if (video) {
      video.controls = true;
      video.playsInline = true;
      video.preload = 'none';
      video.hidden = true;
      visual.append(video);
    }
    const copy = document.createElement('div');
    copy.className = 'footage-copy';
    const heading = document.createElement('strong');
    heading.textContent = item.template === 'quote' ? 'Ảnh Quote' : candidate.subject || candidate.query || candidate.description || 'Clip stock';
    const meta = document.createElement('p');
    meta.textContent = item.template === 'quote' ? `${Math.round(candidate.size / 1024)} KB · Ảnh trong kho`
      : `${candidate.provider} · ${candidate.duration ? `${Math.round(candidate.duration)} giây · ` : ''}${candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : 'MP4 local'}`;
    const description = document.createElement('p');
    description.className = 'footage-description';
    description.textContent = item.template === 'quote' ? 'Một ảnh nền xuyên suốt video' : candidate.description || candidate.query;
    copy.append(heading, meta, description);
    const actions = document.createElement('div');
    actions.className = 'footage-card-actions';
    const select = makeAction(state.reviewSelections.has(candidate.id) ? 'Đã chọn' : item.template === 'quote' ? 'Chọn ảnh' : 'Chọn clip',
      state.reviewSelections.has(candidate.id) ? 'mini-button primary' : 'mini-button', () => {
        if (state.reviewSelections.has(candidate.id)) state.reviewSelections.delete(candidate.id);
        else if (item.template === 'quote') { state.reviewSelections.clear(); state.reviewSelections.add(candidate.id); }
        else if (state.reviewSelections.size < 20) state.reviewSelections.add(candidate.id);
        renderFootage();
      });
    select.setAttribute('aria-pressed', String(state.reviewSelections.has(candidate.id)));
    actions.append(select);
    if (video) actions.append(makeAction('Xem clip', 'mini-button', () => {
      if (!video.src) video.src = candidate.previewUrl;
      video.hidden = false;
      video.play().catch(() => {});
    }));
    if (candidate.sourceUrl) {
      const link = document.createElement('a');
      link.className = 'footage-source';
      link.href = candidate.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `Nguồn ${candidate.provider} ↗`;
      actions.append(link);
    }
    card.append(visual, copy, actions);
    return card;
  });
  $('#footageList').replaceChildren(...nodes);
  updateFootageSelection();
}

function updateFootageSelection() {
  const count = state.reviewSelections.size;
  const item = state.queue.find(job => job.id === state.reviewJobId);
  const target = item?.footage?.requiredClips || 8;
  const minimum = item?.template === 'quote' ? target : 8;
  $('#footageHint').textContent = item?.template === 'quote'
    ? count === 1 ? 'Đã chọn một ảnh. Sẵn sàng render.' : 'Hãy chọn một ảnh hoặc upload vào kho Quote.'
    : count < minimum ? `Đã chọn ${count}/${minimum} clip cần cho video này. Có thể upload MP4 để bổ sung.`
      : `Đã chọn ${count} clip. Sẵn sàng render.`;
  $('#confirmFootage').textContent = item?.template === 'quote' ? 'Render với ảnh đã chọn' : 'Tải clip đã chọn và render';
  $('#confirmFootage').disabled = item?.template === 'quote' ? count !== 1 : count < minimum || count > 20;
}

function createResultCard(item) {
  const card = document.createElement('article');
  card.className = `result-card ${state.activeResultId === item.id ? 'active' : ''}`;
  const head = document.createElement('div');
  head.className = 'result-card-head';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = item.title;
  const meta = document.createElement('p');
  meta.textContent = item.metricPeriod || item.latestPeriod || (item.error ? 'Không thể hoàn tất' : `Video ${item.duration || 30} giây`);
  copy.append(title, meta);
  if (item.status === 'done' && item.outputUrl) copy.append(publicationBadge(item));
  const badge = document.createElement('span');
  badge.className = `job-badge ${item.status}`;
  badge.textContent = jobStatus(item.status);
  head.append(copy, badge);
  card.append(head);
  if (item.status === 'done' && item.outputUrl) {
    const actions = document.createElement('div');
    actions.className = 'result-card-actions';
    actions.append(makeAction('Xem', 'mini-button', () => showPreview(item)));
    const download = document.createElement('a');
    download.className = 'mini-button primary';
    download.href = item.outputUrl;
    download.download = '';
    download.textContent = 'Tải MP4';
    const caption = makeAction('Sao chép caption', 'mini-button', event => copyCaption(item, event.currentTarget));
    actions.append(download, caption);
    const latestPost = item.post || item.posts?.[0];
    actions.append(makeAction(latestPost ? 'Đăng thêm' : 'Đăng video', 'mini-button primary', () => openPublish(item)));
    if (item.publicationStatus !== 'posted' && item.manualPublication !== 'posted') {
      actions.append(makeAction('Đã đăng ngoài hệ thống', 'mini-button', () => markOutput(item, 'posted')));
      if (item.publicationStatus === 'unknown') {
        actions.append(makeAction('Xác nhận chưa đăng', 'mini-button', () => markOutput(item, 'not_posted')));
      }
    } else if (item.manualPublication === 'posted' && !item.posts?.some(post =>
      Object.values(post.results).some(result => result.state === 'published'))) {
      actions.append(makeAction('Đánh dấu chưa đăng', 'mini-button', () => markOutput(item, 'not_posted')));
    }
    card.append(actions);
    if (latestPost) {
      const post = document.createElement('div');
      post.className = 'auto-post-results';
      for (const [platform, result] of Object.entries(latestPost.results)) {
        const row = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = publishLabels[platform];
        const status = document.createElement('span');
        status.className = `auto-post-${result.state}`;
        status.textContent = ({queued: 'Đang chờ', uploading: 'Đang tải', processing: 'Đang xử lý',
          published: 'Đã đăng', ready: 'Đã tải lên', failed: 'Đăng lỗi', interrupted: 'Chưa rõ'})[result.state] || result.state;
        row.append(label, status);
        if (result.url) {
          const link = document.createElement('a');
          link.href = result.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Mở bài đăng';
          row.append(link);
        }
        if (result.error) {
          const error = document.createElement('p');
          error.textContent = result.error;
          row.append(error);
        }
        post.append(row);
      }
      if (Object.values(latestPost.results).some(result => result.state === 'processing' ||
        result.state === 'published' && result.provider === 'zernio' && !result.url)) {
        post.append(makeAction('Cập nhật trạng thái đăng', 'mini-button', async () => {
          try {
            const {post: latest} = await api(`/api/posts/${encodeURIComponent(latestPost.id)}?refresh=1`);
            item.post = latest;
            await refreshOutputs();
            renderResults();
          } catch (error) { showError(error); }
        }));
      }
      card.append(post);
    }
  } else {
    const error = document.createElement('p');
    error.className = 'result-error';
    error.textContent = item.status === 'done' ? 'Video đã xóa khỏi Thư viện.'
      : item.error || 'Video không thể hoàn tất.';
    card.append(error);
  }
  return card;
}

function publicationBadge(item) {
  const status = item.publicationStatus || (item.post ?
    Object.values(item.post.results).some(result => result.state === 'published') ? 'posted'
      : 'posting' : 'not_posted');
  const badge = document.createElement('span');
  badge.className = `publication-badge status-${status}`;
  badge.textContent = ({posted: 'Đã đăng', not_posted: 'Chưa đăng', posting: 'Đang đăng', uploaded: 'Đã tải lên',
    failed: 'Chưa đăng · lỗi', unknown: 'Chưa xác minh'})[status] || 'Chưa xác minh';
  return badge;
}

const publicationStateLabels = {published: 'Đã đăng', ready: 'Đã tải lên', queued: 'Đang chờ',
  uploading: 'Đang tải', processing: 'Đang xử lý', verifying: 'Đang xác minh',
  failed: 'Có lỗi', interrupted: 'Cần kiểm tra'};

function platformPublication(item, platform) {
  const results = (item.posts || []).map(post => ({post, result: post.results?.[platform]}))
    .filter(entry => entry.result);
  return results.find(entry => entry.result.state === 'published') ||
    results.find(entry => entry.result.state === 'ready') || results[0] || null;
}

function publicationCategory(item) {
  const entries = Object.keys(publishLabels).map(platform => platformPublication(item, platform)?.result || null);
  const published = entries.filter(result => result?.state === 'published').length;
  if (published === 3) return 'complete';
  if (entries.some(result => ['queued', 'uploading', 'processing', 'verifying'].includes(result?.state))) return 'active';
  if (entries.some(result => ['failed', 'interrupted'].includes(result?.state))) return 'failed';
  if (published || entries.some(result => result?.state === 'ready')) return 'partial';
  return 'none';
}

function publicationPlatformCell(item, platform) {
  const cell = document.createElement('div');
  cell.className = 'publishing-platform';
  cell.dataset.label = publishLabels[platform];
  const entry = platformPublication(item, platform);
  const stateName = entry?.result?.state || 'none';
  const status = document.createElement('span');
  status.className = `platform-state state-${stateName}`;
  status.textContent = entry ? publicationStateLabels[stateName] || stateName : 'Chưa đăng';
  cell.append(status);
  if (entry?.result?.url) {
    const link = document.createElement('a');
    link.href = entry.result.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Mở bài đăng ↗';
    cell.append(link);
  }
  const message = entry?.result?.error || entry?.result?.statusError;
  if (message) {
    const error = document.createElement('small');
    error.textContent = message;
    cell.append(error);
  }
  if (stateName === 'none' || stateName === 'failed') {
    const action = makeAction(stateName === 'failed' ? 'Thử lại' : 'Đăng',
      'mini-button publishing-action', () => openPublish(item, platform));
    action.setAttribute('aria-label', `${stateName === 'failed' ? 'Thử lại' : 'Đăng'} ${publishLabels[platform]}: ${item.title}`);
    cell.append(action);
  }
  return cell;
}

function renderPublicationLedger(outputs) {
  const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const query = normalize($('#publishingSearch').value.trim());
  const filter = $('#publishingFilter').value;
  const categories = outputs.map(item => ({item, category: publicationCategory(item)}));
  $('#publishingTotal').textContent = outputs.length;
  $('#publishingComplete').textContent = categories.filter(entry => entry.category === 'complete').length;
  $('#publishingPartial').textContent = categories.filter(entry => entry.category === 'partial').length;
  $('#publishingAttention').textContent = categories.filter(entry => ['active', 'failed'].includes(entry.category)).length;
  const visible = categories.filter(({item, category}) =>
    (!query || normalize(item.title).includes(query)) && (filter === 'all' || category === filter));
  const rows = visible.map(({item, category}) => {
    const row = document.createElement('article');
    row.className = `publishing-row category-${category}`;
    row.setAttribute('role', 'row');
    const video = document.createElement('div');
    video.className = 'publishing-video';
    video.setAttribute('role', 'cell');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = `${new Date(item.modifiedAt).toLocaleString('vi-VN')} · ${item.template === 'quote' ? 'Quote' : 'Ranking'}`;
    const link = document.createElement('a');
    link.href = item.outputUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Xem video';
    video.append(title, meta, link);
    row.append(video, ...Object.keys(publishLabels).map(platform => publicationPlatformCell(item, platform)));
    return row;
  });
  $('#publishingRows').replaceChildren(...rows);
  $('#publishingEmpty').hidden = rows.length > 0;
}

async function refreshPublicationStatuses() {
  const button = $('#refreshPublishing');
  button.disabled = true;
  button.textContent = 'Đang cập nhật…';
  try {
    const pending = [];
    for (const item of state.recentOutputs) for (const post of item.posts || []) {
      if (Object.values(post.results || {}).some(result =>
        ['queued', 'uploading', 'processing', 'verifying'].includes(result.state) ||
        result.state === 'published' && result.provider === 'zernio' && !result.url)) pending.push(post.id);
    }
    await Promise.allSettled([...new Set(pending)].map(id =>
      api(`/api/posts/${encodeURIComponent(id)}?refresh=1`)));
    await refreshOutputs();
  } catch (error) { showError(error); }
  finally { button.disabled = false; button.textContent = 'Cập nhật trạng thái'; }
}

async function markOutput(item, status) {
  const outputName = decodeURIComponent(item.outputUrl.split('/').pop());
  try {
    const {outputs} = await api(`/api/outputs/${encodeURIComponent(outputName)}/publication`, {
      method: 'POST', body: JSON.stringify({status}),
    });
    applyOutputs(outputs);
  } catch (error) { showError(error); }
}

function applyOutputs(outputs) {
  state.recentOutputs = outputs || [];
  for (const item of state.queue) {
    const saved = state.recentOutputs.find(output => output.outputUrl === item.outputUrl);
    if (saved) Object.assign(item, {publicationStatus: saved.publicationStatus,
      manualPublication: saved.manualPublication, posts: saved.posts});
  }
  if (state.savedOutput) {
    state.savedOutput = state.recentOutputs.find(output => output.outputUrl === state.savedOutput.outputUrl) || state.savedOutput;
  }
  renderRecentOutputs(state.recentOutputs);
  renderPublicationLedger(state.recentOutputs);
  renderResults();
}

async function refreshOutputs() {
  const {outputs} = await api('/api/outputs');
  applyOutputs(outputs);
}

function renderResults() {
  const finished = state.queue.filter(item => ['done', 'error'].includes(item.status));
  if (state.savedOutput && !finished.some(item => item.outputUrl === state.savedOutput.outputUrl)) {
    finished.unshift(state.savedOutput);
  }
  $('#resultList').replaceChildren(...finished.map(createResultCard));
}

function renderRecentOutputs(outputs) {
  const list = $('#recentOutputList');
  list.replaceChildren();
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const query = normalize($('#librarySearch').value.trim());
  const filter = $('#libraryFilter').value;
  const visible = outputs.filter(item => (!query || normalize(item.title).includes(query)) &&
    (filter === 'all' || item.publicationStatus === filter));
  for (const item of visible) {
    const row = document.createElement('article');
    row.className = 'recent-output';
    const openVideo = () => {
      state.savedOutput = item;
      renderResults();
      setStage('results');
      showPreview(item);
    };
    const thumbnail = document.createElement('button');
    thumbnail.type = 'button';
    thumbnail.className = 'library-thumbnail';
    thumbnail.setAttribute('aria-label', `Xem video: ${item.title}`);
    thumbnail.addEventListener('click', openVideo);
    const image = document.createElement('img');
    const outputName = decodeURIComponent(item.outputUrl.split('/').pop());
    image.src = `/thumbnails/${encodeURIComponent(outputName)}.jpg?v=${encodeURIComponent(item.modifiedAt || '')}`;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.hidden = true; });
    const play = document.createElement('span');
    play.className = 'library-play';
    play.setAttribute('aria-hidden', 'true');
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7V5Z"/></svg>';
    thumbnail.append(image, play);
    const main = document.createElement('div');
    main.className = 'recent-output-main';
    const copy = document.createElement('div');
    copy.className = 'recent-output-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const date = document.createElement('small');
    date.textContent = new Date(item.modifiedAt).toLocaleString('vi-VN');
    copy.append(title, date, publicationBadge(item));
    const actions = document.createElement('div');
    actions.className = 'recent-output-actions';
    const view = makeAction('Xem', 'mini-button library-view-button', openVideo);
    view.setAttribute('aria-label', `Xem video: ${item.title}`);
    actions.append(view);
    const menu = document.createElement('details');
    menu.className = 'library-menu';
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', `Thêm thao tác cho ${item.title}`);
    summary.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg><span>Thêm</span>';
    const panel = document.createElement('div');
    panel.className = 'library-menu-panel';
    const download = document.createElement('a');
    download.className = 'library-menu-item';
    download.href = item.outputUrl;
    download.download = '';
    download.textContent = 'Tải MP4';
    panel.append(download);
    panel.append(makeAction('Sao chép caption', 'library-menu-item', event => copyCaption(item, event.currentTarget)));
    panel.append(makeAction('Đăng video', 'library-menu-item', () => {
      state.savedOutput = item;
      renderResults();
      setStage('results');
      openPublish(item);
    }));
    if (item.posts?.some(post => Object.values(post.results).some(result => result.state === 'processing'))) {
      panel.append(makeAction('Cập nhật trạng thái', 'library-menu-item', async () => {
        try {
          for (const post of item.posts) {
            if (Object.values(post.results).some(result => result.state === 'processing')) {
              await api(`/api/posts/${encodeURIComponent(post.id)}?refresh=1`);
            }
          }
          await refreshOutputs();
        } catch (error) { showError(error); }
      }));
    }
    if (item.publicationStatus !== 'posted') {
      panel.append(makeAction('Đánh dấu đã đăng', 'library-menu-item', () => markOutput(item, 'posted')));
      if (item.publicationStatus === 'unknown') {
        panel.append(makeAction('Đánh dấu chưa đăng', 'library-menu-item', () => markOutput(item, 'not_posted')));
      }
    } else if (item.manualPublication === 'posted' && !item.posts?.some(post =>
      Object.values(post.results).some(result => result.state === 'published'))) {
      panel.append(makeAction('Đánh dấu chưa đăng', 'library-menu-item', () => markOutput(item, 'not_posted')));
    }
    panel.append(makeAction('Xóa video', 'library-menu-item danger', event =>
      openDeleteDialog('video', item, event.currentTarget)));
    panel.addEventListener('click', event => {
      if (event.target.closest('button, a')) menu.open = false;
    });
    menu.append(summary, panel);
    actions.append(menu);
    main.append(copy, actions);
    row.append(thumbnail, main);
    list.append(row);
  }
  $('#recentOutputs').hidden = visible.length === 0;
  $('#libraryEmpty').hidden = visible.length > 0;
  $('#libraryEmpty').textContent = outputs.length
    ? 'Không tìm thấy video phù hợp. Hãy đổi từ khóa hoặc trạng thái lọc.'
    : 'Chưa có video nào. Tạo một video để bắt đầu thư viện.';
  $('#libraryCount').textContent = `${visible.length} / ${outputs.length} video`;
}

const sessionStatus = {running: 'Đang chạy', queued: 'Đang chờ', paused: 'Tạm dừng',
  pausing: 'Đang chờ dừng', needs_input: 'Cần thao tác',
  interrupted: 'Gián đoạn', error: 'Có lỗi', done: 'Hoàn tất'};

function sessionCountText(counts) {
  if (!counts.total) return 'Chưa đưa video vào hàng chờ';
  const parts = [`${counts.done}/${counts.total} video hoàn tất`];
  if (counts.running) parts.push(`${counts.running} đang xử lý`);
  if (counts.queued) parts.push(`${counts.queued} chờ xử lý`);
  if (counts.needsInput) parts.push(`${counts.needsInput} cần thao tác`);
  if (counts.failed) parts.push(`${counts.failed} lỗi`);
  if (counts.interrupted) parts.push(`${counts.interrupted} gián đoạn`);
  return parts.join(' · ');
}

function sessionRow(session, openIds) {
  const row = document.createElement('details');
  row.className = 'session-row';
  row.dataset.id = `session:${session.id}`;
  row.open = openIds.has(row.dataset.id);
  const summary = document.createElement('summary');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = session.title;
  const updated = document.createElement('small');
  updated.textContent = `${session.auto ? 'Auto mode' : 'Thủ công'} · ${new Date(session.updatedAt).toLocaleString('vi-VN')}`;
  copy.append(title, updated);
  const badge = document.createElement('span');
  badge.className = `job-badge ${session.status}`;
  badge.textContent = sessionStatus[session.status] || session.status;
  summary.append(copy, badge);
  const counts = document.createElement('p');
  counts.className = 'session-counts';
  counts.textContent = sessionCountText(session.counts);
  const progress = document.createElement('div');
  progress.className = 'job-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', `Tiến độ phiên ${session.title}`);
  progress.setAttribute('aria-valuenow', String(Math.round(session.progress * 100)));
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('i');
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, session.progress || 0))})`;
  progress.append(fill);
  const items = document.createElement('ul');
  items.className = 'session-items';
  for (const item of session.items) {
    const line = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.title;
    if (item.outputName) {
      const link = document.createElement('a');
      link.href = `/output/${encodeURIComponent(item.outputName)}`;
      link.textContent = ' · Xem MP4';
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      name.append(link);
    }
    const status = document.createElement('span');
    status.textContent = `${item.status === 'interrupted' ? 'Gián đoạn' : jobStatus(item.status)} · ${Math.round((item.progress || 0) * 100)}%`;
    line.append(name, status);
    items.append(line);
  }
  if (!session.items.length) {
    const line = document.createElement('li');
    line.textContent = session.step || 'Chưa có video trong hàng chờ.';
    items.append(line);
  }
  row.append(summary, counts, progress, items);
  if (session.counts.total && ['running', 'queued', 'needs_input', 'paused', 'pausing'].includes(session.status)) {
    const follow = document.createElement('button');
    follow.type = 'button'; follow.className = 'mini-button';
    follow.textContent = 'Theo dõi hàng chờ';
    follow.addEventListener('click', () => void openSessionQueue(session));
    row.append(follow);
  }
  if (session.status === 'interrupted') {
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'mini-button';
    retry.textContent = 'Retry · Tiếp tục phiên';
    retry.addEventListener('click', () => void retryInterruptedSession(session, retry));
    row.append(retry);
  }
  const remove = makeAction('Xóa phiên', 'mini-button danger session-delete', event =>
    openDeleteDialog('session', session, event.currentTarget));
  if (['running', 'queued', 'pausing', 'paused'].includes(session.status)) {
    remove.disabled = true;
    remove.title = 'Đợi phiên xử lý xong trước khi xóa';
  }
  row.append(remove);
  return row;
}

async function retryInterruptedSession(session, button) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Đang khôi phục…';
  clearError();
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(session.id)}/retry`, {method: 'POST'});
    if (result.queue) {
      await openSessionQueue(session);
    } else {
      if (state.polling) clearInterval(state.polling);
      state.runId = result.runId;
      state.template = result.template;
      state.quoteMode = result.mode || 'onscreen';
      state.ideas = result.ideas;
      state.selectedIdeas = new Set();
      state.maxStage = 0;
      $('#runId').textContent = `Phiên ${result.runId.slice(0, 19).replace('T', ' ')}`;
      renderIdeas();
      updateIdeasIntro();
      setStage('ideas');
    }
    if (result.warning) showError(result.warning);
    await refreshSuperCampaigns();
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'Retry · Tiếp tục phiên';
    showError(error);
  }
}

async function openSessionQueue(session) {
  try {
    const {queue} = await api(`/api/runs/${encodeURIComponent(session.id)}/queue`);
    if (state.polling) clearInterval(state.polling);
    state.runId = session.id;
    state.template = session.template;
    state.quoteMode = session.mode || 'onscreen';
    state.maxStage = 2;
    state.activeResultId = null;
    setStage('queue');
    updateQueue(queue);
    if (!['done', 'done_with_errors'].includes(queue.status)) {
      state.polling = setInterval(pollQueue, 1500);
    }
  } catch (error) { showError(error); }
}

function campaignRow(campaign, openIds) {
  const row = document.createElement('details');
  row.className = 'session-row';
  row.dataset.id = `campaign:${campaign.id}`;
  row.open = openIds.has(row.dataset.id);
  const summary = document.createElement('summary');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = `Super Auto · ${campaign.template === 'quote' ? 'Quote' : 'Ranking'}`;
  const next = document.createElement('small');
  next.textContent = campaign.status === 'active'
    ? `Bài tiếp theo từ ${superTime(campaign.nextAt)}` : campaign.error || 'Chiến dịch đã dừng';
  copy.append(title, next);
  const badge = document.createElement('span');
  badge.className = `job-badge ${campaign.status}`;
  badge.textContent = superStatus[campaign.status] || campaign.status;
  summary.append(copy, badge);
  const counts = document.createElement('p');
  counts.className = 'session-counts';
  const c = campaign.counts;
  counts.textContent = `${c.sent} bài đã gửi · ${c.producing} đang tạo · ${c.scheduled} chờ giờ đăng · ${c.publishing} đang đăng` +
    `${c.failed ? ` · ${c.failed} lỗi` : ''}${c.needsReview ? ` · ${c.needsReview} cần kiểm tra` : ''}`;
  const items = document.createElement('ul');
  items.className = 'session-items';
  for (const item of campaign.items.slice(0, 5)) {
    const line = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.topic || 'Đang tìm chủ đề';
    const status = document.createElement('span');
    status.textContent = superStatus[item.status] || item.status;
    const errors = superItemErrors(item);
    if (errors.length) {
      const detail = document.createElement('small');
      detail.className = 'session-item-error';
      detail.textContent = errors[0];
      name.append(detail);
    }
    line.append(name, status);
    items.append(line);
  }
  const link = document.createElement('a');
  link.href = '/automation';
  link.textContent = 'Quản lý Super Auto';
  row.append(summary, counts, items, link);
  return row;
}

function renderActivity(sessions, campaigns) {
  const openIds = new Set($$('.session-row[open]').map(row => row.dataset.id));
  const activeSessions = sessions.filter(session => ['running', 'queued', 'paused', 'pausing'].includes(session.status));
  const activeCampaigns = campaigns.filter(campaign => campaign.status === 'active');
  const attentionSessions = sessions.filter(session => ['needs_input', 'interrupted', 'error'].includes(session.status));
  const attentionCampaigns = campaigns.filter(campaign => campaign.status === 'attention');
  const runningCount = activeSessions.filter(session => !['paused', 'pausing'].includes(session.status)).length + activeCampaigns.length;
  const pausedCount = activeSessions.filter(session => ['paused', 'pausing'].includes(session.status)).length;
  const attentionCount = attentionSessions.length + attentionCampaigns.length;
  $('#activityShortcut').textContent = `${runningCount} đang chạy${pausedCount ? ` · ${pausedCount} tạm dừng` : ''}${attentionCount ? ` · ${attentionCount} cần xử lý` : ''}`;
  $('#sessionMonitorSummary').textContent = `${runningCount} đang chạy · ${pausedCount} tạm dừng · ${attentionCount} cần xử lý`;
  const active = $('#activeSessionList');
  active.replaceChildren(...activeCampaigns.map(campaign => campaignRow(campaign, openIds)),
    ...activeSessions.map(session => sessionRow(session, openIds)));
  if (!activeSessions.length && !activeCampaigns.length) {
    const empty = document.createElement('p');
    empty.className = 'session-empty';
    empty.textContent = 'Hiện không có phiên nào đang chạy.';
    active.append(empty);
  }
  const attention = $('#attentionSessionList');
  attention.replaceChildren();
  const visibleAttention = [...attentionCampaigns.map(campaign => ({type: 'campaign', value: campaign})),
    ...attentionSessions.map(session => ({type: 'session', value: session}))]
    .sort((a, b) => new Date(b.value.updatedAt) - new Date(a.value.updatedAt)).slice(0, 5);
  if (visibleAttention.length) {
    const label = document.createElement('h3');
    label.className = 'session-group-label'; label.textContent = 'Cần xử lý';
    attention.append(label, ...visibleAttention.map(({type, value}) => type === 'campaign'
      ? campaignRow(value, openIds) : sessionRow(value, openIds)));
  }
  const visibleIds = new Set([...activeSessions, ...visibleAttention.filter(entry => entry.type === 'session').map(entry => entry.value)]
    .map(session => session.id));
  const recentSessions = sessions.filter(session => !visibleIds.has(session.id));
  const recentCampaigns = campaigns.filter(campaign => campaign.status === 'stopped');
  $('#recentSessionList').replaceChildren(...recentCampaigns.map(campaign => campaignRow(campaign, openIds)),
    ...recentSessions.map(session => sessionRow(session, openIds)));
  $('#sessionHistory').hidden = !recentSessions.length && !recentCampaigns.length;
}

let pendingDelete = null;

function openDeleteDialog(kind, item, trigger) {
  pendingDelete = {kind, item, trigger};
  $('#deleteDialogTitle').textContent = kind === 'session' ? 'Xóa phiên sản xuất?' : 'Xóa video này?';
  $('#deleteDialogName').textContent = item.title;
  $('#deleteDialogDescription').textContent = kind === 'session'
    ? 'Lịch sử phiên, ý tưởng và footage tạm của phiên sẽ bị xóa. Các MP4 đã render vẫn ở Thư viện. Thao tác này không thể hoàn tác.'
    : 'MP4, thumbnail, caption và lịch sử đăng local của video sẽ bị xóa. Bài đã đăng trên TikTok, Facebook hoặc YouTube vẫn còn trên nền tảng. Thao tác này không thể hoàn tác.';
  $('#deleteDialogError').hidden = true;
  $('#confirmDelete').disabled = false;
  $('#confirmDelete').textContent = kind === 'session' ? 'Xóa phiên' : 'Xóa video';
  $('#deleteDialog').showModal();
  $('#cancelDelete').focus();
}

$('#cancelDelete').addEventListener('click', () => $('#deleteDialog').close());
$('#deleteDialog').addEventListener('close', () => {
  const trigger = pendingDelete?.trigger;
  pendingDelete = null;
  if (trigger?.isConnected) trigger.focus();
});
$('#confirmDelete').addEventListener('click', async () => {
  if (!pendingDelete) return;
  const {kind, item} = pendingDelete;
  const button = $('#confirmDelete');
  button.disabled = true;
  button.textContent = 'Đang xóa…';
  $('#deleteDialogError').hidden = true;
  try {
    if (kind === 'session') {
      const result = await api(`/api/sessions/${encodeURIComponent(item.id)}`, {method: 'DELETE'});
      if (result.deletedRunIds?.includes(state.recoverId)) {
        state.recoverId = null;
        $('#recoverRun').hidden = true;
      }
      if (state.runId === item.id) { resetApp(); setPage('overview'); }
      $('#deleteDialog').close();
      await refreshSuperCampaigns().catch(showError);
      if (result.cleanup?.length) showError(`Đã xóa phiên nhưng chưa dọn được một số file tạm: ${result.cleanup.join('; ')}`);
    } else {
      const outputName = decodeURIComponent(item.outputUrl.split('/').pop());
      const result = await api(`/api/outputs/${encodeURIComponent(outputName)}`, {method: 'DELETE'});
      const outputUrl = item.outputUrl;
      if (state.savedOutput?.outputUrl === outputUrl) state.savedOutput = null;
      if (state.publishItem?.outputUrl === outputUrl) {
        state.publishItem = null;
        state.postId = null;
        if (state.postPolling) clearInterval(state.postPolling);
        state.postPolling = null;
        $('#publishPanel').hidden = true;
      }
      for (const job of state.queue) if (job.outputUrl === outputUrl) {
        job.outputUrl = null;
        job.caption = null;
        job.posts = [];
        job.post = null;
        job.step = 'Video đã xóa khỏi Thư viện';
      }
      if ($('#videoPreview').getAttribute('src') === outputUrl) {
        $('#videoPreview').pause();
        $('#videoPreview').removeAttribute('src');
        $('#videoPreview').load();
        $('#videoPreview').hidden = true;
        $('#previewEmpty').hidden = false;
        $('#previewStatus').textContent = 'Chờ nội dung';
        state.activeResultId = null;
      }
      applyOutputs(result.outputs);
      renderQueue();
      $('#deleteDialog').close();
      await refreshSuperCampaigns().catch(showError);
      if (result.cleanup?.length) showError(`Đã xóa video nhưng chưa dọn được một số file tạm: ${result.cleanup.join('; ')}`);
    }
  } catch (error) {
    $('#deleteDialogError').textContent = error.message || String(error);
    $('#deleteDialogError').hidden = false;
    button.disabled = false;
    button.textContent = kind === 'session' ? 'Xóa phiên' : 'Xóa video';
  }
});

const publishLabels = {tiktok: 'TikTok', facebook: 'Facebook Reels', youtube: 'YouTube Shorts'};
const privacyLabels = {PUBLIC_TO_EVERYONE: 'Công khai', MUTUAL_FOLLOW_FRIENDS: 'Bạn bè',
  FOLLOWER_OF_CREATOR: 'Người theo dõi', SELF_ONLY: 'Chỉ mình tôi'};

function showPublishError(message) {
  $('#publishError').textContent = message instanceof Error ? message.message : String(message);
  $('#publishError').hidden = false;
  $('#publishError').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function clearPublishError() {
  $('#publishError').hidden = true;
  $('#publishError').textContent = '';
}

function setTikTokConnection(message, failed = false) {
  $('#tiktokConnection').textContent = message;
  $('#tiktokConnection').parentElement.classList.toggle('error', failed);
  $('#retryTikTok').hidden = !failed;
}

async function openPublish(item, selectedPlatform = null) {
  clearError();
  clearPublishError();
  const request = ++state.tiktokCreatorRequest;
  if (state.postPolling) clearInterval(state.postPolling);
  state.postPolling = null;
  state.postId = null;
  state.publishItem = item;
  state.publishSelectedPlatform = selectedPlatform;
  const panel = $('#publishPanel');
  const publishingPage = state.currentPage === 'publishing';
  if (publishingPage) $('#page-publishing .publishing-toolbar').after(panel);
  else $('#stage-results').append(panel);
  panel.hidden = false;
  $('#publishForm').hidden = false;
  $('#publishStatus').hidden = true;
  $('#publishForm').reset();
  $('#tiktokPrivacy').replaceChildren();
  setTikTokConnection('Chọn TikTok để kiểm tra tài khoản và quyền đăng.');
  $('#publishFile').textContent = item.title;
  const drafts = composePostCopy(item.title, cleanCaption(item.caption));
  $('#publishTikTokCaption').value = drafts.tiktok.caption;
  $('#publishFacebookTitle').value = drafts.facebook.title;
  $('#publishFacebookCaption').value = drafts.facebook.caption;
  $('#publishYouTubeTitle').value = drafts.youtube.title;
  $('#publishYouTubeDescription').value = drafts.youtube.description;
  for (const platform of Object.keys(publishLabels)) {
    $(`#${platform}Copy`).hidden = true;
    $$(`#${platform}Copy input, #${platform}Copy textarea`).forEach(field => { field.disabled = true; });
  }
  $('#publishConfigHint').textContent = 'Đang kiểm tra kết nối tài khoản…';
  $('#publishAccountFields').hidden = true;
  $('#tiktokOptions').hidden = true;
  $('#youtubeOptions').hidden = true;
  panel.scrollIntoView({behavior: publishingPage ? 'auto' : 'smooth', block: 'start'});
  try {
    const {platforms, accounts = [], provider = 'direct'} = await api('/api/posts/config');
    if (request !== state.tiktokCreatorRequest) return;
    state.publishProvider = provider;
    state.publishPlatforms = platforms;
    renderZernioConnectActions('#publishConnectActions', {platforms, accounts, provider});
    $$('input[name="platform"]').forEach(input => {
      input.disabled = !platforms[input.value].configured;
      input.checked = input.value === selectedPlatform && !input.disabled;
    });
    $('#publishAccountFields').hidden = provider === 'direct';
    if (provider !== 'direct') {
      for (const platform of Object.keys(publishLabels)) {
        const select = $(`#${platform}Account`);
        const connected = accounts.filter(account => account.platform === platform && account.active);
        const options = connected.map(account => {
          const option = document.createElement('option');
          option.value = account.id;
          option.textContent = account.username || account.id;
          return option;
        });
        if (options.length > 1) {
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'Chọn tài khoản';
          options.unshift(placeholder);
        }
        select.replaceChildren(...options);
      }
    }
    const missing = Object.entries(platforms).filter(([, value]) => !value.configured).map(([key]) => publishLabels[key]);
    $('#publishConfigHint').textContent = missing.length
      ? `${provider === 'zernio' ? 'Chưa kết nối trong Zernio' : 'Chưa cấu hình'}: ${missing.join(', ')}.`
      : 'Ba nền tảng đã có thông tin kết nối. Chọn nơi muốn đăng.';
    if (selectedPlatform && !platforms[selectedPlatform]?.configured) {
      showPublishError(`${publishLabels[selectedPlatform]} chưa có kết nối đăng bài. Hãy kết nối tài khoản rồi thử lại.`);
    } else if (selectedPlatform) {
      await updatePublishOptions();
    }
  } catch (error) {
    if (request === state.tiktokCreatorRequest) showPublishError(error);
  }
}

async function updatePublishOptions(force = false) {
  const request = ++state.tiktokCreatorRequest;
  clearPublishError();
  const chosen = new Set($$('input[name="platform"]:checked').map(input => input.value));
  for (const platform of Object.keys(publishLabels)) {
    $(`#${platform}Copy`).hidden = !chosen.has(platform);
    $$(`#${platform}Copy input, #${platform}Copy textarea`).forEach(field => {
      field.disabled = !chosen.has(platform);
    });
  }
  $('#tiktokOptions').hidden = !chosen.has('tiktok');
  $('#youtubeOptions').hidden = !chosen.has('youtube');
  for (const platform of Object.keys(publishLabels)) {
    $(`#${platform}AccountField`).hidden = state.publishPlatforms[platform]?.provider !== 'zernio' || !chosen.has(platform);
  }
  $('#publishAccountFields').hidden = ![...chosen].some(platform => state.publishPlatforms[platform]?.provider === 'zernio');
  if (!chosen.has('tiktok')) {
    $('#tiktokPrivacy').replaceChildren();
    return false;
  }
  const accountId = state.publishPlatforms.tiktok?.provider === 'zernio' ? $('#tiktokAccount').value : '';
  if (state.publishPlatforms.tiktok?.provider === 'zernio' && !accountId) {
    $('#tiktokPrivacy').replaceChildren();
    setTikTokConnection('Hãy chọn tài khoản TikTok trên Zernio.', true);
    return false;
  }
  if (!force && $('#tiktokPrivacy').value) return true;
  $('#tiktokPrivacy').replaceChildren();
  $('#tiktokPrivacy').disabled = true;
  setTikTokConnection('Đang lấy tài khoản và quyền riêng tư TikTok…');
  try {
    const {creator} = await api(`/api/posts/tiktok/creator${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`);
    if (request !== state.tiktokCreatorRequest || !$('input[name="platform"][value="tiktok"]').checked) return false;
    if (!creator?.privacy_level_options?.length) throw new Error('TikTok không trả lựa chọn quyền riêng tư.');
    const select = $('#tiktokPrivacy');
    select.replaceChildren(...(creator.privacy_level_options || []).map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = privacyLabels[value] || value;
      return option;
    }));
    $('#tiktokComment').disabled = Boolean(creator.comment_disabled);
    $('#tiktokDuet').disabled = Boolean(creator.duet_disabled);
    $('#tiktokStitch').disabled = Boolean(creator.stitch_disabled);
    if (creator.comment_disabled) $('#tiktokComment').checked = false;
    if (creator.duet_disabled) $('#tiktokDuet').checked = false;
    if (creator.stitch_disabled) $('#tiktokStitch').checked = false;
    select.disabled = false;
    setTikTokConnection(`${creator.provider === 'zernio' ? 'Zernio · ' : ''}Đã kết nối @${creator.creator_username || 'TikTok'}. Chọn quyền riêng tư trước khi đăng.`);
    return true;
  } catch (error) {
    if (request !== state.tiktokCreatorRequest) return false;
    $('#tiktokPrivacy').replaceChildren();
    const invalidToken = /access token is invalid|access_token_invalid|not found in the request/i.test(error.message);
    setTikTokConnection(invalidToken
      ? 'Token đăng bài không hợp lệ hoặc đã hết hạn. Kiểm tra khóa API tương ứng trong .env và khởi động lại server.'
      : `Không thể lấy quyền riêng tư TikTok: ${error.message}`, true);
    return false;
  }
}

function renderPost(post) {
  const container = $('#publishStatus');
  container.hidden = false;
  container.replaceChildren();
  for (const [platform, result] of Object.entries(post.results)) {
    const row = document.createElement('div');
    row.className = `publish-row state-${result.state}`;
    const label = document.createElement('strong');
    label.textContent = publishLabels[platform];
    const status = document.createElement('span');
    status.textContent = ({queued: 'Đang chờ', uploading: `Đang tải lên ${result.progress || 0}%`,
      processing: 'Đang xử lý', verifying: 'Đang xác minh', published: 'Đã xuất bản', ready: 'Đã xử lý', failed: 'Lỗi'})[result.state] || result.state;
    const message = document.createElement('p');
    message.textContent = result.error || result.statusError || result.message || result.remoteStatus || '';
    row.append(label, status, message);
    if (result.url) {
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Mở bài đăng';
      row.append(link);
    }
    container.append(row);
  }
  if (Object.values(post.results).some(result => ['processing', 'verifying'].includes(result.state) ||
      result.provider === 'zernio' && result.state === 'published' && !result.url)) {
    container.append(makeAction('Kiểm tra trạng thái xuất bản', 'mini-button', () => pollPost(true)));
  }
}

async function pollPost(refresh = false) {
  if (!state.postId) return;
  try {
    const {post} = await api(`/api/posts/${encodeURIComponent(state.postId)}${refresh ? '?refresh=1' : ''}`);
    renderPost(post);
    await refreshOutputs();
    if (Object.values(post.results).every(result => !['queued', 'uploading'].includes(result.state))) {
      clearInterval(state.postPolling);
      state.postPolling = null;
    }
  } catch (error) { clearInterval(state.postPolling); state.postPolling = null; showError(error); }
}

function updateQueue(queue) {
  state.queueStatus = queue.status;
  state.queueCanPause = Boolean(queue.canPause);
  state.queue = queue.items || [];
  for (const item of state.queue) {
    const saved = state.recentOutputs.find(output => output.outputUrl === item.outputUrl);
    if (saved) Object.assign(item, {publicationStatus: saved.publicationStatus,
      manualPublication: saved.manualPublication, posts: saved.posts});
  }
  renderQueue();
  renderResults();
  const firstDone = state.queue.find(item => item.status === 'done');
  if (!state.activeResultId && firstDone) showPreview(firstDone, {openDialog: false});
  const terminal = ['done', 'done_with_errors'].includes(queue.status);
  if (terminal) {
    if (state.polling) clearInterval(state.polling);
    state.polling = null;
    state.maxStage = 4;
    renderQueue();
    renderResults();
    setRunSummary(`${queue.completed}/${queue.total} video đã hoàn tất${queue.failed ? `, ${queue.failed} video lỗi` : ''}.`);
    $('#previewStatus').textContent = firstDone ? 'Có video mới' : 'Không có video hoàn tất';
    setStage('results');
  } else {
    setRunSummary(queue.status === 'paused' ? `Đã tạm dừng · ${queue.completed + queue.failed}/${queue.total} video đã xử lý.`
      : queue.status === 'pausing' ? 'Đang chờ video hiện tại hoàn tất để tạm dừng.'
        : `Đang xử lý hàng chờ ${queue.completed + queue.failed}/${queue.total}.`);
    $('#previewStatus').textContent = firstDone ? 'Có video mới'
      : queue.status === 'paused' ? 'Đã tạm dừng' : 'Đang sản xuất';
  }
}

async function pollQueue() {
  try {
    const {queue} = await api(`/api/runs/${encodeURIComponent(state.runId)}/queue`);
    updateQueue(queue);
  } catch (error) {
    clearInterval(state.polling);
    state.polling = null;
    showError(error);
  }
}

function resetApp() {
  if (state.polling) clearInterval(state.polling);
  if (state.postPolling) clearInterval(state.postPolling);
  Object.assign(state, {template: 'ranking', quoteMode: 'caption', runId: null, ideas: [], selectedIdeas: new Set(), queue: [],
    queueStatus: null, queueCanPause: false, queueActionPending: false, currentStage: 'topic', maxStage: 0, polling: null, activeResultId: null,
    reviewJobId: null, reviewSelections: new Set(), publishItem: null, publishSelectedPlatform: null,
    postId: null, postPolling: null,
    recentOutputs: state.recentOutputs,
    tiktokCreatorRequest: state.tiktokCreatorRequest + 1, publishProvider: 'direct', savedOutput: null,
    autoConfig: null, autoConfigPromise: null, autoCreatorRequest: state.autoCreatorRequest + 1});
  $('#topicForm').reset();
  $('#autoModeToggle').checked = false;
  $('#autoModeToggle').setAttribute('aria-expanded', 'false');
  $('#autoModeSettings').hidden = true;
  $('#autoConsent').checked = false;
  $$('input[name="autoPlatform"]').forEach(input => { input.checked = false; input.disabled = false; });
  updateAutoStatus();
  $('#charCount').textContent = '0 / 300';
  $('#ideaList').replaceChildren();
  $('#queueList').replaceChildren();
  $('#resultList').replaceChildren();
  $('#publishPanel').hidden = true;
  $('#queueIntro').textContent = 'Mỗi video được chuẩn bị nội dung và tìm footage rồi chờ bạn duyệt clip trước khi render. Chỉ một tác vụ chạy tại một thời điểm.';
  $('#footageList').replaceChildren();
  $('#runId').textContent = 'Chưa tạo phiên';
  $('#queueButton').disabled = true;
  $('#queueButtonText').textContent = 'Đưa vào hàng chờ';
  $('#ideaHint').textContent = 'Chưa chọn video nào.';
  $('#videoPreview').pause();
  $('#videoPreview').removeAttribute('src');
  $('#videoPreview').load();
  $('#videoPreview').hidden = true;
  $('#previewEmpty').hidden = false;
  $('#previewStatus').textContent = 'Chờ nội dung';
  setRunSummary('Nhập chủ đề để bắt đầu một phiên sản xuất mới.');
  clearError();
  selectQuoteMode('caption');
  selectTemplate('ranking');
  setStage('topic');
  $('#topicInput').focus();
}

function requestNewRun() {
  if (state.polling) {
    showError('Hàng chờ vẫn đang xử lý. Hãy đợi hoàn tất trước khi bắt đầu phiên mới.');
    return;
  }
  resetApp();
}

function updateAutoStatus() {
  const enabled = $('#autoModeToggle').checked;
  const platforms = $$('input[name="autoPlatform"]:checked').map(input =>
    ({tiktok: 'TikTok', facebook: 'Facebook Reels', youtube: 'YouTube Shorts'})[input.value]);
  $('#autoStatus').textContent = enabled
    ? `Auto mode đã bật${platforms.length ? ` cho ${platforms.join(', ')}` : ''}. Kiểm tra tài khoản và đồng ý đăng trong trang Tự động hóa.`
    : 'Đang tạo thủ công. Bạn có thể bật tự lấy footage và đăng bài trong trang Tự động hóa.';
}

$('#topicInput').addEventListener('input', event => {
  $('#charCount').textContent = `${event.target.value.length} / 300`;
});

$('#autoModeToggle').addEventListener('change', async event => {
  updateAutoStatus();
  const enabled = event.target.checked;
  event.target.setAttribute('aria-expanded', String(enabled));
  $('#autoModeSettings').hidden = !enabled;
  $('#ideaButtonText').textContent = state.template === 'quote' ? 'Tạo 8 Quote' : 'Tạo góc nội dung';
  updateIdeaSelection();
  updateIdeasIntro();
  if (enabled) {
    try { await loadAutoConfig(); }
    catch (error) { $('#autoConfigHint').textContent = `Không kiểm tra được tài khoản: ${error.message}`; }
  }
});
$$('input[name="autoPlatform"]').forEach(input => input.addEventListener('change', () => {
  updateAutoOptions();
  updateAutoStatus();
}));
$('#autoTiktokAccount').addEventListener('change', () => void loadAutoTikTokCreator());

$('#topicForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearError();
  const prompt = $('#topicInput').value.trim();
  if (prompt.length < 3) {
    showError('Hãy nhập chủ đề có ít nhất 3 ký tự.');
    return;
  }
  setLoading(true, state.template === 'quote'
    ? 'Gemini đang viết 8 nội dung Quote nguyên bản…'
    : 'Gemini đang tìm các góc nội dung có dữ liệu mới…');
  try {
    const data = await api('/api/ideas', {method: 'POST',
      body: JSON.stringify({prompt, template: state.template, mode: state.template === 'quote' ? state.quoteMode : null})});
    state.runId = data.runId;
    state.ideas = data.ideas;
    state.selectedIdeas = new Set();
    $('#runId').textContent = `Phiên ${state.runId.slice(0, 19).replace('T', ' ')}`;
    renderIdeas();
    updateIdeasIntro();
    setRunSummary(state.template === 'quote'
      ? `${state.ideas.length} Quote nguyên bản đã sẵn sàng. Có thể chọn nhiều video.`
      : `${state.ideas.length} góc nội dung đã sẵn sàng. Có thể chọn nhiều video.`);
    $('#previewStatus').textContent = 'Đã có ý tưởng';
    setStage('ideas');
  } catch (error) {
    setLoading(false);
    showError(error);
  }
});

async function enqueueSelected(automatic = null) {
  if (!state.selectedIdeas.size) return;
  clearError();
  $('#queueButton').disabled = true;
  $('#queueButtonText').textContent = 'Đang tạo hàng chờ…';
  try {
    const {queue} = await api(`/api/runs/${encodeURIComponent(state.runId)}/queue`, {
      method: 'POST',
      body: JSON.stringify({selections: [...state.selectedIdeas].sort((a, b) => a - b), auto: automatic}),
    });
    $('#queueIntro').textContent = automatic
      ? `Auto mode đang ${state.template === 'quote' ? 'chọn ảnh từ kho' : 'lấy footage'}, render và đăng từng video lên các nền tảng đã chọn.`
      : state.template === 'quote'
        ? 'Mỗi video dùng một ảnh chọn ngẫu nhiên từ kho. Bạn có thể duyệt và đổi ảnh trước khi render.'
        : 'Mỗi video được chuẩn bị nội dung và tìm footage rồi chờ bạn duyệt clip trước khi render. Chỉ một tác vụ chạy tại một thời điểm.';
    state.maxStage = 2;
    setStage('queue');
    state.polling = setInterval(pollQueue, 1500);
    updateQueue(queue);
  } catch (error) {
    updateIdeaSelection();
    showError(error);
  }
}

$('#queueButton').addEventListener('click', async () => {
  try { await enqueueSelected(await autoInput()); }
  catch (error) { showError(error); }
});

$('#viewResultsButton').addEventListener('click', () => {
  renderResults();
  setStage('results');
});

$('#closePublish').addEventListener('click', () => { state.tiktokCreatorRequest++; $('#publishPanel').hidden = true; });
$$('input[name="platform"]').forEach(input => input.addEventListener('change', () => updatePublishOptions()));
$('#tiktokAccount').addEventListener('change', () => updatePublishOptions(true));
$('#retryTikTok').addEventListener('click', () => updatePublishOptions(true));
$('#publishForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearError();
  clearPublishError();
  if (!state.publishItem) return;
  const chosen = $$('input[name="platform"]:checked').map(input => input.value);
  if (!chosen.length) { showPublishError('Hãy chọn ít nhất một nền tảng.'); return; }
  if (chosen.some(platform => state.publishPlatforms[platform]?.provider === 'zernio' && !$(`#${platform}Account`).value)) {
    showPublishError('Hãy chọn tài khoản Zernio cho từng nền tảng.'); return;
  }
  if (chosen.includes('tiktok') && !$('#tiktokPrivacy').value) {
    await updatePublishOptions();
    if (!$('#tiktokPrivacy').value) {
      showPublishError('Chưa thể đăng TikTok vì không lấy được quyền riêng tư của tài khoản. Xem thông báo trong phần TikTok ở trên.');
      return;
    }
  }
  const targets = {};
  if (chosen.includes('tiktok')) targets.tiktok = {caption: $('#publishTikTokCaption').value.trim(), privacy: $('#tiktokPrivacy').value,
    allowComment: $('#tiktokComment').checked, allowDuet: $('#tiktokDuet').checked,
    allowStitch: $('#tiktokStitch').checked, isAigc: $('#tiktokAigc').checked};
  if (chosen.includes('facebook')) targets.facebook = {title: $('#publishFacebookTitle').value.trim(),
    caption: $('#publishFacebookCaption').value.trim(), state: 'PUBLISHED'};
  if (chosen.includes('youtube')) targets.youtube = {title: $('#publishYouTubeTitle').value.trim(),
    description: $('#publishYouTubeDescription').value.trim(),
    privacy: $('#youtubePrivacy').value, madeForKids: $('#youtubeMadeForKids').checked,
    containsSyntheticMedia: $('#youtubeSynthetic').checked};
  for (const platform of chosen) {
    if (state.publishPlatforms[platform]?.provider === 'zernio') targets[platform].accountId = $(`#${platform}Account`).value;
  }
  const outputName = decodeURIComponent(state.publishItem.outputUrl.split('/').pop());
  $('#publishSubmit').disabled = true;
  try {
    const {post} = await api('/api/posts', {method: 'POST', body: JSON.stringify({outputName, targets,
      consent: $('#publishConsent').checked})});
    state.postId = post.id;
    $('#publishForm').hidden = true;
    renderPost(post);
    if (state.postPolling) clearInterval(state.postPolling);
    state.postPolling = setInterval(pollPost, 1500);
    await pollPost();
  } catch (error) { showPublishError(error); }
  finally { $('#publishSubmit').disabled = false; }
});

$('#recoverButton').addEventListener('click', async () => {
  if (!state.recoverId) return;
  clearError();
  setLoading(true, 'Đang tìm lại footage cho video chưa hoàn tất…');
  try {
    const {queue} = await api(`/api/recover/${encodeURIComponent(state.recoverId)}`, {method: 'POST'});
    state.runId = queue.id;
    $('#runId').textContent = `Phiên khôi phục ${state.recoverId}`;
    state.maxStage = 2;
    setStage('queue');
    state.polling = setInterval(pollQueue, 1500);
    updateQueue(queue);
  } catch (error) {
    setLoading(false);
    showError(error);
  }
});

$('#backToQueue').addEventListener('click', () => setStage('queue'));
$('#confirmFootage').addEventListener('click', async () => {
  const reviewing = state.queue.find(job => job.id === state.reviewJobId);
  if (!reviewing || (reviewing.template === 'quote' ? state.reviewSelections.size !== 1 : state.reviewSelections.size < 8)) return;
  clearError();
  $('#confirmFootage').disabled = true;
  try {
    await api(`/api/runs/${encodeURIComponent(state.reviewJobId)}/footage`, {
      method: 'POST', body: JSON.stringify({ids: [...state.reviewSelections]}),
    });
    state.reviewJobId = null;
    setStage('queue');
    await pollQueue();
  } catch (error) {
    updateFootageSelection();
    showError(error);
  }
});
async function uploadQuoteImages(event) {
  for (const file of event.target.files) {
    try {
      const response = await fetch('/api/quote-images', {
        method: 'POST', headers: {'Content-Type': file.type}, body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Không upload được ${file.name}.`);
      state.quoteImages.push(data.image);
      const job = state.queue.find(job => job.id === state.reviewJobId);
      if (job?.template === 'quote' && job.footage) {
        job.footage.candidates.push(data.image);
        if (!state.reviewSelections.size) state.reviewSelections.add(data.image.id);
        renderFootage();
      }
      renderQuoteImages();
    } catch (error) { showError(error); }
  }
  event.target.value = '';
}
$('#quoteImageInput').addEventListener('change', uploadQuoteImages);
$('#quoteReviewImageInput').addEventListener('change', uploadQuoteImages);
$('#localClipInput').addEventListener('change', async event => {
  if (!state.reviewJobId) return;
  for (const file of event.target.files) {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(state.reviewJobId)}/footage/upload`, {
        method: 'POST', headers: {'Content-Type': 'video/mp4', 'X-File-Name': encodeURIComponent(file.name)}, body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Không thêm được ${file.name}.`);
      const item = state.queue.find(job => job.id === state.reviewJobId);
      item.footage.candidates.push(data.candidate);
      renderFootage();
    } catch (error) { showError(error); }
  }
  event.target.value = '';
});

$$('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => {
    $('#topicInput').value = button.dataset.prompt;
    $('#topicInput').dispatchEvent(new Event('input'));
    $('#topicInput').focus();
  });
});

$$('.workflow-step').forEach(step => {
  step.addEventListener('click', () => {
    if (!step.disabled) setStage(step.dataset.stage);
  });
});

$$('a[data-page]').forEach(link => link.addEventListener('click', event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  setPage(link.dataset.page);
}));

function renderMusic() {
  const tracks = state.musicTracks;
  const enabled = tracks.filter(track => track.weight > 0).length;
  $('#musicSummary').textContent = `${tracks.length} bài · ${enabled} bài đang dùng`;
  $('#musicEmpty').hidden = tracks.length > 0;
  const list = $('#musicList');
  list.replaceChildren();
  for (const track of tracks) {
    const row = document.createElement('div');
    row.className = 'music-row';
    const info = document.createElement('div');
    info.className = 'music-info';
    const title = document.createElement('strong');
    title.textContent = track.name;
    const detail = document.createElement('span');
    detail.textContent = `${(track.size / 1_000_000).toFixed(1)} MB · ${track.weight ? `trọng số ${track.weight}` : 'đang tạm ngừng'}`;
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'none';
    player.src = track.url;
    player.setAttribute('aria-label', `Nghe thử ${track.name}`);
    info.append(title, detail, player);
    const actions = document.createElement('div');
    actions.className = 'music-actions';
    const label = document.createElement('label');
    label.textContent = 'Trọng số';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Trọng số của ${track.name}`);
    for (let value = 0; value <= 10; value++) {
      const option = new Option(value === 0 ? '0 · Tạm ngừng' : String(value), String(value));
      select.add(option);
    }
    select.value = String(track.weight);
    select.addEventListener('change', async () => {
      const previous = track.weight;
      select.disabled = true;
      try {
        await api(`/api/music/${encodeURIComponent(track.name)}`, {
          method: 'PATCH', body: JSON.stringify({weight: Number(select.value)}),
        });
        track.weight = Number(select.value);
        $('#musicStatus').textContent = `Đã lưu trọng số cho ${track.name}.`;
        renderMusic();
      } catch (error) { select.value = String(previous); showError(error); }
      finally { select.disabled = false; }
    });
    label.append(select);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'mini-button music-delete';
    remove.textContent = 'Xóa';
    remove.setAttribute('aria-label', `Xóa ${track.name}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Xóa "${track.name}" khỏi kho nhạc?`)) return;
      remove.disabled = true;
      try {
        await api(`/api/music/${encodeURIComponent(track.name)}`, {method: 'DELETE'});
        state.musicTracks = state.musicTracks.filter(item => item.name !== track.name);
        $('#musicStatus').textContent = `Đã xóa ${track.name}.`;
        renderMusic();
      } catch (error) { remove.disabled = false; showError(error); }
    });
    actions.append(label, remove);
    row.append(info, actions);
    list.append(row);
  }
}

async function refreshMusic() {
  const {tracks} = await api('/api/music');
  state.musicTracks = tracks;
  renderMusic();
}

async function uploadMusicFiles(files) {
  if (!files.length) return;
  const input = $('#musicFiles');
  input.disabled = true;
  const failures = [];
  let added = 0;
  for (const file of files) {
    $('#musicStatus').textContent = `Đang thêm ${file.name} (${added + failures.length + 1}/${files.length})…`;
    try {
      await api('/api/music', {method: 'POST', body: file,
        headers: {'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name)}});
      added++;
    } catch (error) { failures.push(`${file.name}: ${error.message}`); }
  }
  input.value = '';
  input.disabled = false;
  await refreshMusic();
  $('#musicStatus').textContent = `Đã thêm ${added}/${files.length} bài.${failures.length ? ` Lỗi: ${failures.join('; ')}` : ''}`;
}

function openCurrentPath() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/automation') return setPage('automation', {history: false});
  if (path === '/flow') return setPage('flow', {history: false});
  if (path === '/publishing') return setPage('publishing', {history: false});
  if (path === '/library') return setPage('library', {history: false});
  if (path === '/music') return setPage('music', {history: false});
  if (path.startsWith('/create')) {
    const requested = Object.keys(stagePaths).find(stage => stagePaths[stage] === path) || 'topic';
    const stage = stageOrder.indexOf(requested) <= state.maxStage ? requested : 'topic';
    return setStage(stage, {history: path !== stagePaths[stage], replace: true});
  }
  setPage('overview', {history: path !== '/', replace: true});
}

window.addEventListener('popstate', openCurrentPath);

$$('[data-template]').forEach(button => button.addEventListener('click', () => selectTemplate(button.dataset.template)));

$('#backToTopic').addEventListener('click', () => setStage('topic'));
$('#newRunButton').addEventListener('click', requestNewRun);
$('#startNewButton').addEventListener('click', requestNewRun);
$('#newBatchButton').addEventListener('click', requestNewRun);
$('#dismissError').addEventListener('click', clearError);
$('#dismissZernioNotice').addEventListener('click', () => { $('#zernioNotice').hidden = true; });
$('#librarySearch').addEventListener('input', () => renderRecentOutputs(state.recentOutputs));
$('#libraryFilter').addEventListener('change', () => renderRecentOutputs(state.recentOutputs));
$('#musicFiles').addEventListener('change', event => {
  void uploadMusicFiles([...event.target.files]).catch(showError);
});
$('#publishingSearch').addEventListener('input', () => renderPublicationLedger(state.recentOutputs));
$('#publishingFilter').addEventListener('change', () => renderPublicationLedger(state.recentOutputs));
$('#refreshPublishing').addEventListener('click', refreshPublicationStatuses);
document.addEventListener('click', event => {
  $$('.library-menu[open]').forEach(menu => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menu = $('.library-menu[open]');
  if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
});
$('#closePreviewDialog').addEventListener('click', () => $('#previewDialog').close());
$('#previewDialog').addEventListener('close', () => {
  $('#dialogVideo').pause();
  $('#dialogVideo').removeAttribute('src');
  $('#dialogVideo').load();
});

const firstPost = new Date(Date.now() + 30 * 60_000);
firstPost.setMinutes(Math.ceil(firstPost.getMinutes() / 15) * 15, 0, 0);
$('#superStartAt').value = new Date(firstPost.getTime() - firstPost.getTimezoneOffset() * 60_000)
  .toISOString().slice(0, 16);
$('#superStartButton').addEventListener('click', async () => {
  clearError();
  const button = $('#superStartButton');
  button.disabled = true;
  button.textContent = 'Đang tạo chiến dịch…';
  try {
    const auto = await autoInput({superMode: true});
    if (!auto) throw new Error('Hãy bật Auto mode và chọn nền tảng đăng trước khi chạy Super Auto.');
    const startAt = new Date($('#superStartAt').value);
    if (!Number.isFinite(startAt.getTime())) throw new Error('Hãy chọn giờ đăng bài đầu tiên.');
    await api('/api/super-auto', {method: 'POST', body: JSON.stringify({
      template: $('#superTemplate').value,
      mode: $('#superTemplate').value === 'quote' ? 'caption' : null,
      focus: $('#superFocus').value.trim(), startAt: startAt.toISOString(),
      intervalMinutes: Number($('#superInterval').value), auto,
    })});
    await refreshSuperCampaigns();
  } catch (error) { showError(error); button.disabled = false; }
  finally { button.textContent = 'Bắt đầu Super Auto'; }
});

api('/api/config').then(config => {
  const missing = [];
  if (!config.aiConfigured) missing.push(config.aiProvider === 'omnirouter' ? 'OmniRouter' : 'Gemini AI Studio');
  if (!config.providers?.some(provider => provider.enabled)) missing.push('Pixabay / Pexels / Coverr');
  const node = $('#systemState');
  if (missing.length) {
    node.classList.add('problem');
    node.lastElementChild.textContent = `Thiếu key: ${missing.join(', ')}`;
  } else {
    node.classList.add('ready');
    node.lastElementChild.textContent = `${config.model} · ${config.providers.filter(provider => provider.enabled).map(provider => provider.name).join(', ')} · ${config.musicCount} file nhạc`;
  }
}).catch(() => {
  $('#systemState').classList.add('problem');
  $('#systemState').lastElementChild.textContent = 'Không kết nối được server';
});

api('/api/recoverable').then(({runs}) => {
  if (!runs?.length) return;
  state.recoverId = runs[0].id;
  $('#recoverTitle').textContent = runs[0].title;
  $('#recoverRun').hidden = false;
}).catch(() => {});

refreshOutputs().catch(() => {});
restoreZernioConnect().catch(showError);
const updateActivity = () => refreshSuperCampaigns().catch(error => {
  $('#sessionMonitorSummary').textContent = `Không tải được tiến độ: ${error.message}`;
});
void updateActivity();
setInterval(updateActivity, 10_000);
openCurrentPath();
