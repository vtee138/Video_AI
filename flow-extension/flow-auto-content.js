(() => {
  if (globalThis.__flowAutoRunnerVersion === '0.3.2') return;
  globalThis.__flowAutoRunnerVersion = '0.3.2';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const label = element => [element?.getAttribute('aria-label'), element?.getAttribute('title'),
    element?.innerText].filter(Boolean).join(' ').trim();
  const visible = element => !!element && !!element.getClientRects().length;
  const buttons = () => [...document.querySelectorAll('button,[role="button"],[role="menuitem"]')]
    .filter(visible);
  let running = false;
  let lastStatus = '';

  async function status(value) {
    if (value === lastStatus) return;
    lastStatus = value;
    try { await chrome.storage.local.set({status: value}); } catch {}
  }

  async function api(path, options = {}) {
    const result = await chrome.runtime.sendMessage({type: 'flow-api', path,
      method: options.method || 'GET', body: options.body, binary: !!options.binary});
    if (!result || result.error) throw new Error(result?.error || 'Không kết nối được app local.');
    return result;
  }

  async function waitFor(fn, timeout = 20_000, interval = 300) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = fn();
      if (value) return value;
      await sleep(interval);
    }
    throw new Error('Giao diện Flow không hiện điều khiển cần thiết.');
  }

  function clickText(pattern, tag = 'button,[role="menuitem"],[role="option"]') {
    const element = [...document.querySelectorAll(tag)].find(value => visible(value) &&
      pattern.test(label(value)));
    if (!element) return false;
    element.click(); return true;
  }

  async function prepareProject() {
    if (location.pathname === '/' || location.pathname === '/about') {
      const create = buttons().find(value => /new project/i.test(label(value)));
      if (create) create.click();
      await waitFor(() => location.pathname.startsWith('/project/'), 15_000);
    }
    if (!/^\/project\/[^/]+\/?$/.test(location.pathname))
      throw new Error('Hãy để tab Flow ở trang All media của một project.');
    clickText(/^Get started$/i);
    if (clickText(/^All media$/i, 'a,button,[role="button"]')) await sleep(400);
    await waitFor(() => document.querySelector('button[aria-label="Add ingredients to the prompt box"]'));
  }

  const exactButton = value => buttons().find(button =>
    button.textContent.trim() === value && !button.disabled);

  async function setDefaults(kind) {
    const modelPill = () => buttons().find(button =>
      /(?:Nano Banana|^Video\b)/i.test(button.textContent.trim()) &&
        /\bx[1-4]\b/.test(button.textContent));
    if (!modelPill()) {
      const agent = exactButton('Agent');
      if (agent) agent.click();
    }
    const trigger = await waitFor(modelPill);
    if (!exactButton('Image') || !exactButton('Video')) trigger.click();
    const type = await waitFor(() => exactButton(kind === 'image' ? 'Image' : 'Video'));
    type.click();
    (await waitFor(() => exactButton('9:16'))).click();
    (await waitFor(() => exactButton('x1'))).click();
    if (visible(trigger)) trigger.click();
    await sleep(300);
  }

  function decode(base64) {
    const value = atob(base64);
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
    return bytes;
  }

  async function uploadReference(task, path, index) {
    const data = await api(path, {binary: true});
    const mimeType = (data.mimeType || 'image/png').split(';')[0];
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    const name = `flow-${task.jobId}-${task.kind}-${task.segment}-${index}.${ext}`;
    const file = new File([decode(data.data)], name, {type: mimeType});
    const add = await waitFor(() => document.querySelector('button[aria-label="Add ingredients to the prompt box"]'));
    add.click();
    let asset = [...document.querySelectorAll('button.asset-item')]
      .find(value => value.innerText.includes(name));
    if (!asset) {
    const upload = await waitFor(() => document.querySelector('button.sidebar-upload-btn'));
    const handler = event => {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return;
      event.preventDefault();
      document.removeEventListener('click', handler, true);
      const transfer = new DataTransfer(); transfer.items.add(file);
      event.target.files = transfer.files;
      event.target.dispatchEvent(new Event('change', {bubbles: true}));
    };
    document.addEventListener('click', handler, true);
    upload.click();
    await sleep(500);
    clickText(/^I agree$/i);
    asset = await waitFor(() => [...document.querySelectorAll('button.asset-item')]
      .find(value => value.innerText.includes(name)), 90_000, 1000);
    }
    asset.click();
    const addToPrompt = await waitFor(() => {
      const value = document.querySelector('button.detail-add-to-prompt-btn');
      return value && !value.disabled ? value : null;
    }, 90_000, 1000);
    addToPrompt.click();
    await sleep(250);
  }

  function setPrompt(value) {
    const fields = [...document.querySelectorAll('textarea,[contenteditable],[role="textbox"]')]
      .filter(field => visible(field) && (field instanceof HTMLTextAreaElement || field.isContentEditable));
    const editor = fields.at(-1);
    if (!editor) throw new Error(`Không thấy ô nhập prompt của Flow. Candidate: ${
      [...document.querySelectorAll('textarea,[contenteditable],[role="textbox"]')]
        .map(field => field.outerHTML.slice(0, 180)).slice(0, 6).join(' | ')}`);
    editor.focus();
    if (editor instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, value);
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, data: value,
        inputType: 'insertText'}));
    } else if (editor.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, value)) {
        editor.textContent = value;
        editor.dispatchEvent(new InputEvent('input', {bubbles: true, data: value,
          inputType: 'insertText'}));
      }
    } else throw new Error(`Ô nhập prompt không hỗ trợ: ${editor.outerHTML.slice(0, 180)}`);
    return editor;
  }

  function confirmGenerationButton() {
    const candidates = buttons().filter(value => {
      const name = [value.getAttribute('aria-label'), value.innerText, value.getAttribute('title')]
        .filter(Boolean).join(' ').trim();
      return /^Generate(?:\b|\s|$)/i.test(name) &&
        value.getAttribute('aria-label') !== 'Start generation' && !value.disabled;
    });
    return candidates.find(value => value.closest('[role="dialog"],[role="alertdialog"]')) || null;
  }

  async function generate(task, resumeConfirmation = false) {
    const knownDownloads = new Set(buttons().filter(value => /download/i.test(label(value))));
    const knownMedia = new Set([...document.querySelectorAll('img,video')]
      .map(value => value.currentSrc || value.src || value.poster));
    if (!resumeConfirmation) {
      setPrompt(task.prompt);
      const submit = await waitFor(() => {
        const button = document.querySelector('button[aria-label="Start generation"]');
        return button && visible(button) && !button.disabled ? button : null;
      });
      await chrome.storage.local.set({lastSubmit: submit.outerHTML.slice(0, 500)});
      submit.click();
    }
    const deadline = Date.now() + 10 * 60_000;
    let confirmed = false;
    while (Date.now() < deadline) {
      if (!confirmed) {
        const confirm = confirmGenerationButton();
        if (confirm) {
          await chrome.storage.local.set({lastConfirmation: confirm.outerHTML.slice(0, 800)});
          confirm.click(); confirmed = true;
        }
      }
      const newMedia = [...document.querySelectorAll('img,video')]
        .filter(value => !knownMedia.has(value.currentSrc || value.src || value.poster));
      const downloads = buttons().filter(value => /download/i.test(label(value)) &&
        !knownDownloads.has(value));
      const nearMedia = newMedia.map(media => {
        let parent = media.parentElement;
        for (let depth = 0; depth < 6 && parent; depth++, parent = parent.parentElement) {
          const button = [...parent.querySelectorAll('button')].find(value => /download/i.test(label(value)));
          if (button) return button;
        }
        return null;
      }).find(Boolean);
      const control = nearMedia || (downloads.length === 1 ? downloads[0] : null);
      if (control) {
        const ready = await chrome.runtime.sendMessage({type: 'flow-download-ready',
          jobId: task.jobId, kind: task.kind, segment: task.segment});
        if (!ready?.ready) throw new Error('Không gắn được tên file tải xuống.');
        control.click();
        await sleep(500);
        if (task.kind === 'image') clickText(/^(?:PNG|JPG|JPEG|WebP)$/i, '[role="menuitem"],button');
        if (task.kind === 'video') clickText(/^(?:MP4|Video)$/i, '[role="menuitem"],button');
        await status(`Đã tạo ${task.kind === 'image' ? 'ảnh' : 'video'}; đang nhập file vào app.`);
        return;
      }
      await sleep(1500);
    }
    throw new Error('Flow không trả kết quả có thể tải trong 10 phút.');
  }

  async function recoverConfirmation() {
    if (!confirmGenerationButton()) return;
    const {batches} = await api('/api/flow/auto/batches');
    const inProgress = batches.flatMap(batch => batch.status === 'active' ?
      batch.items.filter(item => item.state === 'generating_image' ||
        item.state === 'generating_video').map(item => ({batch, item})) : []);
    if (inProgress.length !== 1) return;
    const {batch, item} = inProgress[0];
    if (Date.now() - Date.parse(item.startedAt || batch.createdAt) > 15 * 60_000) return;
    await status(`Đang xác nhận Generate cho job ${item.jobId.slice(0, 8)}.`);
    await generate({jobId: item.jobId, kind: item.state === 'generating_image' ?
      'image' : 'video', segment: item.segment}, true);
  }

  async function run(task) {
    await api('/api/flow/auto/claim', {method: 'POST', body: task});
    let stage = 'mở project';
    try {
      await status(stage);
      await prepareProject();
      stage = 'chọn chế độ và cấu hình';
      await status(stage);
      if (!task.resumeSubmit) await setDefaults(task.kind);
      stage = 'tải ảnh tham chiếu';
      await status(stage);
      for (let index = 0; index < task.references.length; index++) {
        await status(`Đang tải ảnh tham chiếu ${index + 1}/${task.references.length} cho job ${task.jobId.slice(0, 8)}.`);
        await uploadReference(task, task.references[index], index);
      }
      stage = 'gửi prompt và tải kết quả';
      await status(stage);
      await status(`Flow đang tạo ${task.kind === 'image' ? 'ảnh' : 'video'} cho job ${task.jobId.slice(0, 8)}.`);
      await generate(task);
    }
    catch (error) {
      await api('/api/flow/auto/fail', {method: 'POST',
        body: {jobId: task.jobId, error: `${stage}: ${error.message}`}});
      throw error;
    }
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      const {task} = await api('/api/flow/auto/next');
      if (task) await run(task);
      else await recoverConfirmation();
    } catch (error) {
      await status(`Auto Flow: ${error.message}`);
    } finally { running = false; }
  }

  setInterval(() => void loop(), 5000);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'flow-run-now') {
      void loop();
      sendResponse({ready: true});
    }
  });
  void loop();
})();
