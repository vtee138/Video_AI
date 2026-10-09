# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node.js hiện có, PostgreSQL trong Docker Compose, giao diện HTML/CSS/JavaScript thuần; không thêm framework phía client.

## Users

Chủ sở hữu công cụ sử dụng hằng ngày trên máy cá nhân để tạo nhiều kiểu video dọc cho TikTok.

## Product Purpose

Biến một chủ đề ngắn thành nhiều video Remotion hoàn chỉnh. Người dùng có thể duyệt tài nguyên thủ công, bật Auto mode sau khi chọn ý tưởng, hoặc chạy Super Auto để tự tìm chủ đề và đăng liên tục theo lịch.

## Positioning

Công cụ cho phép chọn template, tạo nhiều ý tưởng trong một lượt và sản xuất từng video theo hàng chờ tuần tự.

## Operating Context

Chạy local trên Windows. Gemini tạo nội dung; Ranking tìm dữ liệu web còn Quote không tìm web. Các nguồn stock cung cấp footage, người dùng có thể upload MP4 bổ sung, nhạc lấy từ `public`, Remotion render và các API mạng xã hội đảm nhiệm bước đăng. PostgreSQL lưu tiến độ và trạng thái đăng.

## Capabilities and Constraints

- Giao diện và thông báo bằng tiếng Việt.
- PostgreSQL lưu video, tiến độ job và các lần đăng; MP4 vẫn nằm trong `output/`.
- Ranking phải có ít nhất 10 dòng cùng chỉ số, đơn vị và kỳ; Quote phải là nội dung nguyên bản, không gắn tác giả.
- Quote theo giọng lạnh, sắc và thực dụng về lãnh đạo, quyền quyết định, chọn người, cắt lỗ, lợi ích và trách nhiệm. Mỗi ý chỉ rõ hành động, hậu quả và người trả giá; tránh hướng chữa lành, nhân văn sách giáo khoa, danh ngôn trang trọng và khẩu hiệu rỗng. Mỗi video dùng đúng một ảnh chọn ngẫu nhiên từ kho ảnh upload, hook trên ảnh và caption có đúng 5 ý đánh số theo dạng quy tắc, phân tích hoặc cặp ưu tiên.
- Mỗi video phải vượt kiểm tra cấu trúc dữ liệu và đường dẫn nguồn trước khi render.
- Hàng chờ chỉ chạy một video tại một thời điểm; lỗi của một video không chặn video tiếp theo.
- API key chỉ tồn tại phía server local và không được gửi xuống trình duyệt.
- Server mặc định chỉ nghe tại `127.0.0.1`.

## Brand Commitments

Font tiếng Việt phải hiển thị đúng. Video dùng Be Vietnam Pro, chữ trắng, điểm nhấn vàng và nền footage tối. Giao diện web kế thừa ngôn ngữ thị giác này theo hướng công cụ làm việc rõ ràng.

## Evidence on Hand

- Pipeline đang chạy trong `src/`.
- Composition Remotion tại `remotion/video.jsx`.
- Nhạc nền local trong `public/`.
- Render mẫu tại `.tmp/smoke.mp4`.

## Product Principles

- Một luồng công việc từ chủ đề đến video.
- Số liệu và URL nguồn được lưu riêng cho từng video, đồng thời đưa vào caption.
- Trạng thái dài phải rõ và có khả năng phục hồi sau lỗi.
- API key và file local không rời khỏi máy.
- Các thao tác hằng ngày cần ít nhập liệu và ít chuyển màn hình.

