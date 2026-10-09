(() => {
  const generatePattern = /^(?:generate\b|tạo\b)/i;
  const downloadPattern = /(?:download|tải xuống)/i;
  const morePattern = /^(?:more|more options|thêm|tùy chọn|tuỳ chọn|⋮)$/i;
  let armedJobId = null;
  let generation = null;
  let scanTimer = null;

  const label = element => [element.getAttribute('aria-label'), element.getAttribute('title'),
    element.getAttribute('data-tooltip'), element.innerText].filter(Boolean).join(' ').trim();
  const controls = () => [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')]
    .filter(element => downloadPattern.test(label(element)) && !/download project/i.test(label(element)));
  const images = () => [...document.querySelectorAll('img')]
    .map(element => ({element, src: element.currentSrc || element.src})).filter(item => item.src);

  async function status(message) { await chrome.storage.local.set({status: message}); }

  async function syncJob() {
    const data = await chrome.storage.local.get('armedJobId');
    armedJobId = data.armedJobId || null;
    generation = null;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.armedJobId) void syncJob();
  });
  void syncJob();

  document.addEventListener('click', event => {
    if (!armedJobId) return;
    const button = event.target instanceof Element ? event.target.closest('button,[role="button"]') : null;
    if (!button || !generatePattern.test(label(button))) return;
    generation = {
      jobId: armedJobId,
      started: Date.now(),
      knownControls: new Set(controls()),
      knownImages: new Set(images().map(item => item.src)),
      downloading: false,
    };
    void status('Đã thấy lệnh Generate; đang chờ ảnh mới trên Flow.');
  }, true);

  function relatedControl(image, pattern) {
    let parent = image.parentElement;
    for (let depth = 0; depth < 6 && parent; depth++, parent = parent.parentElement) {
      if (parent.querySelectorAll('img').length > 2) continue;
      const match = [...parent.querySelectorAll('button,[role="button"],a')]
        .find(element => pattern.test(label(element)));
      if (match) return match;
    }
    return null;
  }

  async function download(button, current) {
    if (current.downloading) return;
    current.downloading = true;
    try {
      const response = await chrome.runtime.sendMessage({type: 'flow-image-ready', jobId: current.jobId});
      if (!response?.ready) throw new Error('Extension không xác nhận được job.');
      button.click();
      await status('Đã bấm tải ảnh trên Flow; đang chờ trình duyệt lưu file.');
      // Flow may open a download menu. Select its image format if it appears.
      setTimeout(() => {
        const options = [...document.querySelectorAll('[role="menuitem"],button')];
        const imageOption = options.find(element => /^(?:download\s*)?(?:png|jpe?g|webp)$/i.test(label(element)));
        if (imageOption) imageOption.click();
      }, 350);
      generation = null;
    } catch (error) {
      current.downloading = false;
      await status(`Chưa tải được ảnh: ${error.message}`);
    }
  }

  function scan() {
    scanTimer = null;
    const current = generation;
    if (!current || current.downloading) return;
    if (Date.now() - current.started > 8 * 60_000) {
      generation = null;
      void status('Không tìm thấy nút tải ảnh mới. Mở extension để thử lại sau khi kiểm tra Flow.');
      return;
    }
    const newControls = controls().filter(element => !current.knownControls.has(element));
    const newImages = images().filter(item => !current.knownImages.has(item.src));
    const nearImage = newImages.map(item => relatedControl(item.element, downloadPattern)).find(Boolean);
    const candidate = nearImage || (newControls.length === 1 ? newControls[0] : null);
    if (candidate) void download(candidate, current);
    else if (!current.openedMore && newImages.length === 1) {
      const more = relatedControl(newImages[0].element, morePattern);
      if (more) { current.openedMore = true; more.click(); }
    }
  }

  new MutationObserver(() => {
    if (!generation || scanTimer) return;
    scanTimer = setTimeout(scan, 250);
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'aria-label', 'title']});
})();
