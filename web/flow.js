(() => {
  const $ = selector => document.querySelector(selector);
  const state = {assets: [], jobs: [], batches: [], selected: null, detailKey: '', busy: false,
    accountConfig: null};
  const labels = {uploading: 'Đang nhận file', ready_image: 'Sẵn sàng tạo ảnh', queued_image: 'Chờ tạo ảnh',
    generating_image: 'Đang tạo ảnh', image_review: 'Chờ duyệt ảnh', ready_video: 'Sẵn sàng tạo video', queued_video: 'Chờ tạo video',
    generating_video: 'Đang tạo video', credit_pause: 'Chờ credit miễn phí', auth_required: 'Cần đăng nhập Flow',
    needs_attention: 'Cần kiểm tra Flow', done: 'Đã có MP4'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const endpoint = '/api/flow';

  async function request(url, options) {
    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Lỗi ${response.status}`);
    return result;
  }

  async function upload(url, file) {
    return request(url, {method: 'POST', headers: {'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name)}, body: file});
  }

  function status(message, error = false) {
    const target = $('#flowFormStatus');
    target.textContent = message;
    target.classList.toggle('error', error);
  }

  function estimateCredits() {
    const segments = Math.ceil(Number($('#flowDuration').value) / 8);
    const count = $('#flowGarment').files.length || 1;
    const credits = count * segments * 20;
    $('#flowCreditEstimate').textContent = `${count} bộ đồ × ${segments} đoạn video × khoảng 20 credit = khoảng ${credits} credit video, chưa tính ảnh. Đây là dự toán; số credit thực tế do Flow hiển thị khi tạo.`;
    if (!$('#flowMaxCredits').value || Number($('#flowMaxCredits').value) < credits)
      $('#flowMaxCredits').value = credits;
  }

  async function loadAccounts() {
    const config = await request('/api/posts/config');
    state.accountConfig = config;
    for (const platform of ['tiktok', 'facebook', 'youtube']) {
      const input = $(`input[name="flowPlatform"][value="${platform}"]`);
      input.disabled = !config.platforms[platform]?.configured;
      const select = $(`#flow${platform[0].toUpperCase()}${platform.slice(1)}Account`);
      const accounts = config.accounts.filter(account => account.platform === platform && account.active);
      select.replaceChildren(...accounts.map(account => new Option(account.username || account.id, account.id)));
      if (accounts.length > 1) select.insertBefore(new Option('Chọn tài khoản', ''), select.firstChild);
    }
    $('#flowAccountHint').textContent = 'Chọn nền tảng và tài khoản đã kết nối.';
    updateAccountFields();
  }

  async function loadTikTokPrivacy() {
    const accountId = $('#flowTiktokAccount').value;
    const select = $('#flowTiktokPrivacy');
    select.replaceChildren(new Option('Đang tải…', ''));
    if (!accountId) return;
    try {
      const {creator} = await request(`/api/posts/tiktok/creator?accountId=${encodeURIComponent(accountId)}`);
      select.replaceChildren(...(creator.privacy_level_options || []).map(value => new Option(value, value)));
      if (creator.privacy_level_options?.includes('PUBLIC_TO_EVERYONE')) select.value = 'PUBLIC_TO_EVERYONE';
      for (const [id, disabled] of [['flowTiktokComment', creator.comment_disabled],
        ['flowTiktokDuet', creator.duet_disabled], ['flowTiktokStitch', creator.stitch_disabled]]) {
        $(`#${id}`).disabled = !!disabled;
        if (disabled) $(`#${id}`).checked = false;
      }
    } catch (error) { $('#flowAccountHint').textContent = error.message; }
  }

  function updateAccountFields() {
    const selected = new Set([...document.querySelectorAll('input[name="flowPlatform"]:checked')]
      .map(input => input.value));
    $('#flowAccountFields').hidden = ![...selected].some(platform =>
      state.accountConfig?.platforms[platform]?.provider === 'zernio');
    for (const platform of ['tiktok', 'facebook', 'youtube']) {
      const field = $(`#flow${platform[0].toUpperCase()}${platform.slice(1)}AccountField`);
      field.hidden = !selected.has(platform) || state.accountConfig?.platforms[platform]?.provider !== 'zernio';
    }
    $('#flowTiktokOptions').hidden = !selected.has('tiktok');
    $('#flowYoutubeOptions').hidden = !selected.has('youtube');
    if (selected.has('tiktok')) void loadTikTokPrivacy();
  }

  function autoSettings() {
    const selected = [...document.querySelectorAll('input[name="flowPlatform"]:checked')]
      .map(input => input.value);
    if (!selected.length) throw new Error('Hãy chọn ít nhất một nền tảng đăng bài.');
    if (!$('#flowConsent').checked) throw new Error('Hãy đồng ý cho đợt tự tạo và đăng bài.');
    const targets = {};
    for (const platform of selected) {
      const accountId = $(`#flow${platform[0].toUpperCase()}${platform.slice(1)}Account`).value;
      if (state.accountConfig.platforms[platform].provider === 'zernio' && !accountId)
        throw new Error(`Hãy chọn tài khoản ${platform}.`);
      targets[platform] = accountId ? {accountId} : {};
    }
    if (targets.tiktok) {
      if (!$('#flowTiktokPrivacy').value) throw new Error('Hãy chọn quyền riêng tư TikTok.');
      Object.assign(targets.tiktok, {privacy: $('#flowTiktokPrivacy').value,
        allowComment: $('#flowTiktokComment').checked, allowDuet: $('#flowTiktokDuet').checked,
        allowStitch: $('#flowTiktokStitch').checked, isAigc: $('#flowTiktokAigc').checked});
    }
    if (targets.youtube) Object.assign(targets.youtube, {privacy: $('#flowYoutubePrivacy').value,
      madeForKids: $('#flowYoutubeMadeForKids').checked,
      containsSyntheticMedia: $('#flowYoutubeSynthetic').checked});
    return {enabled: true, consent: true, targets};
  }

  function renderBatches() {
    $('#flowBatches').innerHTML = state.batches.slice(0, 3).map(batch => {
      const complete = batch.items.filter(item => item.state === 'done').length;
      const failed = batch.items.filter(item => item.state === 'failed').length;
      const current = batch.items.find(item => !['done', 'failed'].includes(item.state));
      const completedLabel = batch.previewOnly ? 'preview sẵn sàng' : 'đã đăng đủ tài khoản';
      const canPublish = batch.previewOnly && batch.status === 'done' && complete === batch.items.length;
      return `<div class="flow-batch"><strong>Đợt ${esc(batch.id.slice(0, 8))}</strong> · ${complete}/${batch.items.length} ${completedLabel}${failed ? ` · ${failed} lỗi` : ''}<br><small>${esc(current ? `${current.title}: ${current.state}` : batch.status)} · dự toán ${batch.credits} credit video</small>${batch.status === 'active' ? `<button type="button" data-flow-stop="${esc(batch.id)}">Dừng đợt</button>` : ''}${canPublish ? `<button type="button" data-flow-publish="${esc(batch.id)}">Đăng toàn bộ preview</button>` : ''}</div>`;
    }).join('');
    $('#flowBatches').querySelectorAll('[data-flow-stop]').forEach(button => button.addEventListener('click', async () => {
      try { await request(`${endpoint}/auto/batches/${button.dataset.flowStop}/stop`, {method: 'POST'}); await refresh(); }
      catch (error) { status(error.message, true); }
    }));
    $('#flowBatches').querySelectorAll('[data-flow-publish]').forEach(button => button.addEventListener('click', async () => {
      try {
        const auto = autoSettings();
        await request(`${endpoint}/auto/batches/${button.dataset.flowPublish}/publish`, {
          method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({auto})});
        status('Đã gửi toàn bộ preview lên các tài khoản đã chọn.');
        await refresh();
      } catch (error) { status(error.message, true); }
    }));
  }

  function imagePrompt(job) {
    return `Create a photorealistic full-body fashion image of one adult female model wearing the exact ${job.category || 'garment'} in the product reference. Preserve garment cut, fabric, color, print, seams, silhouette and length. Use the selected background reference as the setting. ${job.modelId ? 'Use the woman in the model reference consistently.' : 'The model must look like a real adult woman.'} Vertical 9:16 fashion keyframe, natural anatomy, realistic fabric drape, clean lighting, no text, no logos added, no extra people.`;
  }

  function videoPrompt(job) {
    return `Make a vertical 9:16 realistic fashion try-on video from the approved image. The adult woman gently turns and takes a few natural steps, showing the garment clearly. Keep her face, body, garment color, cut, print, hem, background and lighting consistent in every frame. ${job.hasAction ? 'Follow the movement in the uploaded action reference video.' : 'Use subtle natural movement.'} No outfit changes, no cuts, no added text.`;
  }

  function fillAssets() {
    const currentBackground = $('#flowBackground').value;
    const currentModel = $('#flowModel').value;
    const backgrounds = state.assets.filter(asset => asset.kind === 'background');
    const models = state.assets.filter(asset => asset.kind === 'model');
    $('#flowBackground').innerHTML = '<option value="">Chọn background</option>' + backgrounds.map(asset =>
      `<option value="${esc(asset.id)}">${esc(asset.name)}</option>`).join('');
    $('#flowModel').innerHTML = '<option value="">Tạo người mẫu nữ mới</option>' + models.map(asset =>
      `<option value="${esc(asset.id)}">${esc(asset.name)}</option>`).join('');
    if (backgrounds.some(asset => asset.id === currentBackground)) $('#flowBackground').value = currentBackground;
    if (models.some(asset => asset.id === currentModel)) $('#flowModel').value = currentModel;
  }

  function renderJobs() {
    $('#flowJobs').innerHTML = state.jobs.length ? state.jobs.map(job =>
      `<button type="button" class="flow-job ${state.selected === job.id ? 'active' : ''}" data-flow-job="${esc(job.id)}">
        <span class="flow-job-thumb"><img src="${esc(job.garmentUrl)}" alt=""></span>
        <span class="flow-job-copy"><strong>${esc(job.category || 'Trang phục')}</strong><small>${esc(labels[job.state] || job.state)} · ${job.duration} giây</small><small>${new Date(job.createdAt).toLocaleString('vi-VN')}</small></span>
        <span aria-hidden="true">→</span></button>`).join('') :
      '<p class="flow-empty">Chưa có job. Thêm background và ảnh quần áo để bắt đầu.</p>';
    document.querySelectorAll('[data-flow-job]').forEach(button => button.addEventListener('click', () => {
      state.selected = button.dataset.flowJob; state.detailKey = ''; renderJobs(); renderDetail();
    }));
  }

  function renderDetail() {
    const job = state.jobs.find(item => item.id === state.selected);
    const target = $('#flowDetail');
    target.hidden = !job;
    if (!job) return;
    const autoItem = state.batches.flatMap(batch => batch.items).find(item => item.jobId === job.id);
    const key = `${job.id}:${job.updatedAt}:${autoItem?.state || ''}:${JSON.stringify(autoItem?.postResults || {})}`;
    if (state.detailKey === key) return;
    state.detailKey = key;
    const busy = ['queued_image', 'generating_image', 'queued_video', 'generating_video'].includes(job.state);
    const hasStill = ['image_review', 'ready_video', 'queued_video', 'generating_video', 'credit_pause', 'done'].includes(job.state);
    const problem = ['auth_required', 'needs_attention'].includes(job.state);
    const buttons = [];
    if (job.state === 'done') buttons.push(`<a class="button primary" href="${esc(job.videoUrl)}" download="flow-${esc(job.id)}.mp4">Tải MP4</a>`);
    const imageStage = ['ready_image', 'auth_required', 'needs_attention'].includes(job.state);
    const videoStage = ['image_review', 'ready_video', 'credit_pause', 'auth_required', 'needs_attention'].includes(job.state);
    const postStatus = autoItem?.postResults ? Object.entries(autoItem.postResults)
      .map(([platform, result]) => {
        const text = `${platform}: ${result.state}${result.error ? ` (${result.error})` : ''}`;
        return /^https?:\/\//.test(result.url || '') ?
          `<a href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
      }).join(' · ') : '';
    const guide = autoItem ? `<p class="flow-progress">Tự động: ${esc(autoItem.state)}${autoItem.error ? ` · ${esc(autoItem.error)}` : ''}${postStatus ? ` · ${postStatus}` : ''}${autoItem.postId ? ` · lượt đăng ${esc(autoItem.postId)}` : ''}</p>` : job.state === 'done' ? '' : `<div class="flow-manual-guide">
      <h4>Làm trên Flow trong trình duyệt thường</h4>
      <p>Mở Flow bằng nút phía trên. Dùng tài khoản Pro đã đăng nhập trong Edge/Chrome; app không cần đăng nhập Google.</p>
      ${imageStage ? `<div class="flow-guide-step"><strong>1. Tạo ảnh thử đồ</strong><p>Tải ảnh quần áo và background bên dưới vào Flow. Nếu đã chọn người mẫu, thêm cả ảnh đó. Chọn Image, tỉ lệ 9:16 và tạo một ảnh. Khi tiện ích Flow Try-on đang theo dõi job, ảnh mới sẽ tự tải và tự nhập vào đây.</p>
        <div class="flow-guide-links"><a href="${esc(job.garmentUrl)}" download="garment">Tải ảnh quần áo</a><a href="/api/flow/assets/${esc(job.backgroundId)}/image" download="background">Tải background</a>${job.modelId ? `<a href="/api/flow/assets/${esc(job.modelId)}/image" download="model">Tải ảnh người mẫu</a>` : ''}</div>
        <textarea readonly rows="5" aria-label="Prompt tạo ảnh thử đồ">${esc(imagePrompt(job))}</textarea><button type="button" class="button ghost compact" data-flow-copy="image">Sao chép prompt ảnh</button></div>` : ''}
      ${videoStage ? `<div class="flow-guide-step"><strong>2. Tạo video</strong><p>Dùng ảnh thử đồ đã duyệt làm ảnh đầu vào. Chọn Video, tỉ lệ 9:16; ${job.hasAction ? 'thêm clip hành động gốc làm tham chiếu; ' : ''}tạo các đoạn cần thiết. Ghép trong Scenebuilder của Flow rồi tải cả scene thành một MP4 dài ít nhất ${job.duration} giây.</p>
        ${hasStill ? `<a href="${esc(job.stillUrl)}" download="tryon-image">Tải ảnh thử đồ</a>` : ''}
        <textarea readonly rows="5" aria-label="Prompt tạo video thử đồ">${esc(videoPrompt(job))}</textarea><button type="button" class="button ghost compact" data-flow-copy="video">Sao chép prompt video</button></div>` : ''}
      <div class="flow-recovery"><p>Sau khi tải kết quả từ Flow, nhập vào job này:</p>
        ${imageStage ? '<label class="button ghost compact">Nhập ảnh thử đồ<input data-flow-import="image" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>' : ''}
        ${videoStage ? '<label class="button ghost compact">Nhập MP4 hoàn chỉnh<input data-flow-import="video" type="file" accept="video/mp4" hidden></label>' : ''}</div></div>`;
    target.innerHTML = `<div class="flow-detail-head"><div><span class="flow-kicker">JOB ${esc(job.id.slice(0, 8))}</span><h3>${esc(job.category || 'Trang phục')} · ${job.duration} giây</h3><p>${esc(labels[job.state] || job.state)}</p></div><span class="flow-state ${problem ? 'warn' : ''}">${esc(labels[job.state] || job.state)}</span></div>
      ${job.error ? `<p class="flow-job-error" role="alert">${esc(job.error)} ${problem ? `<a href="/api/flow/jobs/${esc(job.id)}/media/debug" target="_blank" rel="noopener noreferrer">Xem ảnh màn hình Flow</a>` : ''}</p>` : ''}
      <div class="flow-review-grid"><div><span>Ảnh sản phẩm</span><img src="${esc(job.garmentUrl)}" alt="Ảnh quần áo đã tải lên"></div>
      ${hasStill ? `<div><span>Ảnh thử đồ để duyệt</span><img src="${esc(job.stillUrl)}" alt="Ảnh thử đồ do Flow tạo"></div>` : ''}
      ${job.state === 'done' ? `<div><span>Video thành phẩm</span><video src="${esc(job.videoUrl)}" controls playsinline preload="metadata"></video></div>` : ''}</div>
      ${busy ? '<p class="flow-progress">Job đang xử lý. Trang này tự cập nhật.</p>' : ''}
      <div class="flow-detail-actions">${buttons.join('')}</div>
      ${guide}`;
    target.querySelectorAll('[data-flow-action]').forEach(button => button.addEventListener('click', () =>
      void act(job.id, button.dataset.flowAction)));
    target.querySelectorAll('[data-flow-import]').forEach(input => input.addEventListener('change', () =>
      void importResult(job.id, input.dataset.flowImport, input.files[0])));
    target.querySelectorAll('[data-flow-copy]').forEach(button => button.addEventListener('click', async () => {
      const prompt = button.parentElement.querySelector('textarea')?.value;
      if (!prompt) return;
      try { await navigator.clipboard.writeText(prompt); button.textContent = 'Đã sao chép'; }
      catch { status('Không sao chép được; hãy chọn và sao chép trong ô prompt.', true); }
    }));
  }

  async function refresh() {
    if (document.querySelector('.app-shell')?.dataset.page !== 'flow') return;
    try {
      const [assets, jobs, batches, extension] = await Promise.all([request(`${endpoint}/assets`),
        request(`${endpoint}/jobs`), request(`${endpoint}/auto/batches`), request(`${endpoint}/auto/status`)]);
      state.assets = assets.assets; state.jobs = jobs.jobs; state.batches = batches.batches;
      if (!state.selected && state.jobs.length) state.selected = state.jobs[0].id;
      fillAssets(); renderJobs(); renderBatches(); renderDetail();
      $('#flowExtensionStatus').textContent = extension.connected
        ? 'Tiện ích Edge đang kết nối với tab Flow.'
        : 'Tiện ích chưa kết nối. Tải lại tiện ích tại edge://extensions rồi mở lại tab Flow.';
    } catch (error) { status(error.message, true); }
  }

  async function act(id, action) {
    try { await request(`${endpoint}/jobs/${id}/${action}`, {method: 'POST'}); await refresh(); }
    catch (error) { status(error.message, true); }
  }

  async function importResult(id, kind, file) {
    if (!file) return;
    try { await upload(`${endpoint}/jobs/${id}/import-${kind}`, file); await refresh(); }
    catch (error) { status(error.message, true); }
  }

  $('#flowForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;
    const garments = [...$('#flowGarment').files];
    if (!garments.length || !$('#flowBackground').value) { status('Hãy chọn ảnh quần áo và background.', true); return; }
    if (garments.length > 100) { status('Mỗi đợt tối đa 100 ảnh quần áo.', true); return; }
    state.busy = true; $('#flowSubmit').disabled = true;
    try {
      if (!state.accountConfig) await loadAccounts();
      const extension = await request(`${endpoint}/auto/status`);
      if (!extension.connected) throw new Error('Tiện ích Edge chưa kết nối. Tải lại tiện ích rồi mở tab Flow.');
      const previewOnly = $('#flowPreviewOnly').checked;
      const auto = previewOnly ? null : autoSettings();
      const jobIds = [];
      const titles = [];
      for (let index = 0; index < garments.length; index++) {
        const garment = garments[index];
        status(`Đang tải ảnh ${index + 1}/${garments.length}: ${garment.name}`);
        const {job} = await request(`${endpoint}/jobs`, {method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({backgroundId: $('#flowBackground').value, modelId: $('#flowModel').value || null,
          category: $('#flowCategory').value.trim() || garment.name.replace(/\.[^.]+$/, ''),
          duration: Number($('#flowDuration').value), hasAction: false})});
        await upload(`${endpoint}/jobs/${job.id}/garment`, garment);
        jobIds.push(job.id);
        titles.push(garment.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() ||
          $('#flowCategory').value.trim() || 'Trang phục');
      }
      const {batch} = await request(`${endpoint}/auto/batches`, {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jobIds, titles, auto, previewOnly,
          maxCredits: Number($('#flowMaxCredits').value)})});
      state.selected = jobIds[0];
      status(`Đã đưa ${jobIds.length} bộ đồ vào đợt ${batch.id.slice(0, 8)}. ${previewOnly ? 'Chỉ tạo preview, chưa đăng.' : 'Sẽ tự đăng lên tài khoản đã chọn.'} Giữ tab Flow mở.`);
      await refresh();
    } catch (error) { status(error.message, true); }
    finally { state.busy = false; $('#flowSubmit').disabled = false; }
  });

  for (const kind of ['Background', 'Model']) {
    $(`#flow${kind}Upload`).addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const {asset} = await upload(`${endpoint}/assets?kind=${kind.toLowerCase()}`, file);
        await refresh(); $(`#flow${kind}`).value = asset.id;
        status(`Đã thêm ${kind === 'Background' ? 'background' : 'người mẫu'} vào kho.`);
      } catch (error) { status(error.message, true); }
      event.target.value = '';
    });
  }

  $('#flowGarment').addEventListener('change', event => {
    const file = event.target.files[0];
    const target = $('#flowGarmentPreview');
    if (target.dataset.url) URL.revokeObjectURL(target.dataset.url);
    target.replaceChildren();
    if (!file) { target.textContent = 'Chọn nhiều ảnh sản phẩm'; estimateCredits(); return; }
    const url = URL.createObjectURL(file);
    target.dataset.url = url;
    const image = document.createElement('img'); image.src = url; image.alt = 'Xem trước ảnh quần áo';
    target.append(image);
    if (event.target.files.length > 1) target.insertAdjacentText('beforeend', ` + ${event.target.files.length - 1} ảnh khác`);
    estimateCredits();
  });

  $('#flowDuration').addEventListener('change', estimateCredits);
  $('#flowPreviewOnly').addEventListener('change', () => {
    const previewOnly = $('#flowPreviewOnly').checked;
    $('#flowConsent').required = !previewOnly;
    $('#flowSubmit').textContent = previewOnly ? 'Tạo preview bằng Flow' : 'Tạo và tự đăng bằng Flow';
  });
  document.querySelectorAll('input[name="flowPlatform"]').forEach(input =>
    input.addEventListener('change', updateAccountFields));
  $('#flowTiktokAccount').addEventListener('change', loadTikTokPrivacy);
  estimateCredits();
  if (document.querySelector('.app-shell')?.dataset.page === 'flow') void loadAccounts().catch(error => status(error.message, true));

  window.refreshFlow = refresh;
  if (document.querySelector('.app-shell')?.dataset.page === 'flow') void refresh();
  setInterval(() => void refresh(), 6000);
})();
