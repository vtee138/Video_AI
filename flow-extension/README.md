# Tự chạy hàng đợi thử đồ trong Google Flow

Tiện ích chạy trong Edge đã đăng nhập Google. Khi bạn bắt đầu một đợt trong trang `/flow`, tiện ích lấy từng job, tải ảnh tham chiếu vào Flow, chọn Nano Banana 2 Lite/Veo 3.1 Lite, tỷ lệ 9:16 và một kết quả, gửi prompt, xác nhận Generate, tải file về. Watcher nhập ảnh/video vào app và app đăng lên tài khoản bạn đã chọn. Không cần bấm Generate cho từng job.

## Cài một lần trong Microsoft Edge

1. Mở `edge://extensions` trong Edge, bật **Developer mode**.
2. Bấm **Load unpacked** và chọn thư mục `flow-extension` này.
3. Tải lại tab Google Flow đang mở.
4. Sau khi cập nhật thư mục tiện ích, bấm **Reload** trên thẻ tiện ích và tải lại tab Flow.
5. Chạy `npm run web`. Server tự theo dõi file tải xuống; giữ Edge, tab Flow và server chạy đến hết đợt. Nếu Edge lưu file vào thư mục khác `C:\Users\<tên người dùng>\Downloads`, đặt `FLOW_DOWNLOAD_DIR` thành đường dẫn thư mục con `flow-tryon` của thư mục tải xuống đó.

## Chạy một đợt

1. Ở `/flow`, thêm background, chọn nhiều ảnh quần áo và thời lượng. Mặc định đợt chỉ tạo preview. Bỏ chọn **Chỉ tạo preview** để tự đăng sau khi tạo, hoặc xem MP4 rồi bấm **Đăng toàn bộ preview** với tài khoản đã chọn.
2. Mở một project Flow ở mục **All media** trong Edge. Trang `/flow` phải báo tiện ích đang kết nối.
3. Xác nhận dự toán credit video rồi bấm nút tạo đợt một lần. Nếu đăng tự động, chọn tài khoản và đánh dấu đồng ý đăng.
4. Xem tiến độ từng job trong hàng đợi. Nếu Flow đổi giao diện hoặc chặn tạo, job bị đánh dấu lỗi và hàng đợi tiếp tục với job kế tiếp; app không tự Generate lại một tác vụ đã tiêu credit.

Tự động hóa dùng giao diện Flow hiện tại, nên thay đổi giao diện hoặc hạn chế credit/rate limit có thể làm một job dừng. App lưu MP4 và trạng thái đăng để kiểm tra. Chức năng theo dõi ảnh thủ công trong popup vẫn là đường dự phòng cho job cũ.

