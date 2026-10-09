export function validateSuperPlan(input, now = new Date()) {
  const template = input.template === 'quote' ? 'quote' : 'ranking';
  const mode = template === 'quote' ? input.mode : null;
  if (template === 'quote' && !['onscreen', 'caption'].includes(mode)) throw new Error('Hãy chọn chế độ Quote.');
  const intervalMinutes = Number(input.intervalMinutes);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 10080) {
    throw new Error('Khoảng cách đăng phải từ 15 phút đến 7 ngày.');
  }
  const start = new Date(input.startAt);
  if (!input.startAt || !Number.isFinite(start.getTime()) || start.getTime() < now.getTime() - 60_000 ||
      start.getTime() > now.getTime() + 90 * 86400_000) {
    throw new Error('Giờ đăng đầu tiên phải từ hiện tại đến 90 ngày tới.');
  }
  const focus = String(input.focus || '').trim();
  if (focus.length > 300) throw new Error('Định hướng chủ đề tối đa 300 ký tự.');
  return {template, mode, intervalMinutes, startAt: start.toISOString(), focus};
}

export function nextPostAt(scheduledAt, lastStartedAt, intervalMinutes) {
  const earliest = lastStartedAt ? new Date(lastStartedAt).getTime() + intervalMinutes * 60_000 : 0;
  return new Date(Math.max(new Date(scheduledAt).getTime(), earliest)).toISOString();
}

export function validateSuperRetry({campaignStatus, itemStatus, postId, hasPostHistory, hasNeedsReview, hasOpenItem = false}) {
  if (itemStatus !== 'failed') throw new Error('Chỉ có thể Retry video đang ở trạng thái lỗi.');
  if (postId || hasPostHistory) {
    throw new Error('Video này đã có lịch sử đăng. Hãy kiểm tra nền tảng trước để tránh đăng trùng.');
  }
  if (hasNeedsReview) {
    throw new Error('Chiến dịch còn bài đăng cần kiểm tra. Hãy xác nhận bài đó trước khi Retry video khác.');
  }
  if (hasOpenItem) throw new Error('Chiến dịch đang xử lý một video khác. Hãy đợi video đó hoàn tất rồi Retry.');
}

export function isFootageShortage(error) {
  const message = String(error || '');
  return /Chỉ tìm được \d+\/\d+ clip phù hợp\./u.test(message) &&
    message.includes('Hãy chạy thủ công');
}

export function validateSuperFootageRepair({itemStatus, jobId, postId, hasPostHistory, error}) {
  if (!['failed', 'manual_review'].includes(itemStatus)) {
    throw new Error('Chỉ có thể bổ sung footage cho video đang ở trạng thái lỗi.');
  }
  if (!jobId) throw new Error('Video này không còn job để mở trong trình chỉnh sửa.');
  if (postId || hasPostHistory) {
    throw new Error('Video này đã có lịch sử đăng. Hãy kiểm tra nền tảng trước để tránh đăng trùng.');
  }
  if (itemStatus === 'failed' && !isFootageShortage(error)) {
    throw new Error('Lỗi này không phải do thiếu footage; hãy dùng Retry video.');
  }
}
