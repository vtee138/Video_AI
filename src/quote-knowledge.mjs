export const quoteCategories = Object.freeze([
  {id: 'kinh_doanh', label: 'Kinh doanh'},
  {id: 'chinh_tri', label: 'Chính trị'},
  {id: 'quan_ly', label: 'Quản lý'},
  {id: 'tai_chinh', label: 'Tiền bạc'},
  {id: 'ky_luat', label: 'Kỷ luật'},
  {id: 'quan_he', label: 'Quan hệ'},
  {id: 'tam_ly', label: 'Tâm lý'},
  {id: 'cuoc_song', label: 'Cuộc sống'},
]);

const categoryPatterns = {
  kinh_doanh: /kinh doanh|làm ăn|buôn bán|khách hàng|đối tác|giao dịch|doanh nghiệp|hợp tác|bán hàng|mô hình/iu,
  chinh_tri: /chính trị|cử tri|lá phiếu|quốc hội|chính phủ|nhà nước|thể chế|chính sách|công quyền|quyền lực|người cầm quyền/iu,
  quan_ly: /quản lý|lãnh đạo|nhân viên|sếp|giao quyền|chọn người|người đứng đầu|cả đội|tiêu chuẩn|năng lực|tổ chức/iu,
  tai_chinh: /tiền|giàu|thu nhập|chi phí|lợi nhuận|cắt lỗ|mắc nợ|đòi nợ|tài chính|đầu tư|trả lương/iu,
  ky_luat: /kỷ luật|nguyên tắc|giữ lời|thất hứa|trì hoãn|thói quen|cam kết|lời hứa/iu,
  quan_he: /mối quan hệ|tôn trọng|tin tưởng|lòng tin|xung đột|cảm tình|gia đình|bạn bè|tình yêu|đối phương/iu,
  tam_ly: /sợ|bình tĩnh|thể diện|động cơ|tâm lý|tự lừa|cảm xúc|sĩ diện|tham quyền/iu,
  cuoc_song: /cuộc sống|cuộc đời|bản thân|trưởng thành|đường đời|sống/iu,
};

export function parseQuoteCategories(value, {allowEmpty = true} = {}) {
  if (!Array.isArray(value)) throw new Error('Mảng nội dung Quote không hợp lệ.');
  const valid = new Set(quoteCategories.map(category => category.id));
  const unique = [...new Set(value.map(String))];
  if ((!allowEmpty && !unique.length) || unique.some(id => !valid.has(id))) {
    throw new Error('Hãy chọn mảng nội dung Quote hợp lệ.');
  }
  return unique;
}

export function inferQuoteCategories(content) {
  const found = quoteCategories.filter(category => categoryPatterns[category.id].test(content)).map(category => category.id);
  return found.length ? found : ['cuoc_song'];
}

export function eligibleQuoteKnowledge(content) {
  return String(content || '').trim().length >= 60 &&
    (String(content).match(/[\p{L}\p{N}]+/gu) || []).length >= 12;
}

export function pickBalancedQuoteKnowledge(items, categories, limit = 8) {
  const selected = [];
  const remaining = [...items];
  if (categories.length) {
    for (const category of categories) {
      const index = remaining.findIndex(item => item.categories.includes(category));
      if (index !== -1 && selected.length < limit) selected.push(...remaining.splice(index, 1));
    }
  }
  return selected.concat(remaining.slice(0, Math.max(0, limit - selected.length)));
}

export function normalizeKnowledgeContent(value) {
  const content = String(value ?? '').trim().replace(/\s+/gu, ' ');
  if (content.length < 8 || content.length > 2000) {
    throw new Error('Mỗi mục triết lý cần từ 8 đến 2.000 ký tự.');
  }
  return content;
}

export function parseKnowledgeBatch(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('Hãy gửi từ 1 đến 100 mục mỗi lần.');
  }
  return [...new Set(value.map(normalizeKnowledgeContent))];
}

export function quoteKnowledgeInstructions({source = null, sources = [], categories = [], examples = []} = {}) {
  const parts = [];
  if (source) parts.push(`Ý gốc được chọn từ kho triết lý: ${JSON.stringify(source)}. Giữ hạt nhân lập luận nhưng diễn đạt lại rõ rệt bằng từ ngữ, nhịp câu và tình huống mới; không bê nguyên câu gốc vào title, hook hoặc caption. Tạo 8 góc triển khai khác nhau từ ý gốc.`);
  if (sources.length) parts.push(`Các ý gốc được rút ngẫu nhiên từ kho: ${JSON.stringify(sources)}. Tạo đúng 8 Quote có góc nhìn riêng; phân bổ qua các ý gốc và các mảng đã chọn, không biến cả 8 thành một chủ đề. Nếu có ít hơn 8 ý gốc, triển khai nhiều tình huống thật khác nhau từ các ý hiện có. Giữ hạt nhân lập luận nhưng diễn đạt lại rõ rệt; không chép nguyên câu gốc vào title, hook hoặc caption.`);
  if (categories.length) parts.push(`Chỉ viết trong các mảng nội dung này: ${categories.join(', ')}. Khi viết về chính trị, tập trung vào cơ chế quyền lực, trách nhiệm giải trình, lợi ích và quyết sách; không bịa sự kiện, nhân vật, số liệu hoặc quy kết cho nhóm người có thật.`);
  if (examples.length) parts.push(`Các mẫu trong kho để học giọng và loại chủ đề người dùng thích: ${JSON.stringify(examples)}. Chỉ học nhịp, mức độ sắc và cách nhìn; không chép nguyên văn hoặc gom nhiều ý không liên quan vào một video. Chủ đề người dùng nhập vẫn là ưu tiên cao nhất.`);
  return parts.join(' ');
}

export function hasVerbatimKnowledgePassage(source, texts) {
  const words = String(source || '').toLocaleLowerCase('vi').match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 5) return false;
  const windowSize = Math.min(8, words.length);
  const haystack = texts.join(' ').toLocaleLowerCase('vi').match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
  for (let index = 0; index <= words.length - windowSize; index++) {
    if (` ${haystack} `.includes(` ${words.slice(index, index + windowSize).join(' ')} `)) return true;
  }
  return false;
}
