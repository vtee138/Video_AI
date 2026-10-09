# Chạy AI Video Studio trên máy mới

Nếu dùng Cloudflare R2, điền nhóm biến `MEDIA_STORAGE` và `R2_*` trong `.env` trước khi build lại container. Có thể kiểm tra và đồng bộ media bằng `docker compose run --rm app npm run storage:check` và `docker compose run --rm app npm run storage:sync`.

Yêu cầu Docker Desktop (hoặc Docker Engine + Compose), Internet và các API key cần dùng. Container gồm Node.js, Chromium cho Remotion, FFmpeg và PostgreSQL. Giao diện chỉ mở trên máy này tại `http://127.0.0.1:4173`.

## Cài mới

1. Chép thư mục dự án sang máy mới. Có thể bỏ `node_modules`, `.cache` và các file video cũ nếu không cần lịch sử. Giữ `public/`, `assets/`, `output/` và `.tmp/` nếu muốn giữ dữ liệu cũ.
2. Tạo `.env` từ `.env.example`. Đặt `POSTGRES_PASSWORD` đủ mạnh; điền AI key, footage key và các token đăng bài theo nhu cầu. Nếu URL OmniRouter cũ là `localhost` hoặc `127.0.0.1`, app trong Docker tự đổi sang `host.docker.internal`. Dịch vụ OmniRouter trên host cần nhận được kết nối từ Docker; nếu không, dùng một địa chỉ dịch vụ mà container truy cập được.
3. Chạy tại thư mục dự án:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build --wait
docker compose logs --tail=50 app
```

Mở `http://127.0.0.1:4173`. Migration chạy tự động trước khi server nhận kết nối; video MP4 có sẵn trong `output/` được nhập vào thư viện khi server khởi động. Có thể chạy migration riêng bằng `docker compose run --rm app node src/migrate.mjs` hoặc, khi dùng Node trên host, `npm run db:migrate`.

Compose gắn `output/`, `.tmp/`, `.cache/`, `public/` và `assets/` vào host để giữ cả media đã tải lên. PostgreSQL ở volume `ai-video-studio_video_studio_pgdata`.

## Chuyển dữ liệu PostgreSQL từ máy cũ

Trên máy cũ, dừng app để không có job đang ghi, rồi tạo bản sao lưu:

```powershell
docker compose stop app
docker compose exec -T postgres pg_dump -U video_studio -d video_studio -Fc -f /tmp/video-studio.dump
docker compose cp postgres:/tmp/video-studio.dump ./video-studio.dump
```

Chép `video-studio.dump`, `.env`, `output/`, `public/`, `assets/` và `.tmp/` cùng mã nguồn sang máy mới. Không chép `node_modules`. Nếu bạn đổi `POSTGRES_USER` hoặc `POSTGRES_DB`, thay `video_studio` trong lệnh tương ứng. Trên máy mới, trong thư mục dự án:

```powershell
docker compose up -d --wait postgres
docker compose cp ./video-studio.dump postgres:/tmp/video-studio.dump
docker compose exec -T postgres pg_restore -U video_studio -d video_studio --clean --if-exists --no-owner /tmp/video-studio.dump
docker compose up -d --build --wait app
```

Khôi phục vào database mới, trống. Nếu đã chạy app trên máy mới và có dữ liệu cần giữ, sao lưu database đó trước khi dùng `pg_restore --clean`. Mật khẩu PostgreSQL trong `.env` của máy mới phải phù hợp với volume đang dùng; đổi `.env` sau khi volume đã khởi tạo không tự đổi mật khẩu trong PostgreSQL.

## Google Flow trên Windows

Tiện ích Edge gọi `127.0.0.1:4173` trên máy Windows và vẫn dùng được với Compose. Đặt `FLOW_DOWNLOAD_HOST_DIR` trong `.env` thành thư mục `Downloads/flow-tryon` của Edge, ví dụ `C:/Users/<user>/Downloads/flow-tryon`, rồi chạy `docker compose up -d --force-recreate app`. Nếu không đặt, watcher theo dõi `.downloads/flow-tryon` trong dự án; hãy đổi thư mục tải xuống của Edge thành `.downloads` để tiện ích ghi vào đó.

Chức năng tự mở cửa sổ Chrome bằng Playwright cần desktop Windows và không chạy trong container không có màn hình. Dùng tiện ích Edge hoặc thao tác Flow thủ công rồi nhập file qua giao diện.

## Kiểm tra và vận hành

```powershell
docker compose ps
docker compose logs -f app
docker compose exec -T postgres psql -U video_studio -d video_studio -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
docker compose down
```

`docker compose down` giữ nguyên volume PostgreSQL và các thư mục media. Đừng dùng `down -v` nếu muốn giữ dữ liệu. Các lần cập nhật mã nguồn: chạy `docker compose up -d --build --wait` để dựng lại app và áp dụng migration mới.
