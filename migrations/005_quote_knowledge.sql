CREATE TABLE IF NOT EXISTS quote_knowledge (
  id uuid PRIMARY KEY,
  content text NOT NULL UNIQUE CHECK (char_length(content) BETWEEN 8 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS quote_knowledge_rotation_idx ON quote_knowledge(last_used_at NULLS FIRST, created_at);

INSERT INTO quote_knowledge (id, content) VALUES
  (gen_random_uuid(), 'Giữ người sai việc vì sợ mang tiếng tàn nhẫn là bắt cả đội trả lương cho sự yếu tay của người quyết định.'),
  (gen_random_uuid(), 'Người luôn nói điều dễ nghe thường đang mua quyền miễn trách nhiệm bằng sự hài lòng nhất thời của người nghe.'),
  (gen_random_uuid(), 'Khi ai cũng có quyền góp ý nhưng không ai chịu hậu quả, quyết định sẽ thuộc về người ồn nhất.'),
  (gen_random_uuid(), 'Cắt lỗ muộn không chứng minh lòng kiên trì; nó chỉ kéo thêm người vào hóa đơn của một quyết định sai.'),
  (gen_random_uuid(), 'Một lời hứa không có người chịu trách nhiệm và thời hạn rõ ràng chỉ là cách trì hoãn cuộc nói chuyện khó.'),
  (gen_random_uuid(), 'Giữ thể diện cho người mắc lỗi bằng cách giấu lỗi là lấy uy tín của cả nhóm trả thay.'),
  (gen_random_uuid(), 'Trao quyền mà vẫn giữ mọi quyết định trong tay là giao việc, không phải giao quyền.'),
  (gen_random_uuid(), 'Người giỏi rời đi không chỉ vì tiền; họ rời đi khi phải gánh hậu quả cho người liên tục được bỏ qua lỗi.'),
  (gen_random_uuid(), 'Một nguyên tắc chỉ áp dụng với người yếu thế thì không phải nguyên tắc, mà là đặc quyền được ngụy trang.'),
  (gen_random_uuid(), 'Không chốt tiêu chuẩn trước khi chọn người thì sau đó chỉ còn tranh cãi bằng cảm tình.'),
  (gen_random_uuid(), 'Im lặng trước một việc sai lặp lại là dạy cả đội rằng lời nói của người đứng đầu không có giá.'),
  (gen_random_uuid(), 'Ai nhận phần thưởng khi thuận lợi cũng phải có tên trong cuộc họp xử lý khi mọi thứ hỏng.'),
  (gen_random_uuid(), 'Sự tử tế không đòi người khác làm thay phần việc của người liên tục thất hứa.'),
  (gen_random_uuid(), 'Nói không đúng lúc giữ lại tiền, thời gian và quyền chọn; nói có để tránh mất lòng thường làm mất cả ba.'),
  (gen_random_uuid(), 'Đừng để một người kiểm soát toàn bộ thông tin rồi gọi đó là lòng trung thành.'),
  (gen_random_uuid(), 'Kỷ luật đáng tin là tiêu chuẩn được giữ cả khi người vi phạm có quan hệ tốt với người ra quyết định.')
ON CONFLICT (content) DO NOTHING;
