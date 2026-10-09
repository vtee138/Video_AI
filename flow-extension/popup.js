const jobs = document.querySelector('#jobs');
const arm = document.querySelector('#arm');
const status = document.querySelector('#status');
const eligible = new Set(['ready_image', 'auth_required', 'needs_attention']);

async function load() {
  try {
    const response = await fetch('http://127.0.0.1:4173/api/flow/jobs');
    if (!response.ok) throw new Error(`App local trả ${response.status}`);
    const data = await response.json();
    const pending = data.jobs.filter(job => eligible.has(job.state));
    jobs.replaceChildren();
    for (const job of pending) {
      const option = new Option(`${job.category || 'Trang phục'} · ${job.id.slice(0, 8)}`, job.id);
      jobs.add(option);
    }
    if (!pending.length) jobs.add(new Option('Chưa có job chờ ảnh', ''));
    const saved = await chrome.storage.local.get(['armedJobId', 'status']);
    if (pending.some(job => job.id === saved.armedJobId)) jobs.value = saved.armedJobId;
    arm.disabled = !pending.length;
    status.textContent = saved.status || 'Tạo job ở trang /flow trước.';
  } catch (error) {
    jobs.replaceChildren(new Option('Không kết nối được app local', ''));
    arm.disabled = true;
    status.textContent = error.message;
  }
}

arm.addEventListener('click', async () => {
  if (!jobs.value) return;
  await chrome.storage.local.set({armedJobId: jobs.value, status: 'Đang chờ bạn bấm Generate trên Flow.'});
  status.textContent = 'Đang chờ bạn bấm Generate trên Flow.';
});
void load();
