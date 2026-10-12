import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleQuoteKnowledge, hasVerbatimKnowledgePassage, inferQuoteCategories,
  normalizeKnowledgeContent, parseKnowledgeBatch, parseQuoteCategories,
  pickBalancedQuoteKnowledge, quoteKnowledgeInstructions} from './quote-knowledge.mjs';

test('kho triết lý chuẩn hóa khoảng trắng và bỏ mục trùng trong một lần nhập', () => {
  assert.deepEqual(parseKnowledgeBatch([
    '  Giữ  lời  hứa\ntrong lúc khó. ',
    'Giữ lời hứa trong lúc khó.',
    'Chọn người theo việc, không theo lời nịnh.',
  ]), ['Giữ lời hứa trong lúc khó.', 'Chọn người theo việc, không theo lời nịnh.']);
});

test('kho triết lý từ chối nội dung rỗng, quá dài và lô quá lớn', () => {
  assert.throws(() => normalizeKnowledgeContent('ngắn'), /8 đến 2.000/);
  assert.throws(() => normalizeKnowledgeContent('a'.repeat(2001)), /8 đến 2.000/);
  assert.throws(() => parseKnowledgeBatch(Array(101).fill('Một nguyên tắc đủ dài.')), /1 đến 100/);
});

test('lệnh viết từ kho buộc diễn đạt lại ý gốc và chỉ học giọng từ ví dụ', () => {
  const instruction = quoteKnowledgeInstructions({source: 'Ý gốc cần triển khai.', examples: ['Một ví dụ về giọng.']});
  assert.match(instruction, /diễn đạt lại rõ rệt/);
  assert.match(instruction, /không bê nguyên câu gốc/);
  assert.match(instruction, /Chỉ học nhịp/);
});

test('phát hiện đoạn chép nguyên ý gốc nhưng chấp nhận cách diễn đạt mới', () => {
  const source = 'Giữ người sai việc vì sợ mang tiếng tàn nhẫn là bắt cả đội trả lương cho sự yếu tay của người quyết định.';
  assert.equal(hasVerbatimKnowledgePassage(source, ['Đừng giữ người sai việc vì sợ mang tiếng tàn nhẫn.']), true);
  assert.equal(hasVerbatimKnowledgePassage(source, ['Cắt một vị trí không phù hợp để cả đội khỏi gánh phần việc bị bỏ lại.']), false);
});

test('mảng Quote chấp nhận nhiều lựa chọn và nhận diện nội dung nhập mới', () => {
  assert.deepEqual(parseQuoteCategories(['kinh_doanh', 'chinh_tri', 'kinh_doanh']), ['kinh_doanh', 'chinh_tri']);
  assert.throws(() => parseQuoteCategories(['khong_hop_le']), /hợp lệ/);
  assert.deepEqual(inferQuoteCategories('Khách hàng trả tiền cho một lời hứa trong kinh doanh.'),
    ['kinh_doanh', 'tai_chinh', 'ky_luat']);
});

test('rút nhiều ý, ưu tiên phủ đủ mảng và bỏ tiêu đề cụt', () => {
  assert.equal(eligibleQuoteKnowledge('4. Năng lực và giá trị'), false);
  assert.equal(eligibleQuoteKnowledge('Quyền lực càng tập trung, cách kiểm tra quyết định của nó càng phải đơn giản và công khai.'), true);
  const items = [
    {id: 'a', categories: ['kinh_doanh']},
    {id: 'b', categories: ['kinh_doanh']},
    {id: 'c', categories: ['chinh_tri']},
    {id: 'd', categories: ['quan_ly']},
  ];
  assert.deepEqual(pickBalancedQuoteKnowledge(items, ['kinh_doanh', 'chinh_tri', 'quan_ly'], 3)
    .map(item => item.id), ['a', 'c', 'd']);
});

test('lệnh Quote ngẫu nhiên phân bổ 8 ý và giữ các mảng được chọn', () => {
  const instruction = quoteKnowledgeInstructions({sources: [{content: 'Một ý trong kho.', categories: ['Chính trị']}],
    categories: ['Chính trị', 'Quản lý']});
  assert.match(instruction, /Tạo đúng 8 Quote/);
  assert.match(instruction, /không biến cả 8 thành một chủ đề/);
  assert.match(instruction, /Chính trị, Quản lý/);
});
