ALTER TABLE quote_knowledge ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT ARRAY['cuoc_song']::text[];

UPDATE quote_knowledge SET categories =
  CASE WHEN cardinality(tags.value) = 0 THEN ARRAY['cuoc_song']::text[] ELSE tags.value END
FROM (
  SELECT id, array_remove(ARRAY[
    CASE WHEN content ~* 'kinh doanh|làm ăn|buôn bán|khách hàng|đối tác|giao dịch|doanh nghiệp|hợp tác|bán hàng|mô hình' THEN 'kinh_doanh' END,
    CASE WHEN content ~* 'chính trị|cử tri|lá phiếu|quốc hội|chính phủ|nhà nước|thể chế|chính sách|công quyền|quyền lực|người cầm quyền' THEN 'chinh_tri' END,
    CASE WHEN content ~* 'quản lý|lãnh đạo|nhân viên|sếp|giao quyền|chọn người|người đứng đầu|cả đội|tiêu chuẩn|năng lực|tổ chức' THEN 'quan_ly' END,
    CASE WHEN content ~* 'tiền|giàu|thu nhập|chi phí|lợi nhuận|cắt lỗ|mắc nợ|đòi nợ|tài chính|đầu tư|trả lương' THEN 'tai_chinh' END,
    CASE WHEN content ~* 'kỷ luật|nguyên tắc|giữ lời|thất hứa|trì hoãn|thói quen|cam kết|lời hứa' THEN 'ky_luat' END,
    CASE WHEN content ~* 'mối quan hệ|tôn trọng|tin tưởng|lòng tin|xung đột|cảm tình|gia đình|bạn bè|tình yêu|đối phương' THEN 'quan_he' END,
    CASE WHEN content ~* 'sợ|bình tĩnh|thể diện|động cơ|tâm lý|tự lừa|cảm xúc|sĩ diện|tham quyền' THEN 'tam_ly' END,
    CASE WHEN content ~* 'cuộc sống|cuộc đời|bản thân|trưởng thành|đường đời|sống' THEN 'cuoc_song' END
  ]::text[], NULL) AS value FROM quote_knowledge
) AS tags WHERE quote_knowledge.id = tags.id;

ALTER TABLE quote_knowledge ADD CONSTRAINT quote_knowledge_categories_check
  CHECK (cardinality(categories) >= 1 AND categories <@ ARRAY[
    'kinh_doanh', 'chinh_tri', 'quan_ly', 'tai_chinh', 'ky_luat', 'quan_he', 'tam_ly', 'cuoc_song'
  ]::text[]);

CREATE INDEX IF NOT EXISTS quote_knowledge_categories_idx ON quote_knowledge USING gin(categories);

INSERT INTO quote_knowledge (id, content, categories) VALUES
  (gen_random_uuid(), 'Lá phiếu chỉ có giá trị lâu dài khi người cầm quyền vẫn phải giải trình sau ngày thắng cử.', ARRAY['chinh_tri']),
  (gen_random_uuid(), 'Một chính sách được gọi là vì số đông phải nói rõ ai hưởng lợi, ai trả phí và ai có quyền sửa sai.', ARRAY['chinh_tri', 'tai_chinh']),
  (gen_random_uuid(), 'Khi luật lệ thay đổi theo tên người vi phạm, trật tự còn lại chỉ là đặc quyền được viết thành văn bản.', ARRAY['chinh_tri']),
  (gen_random_uuid(), 'Đừng gọi sự đồng thuận là thật khi người bất đồng phải trả giá chỉ để được lên tiếng.', ARRAY['chinh_tri', 'tam_ly']),
  (gen_random_uuid(), 'Quyền lực càng tập trung, cách kiểm tra quyết định của nó càng phải đơn giản và công khai.', ARRAY['chinh_tri', 'quan_ly']),
  (gen_random_uuid(), 'Một quyết định công không thể chỉ công bố lợi ích mà giấu chi phí sẽ đổ lên vai ai.', ARRAY['chinh_tri', 'tai_chinh']),
  (gen_random_uuid(), 'Người đứng đầu được phép sai; điều đáng sợ là cả bộ máy phải giả vờ quyết định ấy luôn đúng.', ARRAY['chinh_tri', 'quan_ly']),
  (gen_random_uuid(), 'Quyền phản biện không nằm ở lời mời phát biểu mà ở việc người nói có bị trừng phạt sau đó hay không.', ARRAY['chinh_tri'])
ON CONFLICT (content) DO NOTHING;
