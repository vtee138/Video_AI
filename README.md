# AI Video Studio

## Lưu media trên Cloudflare R2

Ứng dụng hỗ trợ Cloudflare R2 qua API tương thích S3. Video mới được upload lên R2 ngay sau khi render và vẫn có thể xem, tải hoặc đăng từ Thư viện nếu bản local đã được dọn. Bucket có thể để private vì trình duyệt đọc video qua server ứng dụng.

Tạo một bucket và [API token R2](https://developers.cloudflare.com/r2/api/tokens/) có quyền **Object Read & Write** cho bucket đó. Điền các biến `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` trong `.env`, rồi đổi `MEDIA_STORAGE=r2`. Kiểm tra kết nối và đồng bộ toàn bộ video, ảnh, footage và âm thanh đang có:

```powershell
npm run storage:check
npm run storage:sync
```

Lệnh đồng bộ có thể chạy lại: object có cùng kích thước và thời điểm sửa sẽ được bỏ qua. Bản local được giữ nguyên. Nếu đã kiểm tra dữ liệu trên R2 và muốn giải phóng dung lượng của các MP4 thành phẩm trong `output/`, đặt `R2_ALLOW_REMOVE_LOCAL_AFTER_SYNC=true` rồi chạy `npm run storage:sync:move`. Lệnh này chỉ xóa file trong `output/`; media nguồn trong `public/`, `assets/` và `.tmp/` vẫn được giữ để render và khôi phục job.

**Chạy toàn bộ ứng dụng bằng Docker hoặc chuyển sang máy mới:** xem [DOCKER.md](DOCKER.md). Compose khởi động PostgreSQL, app và áp dụng migration tự động.

## Thử đồ với Google Flow

Mở `http://127.0.0.1:4173/flow` sau khi chạy `npm run web`. Tải ảnh trang phục, thêm và chọn background trong kho, tùy chọn ảnh người mẫu và clip hành động, rồi chọn 15, 20 hoặc 30 giây. App lưu job và file trong PostgreSQL cùng `assets/flow-tryon/`. Tạo ảnh và video trong Flow bằng trình duyệt thông thường đã đăng nhập, rồi nhập ảnh thử đồ và MP4 hoàn chỉnh vào job. App chuẩn hóa MP4 thành 1080 × 1920 bằng FFmpeg trên CPU local. Worker này không kết nối máy GPU hay Qwen.

Bấm **Mở Flow** để mở tab trong Edge/Chrome thông thường, nơi bạn đã đăng nhập tài khoản Google AI Pro. Trong mỗi job, tải ảnh tham chiếu và sao chép prompt do app chuẩn bị, tạo ảnh thử đồ trên Flow, tải về và bấm **Nhập ảnh thử đồ**. Tiếp theo tạo các đoạn video trên Flow, ghép bằng [Scenebuilder](https://support.google.com/labs/answer/16935718?hl=en), tải scene thành một MP4 dài ít nhất bằng thời lượng job rồi bấm **Nhập MP4 hoàn chỉnh**. App không nhận mật khẩu hay điều khiển trang đăng nhập Google. Google có thể chặn đăng nhập từ trình duyệt do phần mềm tự động điều khiển, nên luồng giao diện mặc định dùng trình duyệt thường.

Trang `/flow` nhận nhiều ảnh quần áo cho một đợt và dùng credit Flow trong Edge đã đăng nhập để tạo ảnh/video. Mặc định app chỉ tạo preview; sau khi xem MP4 có thể chọn tài khoản và đăng cả đợt, hoặc bật tự đăng ngay từ đầu. Cài hoặc tải lại tiện ích Edge theo [`flow-extension/README.md`](flow-extension/README.md) rồi chạy `npm run web`; server tự theo dõi file tải xuống từ Flow. Các thao tác dùng giao diện Flow nên cần thử một vòng với ảnh thật sau mỗi lần Flow thay đổi giao diện.

Flow dùng credit của tài khoản Google. Theo [bảng credit hiện tại của Google](https://support.google.com/flow/answer/16526234?hl=en), tài khoản nhận 50 credit hằng ngày; gói Google AI Pro có thêm 1.000 credit mỗi tháng. Veo 3.1 Lite dùng 10 credit mỗi đoạn; chỉnh video với Gemini Omni dùng 40 credit mỗi lần. App không tự mua credit. Kiểm tra số credit và giá hiện trên Flow trước khi chạy, vì Google có thể thay đổi chúng.

Local tool tạo video dọc bằng **Gemini qua OmniRouter hoặc Google AI Studio + Remotion**. Ranking dùng nguồn stock MP4 cùng dữ liệu có nguồn; Quote nguyên bản dùng một ảnh upload từ kho riêng, hook ngắn trên video và nội dung đầy đủ ở caption. Font tiếng Việt được đóng gói local. PostgreSQL lưu tiến độ job và trạng thái đăng của từng video.

## Chạy Node trực tiếp (tùy chọn)

Yêu cầu Node.js 22+, Docker Desktop, FFmpeg trong `PATH` (để tạo thumbnail Thư viện), Internet, key của nhà cung cấp AI đang chọn và ít nhất một key nguồn footage.

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Đặt `POSTGRES_PASSWORD` mạnh trong `.env`, rồi khởi động PostgreSQL và nhập các MP4 hiện có:

```powershell
docker compose up -d --wait postgres
npm run db:migrate
npm run db:seed
```

Lệnh trên chỉ mở PostgreSQL trên `127.0.0.1:5433`; dữ liệu nằm trong Docker volume `ai-video-studio_video_studio_pgdata`. `npm run web` yêu cầu PostgreSQL sẵn sàng. Lệnh seed có thể chạy lại mà không tạo bản ghi trùng. Khi chạy Node trên host, đặt `OMNIROUTER_GEMINI_BASE_URL=http://localhost:20128/v1beta` nếu OmniRouter cũng chạy trên host.

Đặt `AI_PROVIDER=omnirouter` và điền `OMNIROUTER_API_KEY`, `OMNIROUTER_GEMINI_BASE_URL` trong `.env`; địa chỉ mặc định của OmniRoute local là `http://localhost:20128/v1beta`. Ranking dùng `OMNIROUTER_SEARCH_MODEL` và `OMNIROUTER_MODEL` với `antigravity/gemini-3.7-flash-tiered`; Quote dùng `OMNIROUTER_QUOTE_MODEL` với cùng model để viết caption tự nhiên và đa dạng hơn. Ứng dụng gọi Chat Completions của OmniRoute, tạo truy vấn tìm kiếm rồi lấy kết quả qua `/v1/search`; nếu OmniRoute trả danh sách rỗng, ứng dụng dùng kết quả Bing công khai làm dự phòng. Có thể đổi sang Google AI Studio bằng `AI_PROVIDER=gemini`; các biến `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_SEARCH_MODEL`, `GEMINI_QUOTE_MODEL` được giữ riêng để có thể đổi lại. Điền thêm ít nhất một key footage (`PIXABAY_API_KEY` hoặc `COVERR_API_KEY`; `PEXELS_API_KEY` chỉ dùng được nếu đã có key từ trước). Nếu bước Ranking không xác nhận được lượt tìm kiếm web, workflow dừng. API key chỉ nằm ở server local. Đặt nhạc `.mp3`, `.wav` hoặc `.m4a` trong `public/`. Công cụ tạo 16 truy vấn footage cho Ranking, tìm ứng viên từ các API đã cấu hình và chờ duyệt trước khi tải clip gốc. Kết quả tìm kiếm stock được cache 24 giờ trong `.cache/stock/`.

Kiểm tra Remotion không cần API key: `npm run smoke`. Lệnh tạo `.tmp/smoke.png` và `.tmp/smoke.mp4` từ dữ liệu mẫu có ghi rõ là demo.

## Tạo video

### Giao diện web

Ứng dụng có năm trang: **Tổng quan** (`/`) để tiếp tục công việc, **Tạo video** (`/create`) với năm bước sản xuất, **Tự động hóa** (`/automation`) cho Auto mode và Super Auto, **Xuất bản** (`/publishing`) để đối chiếu trạng thái từng nền tảng, và **Thư viện** (`/library`) để tìm, lọc, xem, tải hoặc đăng video đã tạo. Mỗi bước tạo video cũng có URL riêng. Khi mở lại trực tiếp một bước của phiên chưa lưu trên trình duyệt, ứng dụng trở về bước Thiết lập; video hoàn tất vẫn có trong Thư viện.

Thư viện hiển thị thumbnail dọc được tạo và cache từ từng MP4, sắp xếp ba video mỗi hàng trên desktop. Nút **Thêm** của mỗi video chứa thao tác tải MP4, sao chép caption, đăng và cập nhật trạng thái.

Trong **Tổng quan → Phiên sản xuất**, mở một phiên rồi chọn **Xóa phiên** để xóa lịch sử và dữ liệu làm việc của phiên; các MP4 đã hoàn tất vẫn ở Thư viện. Trong **Thư viện → Thêm → Xóa video**, xóa riêng MP4, thumbnail, caption và lịch sử đăng local. Hai thao tác đều yêu cầu xác nhận và không xóa bài đã đăng trên các nền tảng. Phiên hoặc video đang xử lý, đang đăng hay còn lịch Super Auto chờ đăng không thể xóa.

```powershell
npm run web
```

Mở `http://127.0.0.1:4173`. Chọn Ranking hoặc Quote, nhập chủ đề, chọn nhiều ý tưởng rồi theo dõi hàng chờ. Quote tạo đúng 8 phương án, dài khoảng 30–40 giây theo nhạc được chọn. Chữ trên ảnh mở thẳng bằng “Đừng”, “Không”, một động từ mạnh hoặc “5 điều phải biết”; câu ngắn, sắc, không hỏi, xưng hô trực tiếp hay bịa số liệu. Caption gồm đúng 5 ý đánh số. Ranking dùng footage MP4; Quote dùng một ảnh từ kho riêng cho mỗi video. Mặc định hai video được chuẩn bị song song, nhưng Remotion chỉ render một video tại một thời điểm; một video lỗi không chặn video tiếp theo. Server chỉ nghe trên máy local; API key không được gửi xuống trình duyệt.

**Giới hạn song song:** `MAX_CONCURRENT_JOBS`, `MAX_CONCURRENT_RENDERS`, `MAX_CONCURRENT_DOWNLOADS` và `MAX_CONCURRENT_PUBLISHES` trong `.env` điều khiển từng nhóm tài nguyên. Mặc định `2 / 1 / 2 / 2`, phù hợp NucBox G3 Plus 8 GB: hai video có thể nghiên cứu hoặc tải footage đồng thời, còn render được khóa ở một lượt để tránh thiếu RAM và tranh CPU. Giá trị sai hoặc nhỏ hơn 1 tự trở về mặc định; server cũng đặt trần an toàn cho từng biến.

**Theo dõi phiên:** Trang **Tổng quan** hiển thị số phiên đang chạy và cần xử lý, nhóm video theo từng phiên, số video đã hoàn tất/đang chạy/chờ xử lý/lỗi/gián đoạn và tiến độ của từng video. Bảng tự cập nhật mỗi 10 giây từ PostgreSQL; phiên còn sống trên server có nút **Theo dõi hàng chờ**. Super Auto cũng hiện số bài đã gửi, đang tạo và chờ giờ đăng.

**Tạm dừng hàng chờ:** Trong bước **Hàng chờ**, bấm **Tạm dừng tiến trình** để ngăn nhận video tiếp theo. Nếu Remotion đang render, lượt render hiện tại được hủy an toàn và video được xếp lại để dựng từ đầu khi bấm **Tiếp tục hàng chờ**. Các bước nghiên cứu, tải footage hoặc đăng bài đang chạy sẽ hoàn tất trước khi hàng chờ dừng. Trạng thái tạm dừng xuất hiện trên trang Tổng quan. Nếu server khởi động lại, phiên chưa hoàn tất chuyển sang **Gián đoạn** và có thể khôi phục bằng **Retry · Tiếp tục phiên**.

**Auto mode:** Bật công tắc tại trang Tự động hóa, chọn nền tảng, tài khoản và quyền riêng tư rồi xác nhận đồng ý đăng tự động. Nhập chủ đề để tạo ý tưởng, sau đó **tự chọn video muốn đăng ở bước 2** và bấm **Bắt đầu tự động**. Chỉ những video đã chọn mới vào hàng chờ; từ đó hệ thống tự chọn footage phù hợp, tải clip, render và gửi từng video lên các nền tảng đã chọn, không chờ duyệt footage, video hoặc caption. Nếu không đủ clip, job dừng và báo lỗi để bạn chạy thủ công và bổ sung MP4. Kết quả hiển thị trạng thái đăng riêng cho từng nền tảng; có thể cập nhật trạng thái xử lý sau khi tải lên. Auto mode mặc định tắt.

**Super Auto:** Bật Auto mode, chọn nền tảng/tài khoản, rồi ở phần Super Auto chọn giờ đăng bài đầu tiên, khoảng cách tối thiểu giữa các bài (15 phút–7 ngày) và đồng ý cho hệ thống tự chọn chủ đề. Có thể nhập định hướng chủ đề hoặc để trống. Bấm **Bắt đầu Super Auto** để chạy liên tục cho đến khi bấm **Dừng Super Auto**. Hệ thống tìm chủ đề mới, tạo ý tưởng, chọn ý tưởng đầu, lấy footage và render trước; bài chỉ được gửi khi đến giờ. Sau mỗi lượt gửi, hệ thống chuẩn bị video kế tiếp và giữ khoảng cách tối thiểu tính từ lúc bắt đầu lượt gửi trước. Chiến dịch, lịch và trạng thái từng bài được lưu trong PostgreSQL; lịch tiếp tục sau khi khởi động lại server. Khi video lỗi vì thiếu clip phù hợp, nút **Bổ sung footage** mở đúng job ở bước Chọn footage để upload MP4 và tiếp tục render; nếu chiến dịch còn chạy, video trở lại lịch đăng ban đầu. Mỗi video lỗi vẫn có nút **Retry video** nếu chưa bắt đầu đăng; nút **Retry tất cả video lỗi** xếp lại toàn bộ video an toàn vào một hàng chờ bền vững và dùng đúng các nền tảng đang chọn. Retry giữ nguyên chủ đề và đưa video trở lại lịch an toàn. Video đã có lượt đăng không được Retry tự động để tránh đăng trùng. Nếu server dừng đúng lúc đang gửi bài, chiến dịch tạm dừng để bạn kiểm tra trên nền tảng rồi bấm **Đã kiểm tra, tiếp tục**. Sau ba lượt lỗi liên tiếp, chiến dịch cũng tạm dừng để bạn kiểm tra cấu hình. Windows Task Scheduler khởi chạy lại server khi đăng nhập; máy cần bật, đăng nhập và không ngủ để đăng đúng giờ. Quote tự chọn chủ đề bằng AI; Ranking tìm chủ đề bằng web search rồi kiểm tra số liệu khi tạo video.

Supervisor tách riêng stdout/stderr nên cảnh báo nguồn hoặc Remotion không làm server khởi động lại. Nếu máy hoặc tiến trình thật sự khởi động lại giữa lúc tạo video, Super Auto tự tiếp tục đúng lượt chưa đăng. Tải footage bị timeout hoặc mất kết nối tạm thời được thử lại tối đa 3 lần; nguồn trả HTTP 401/403 do chặn bot được ghi cảnh báo thay vì làm hỏng toàn bộ video. Với chiến dịch đã dừng, nút **Retry và chạy tiếp** vừa làm lại video lỗi vừa tiếp tục chiến dịch.

**Trạng thái đăng đã lưu:** Video mới bắt đầu ở **Chưa đăng**. Trang **Xuất bản** gom toàn bộ lượt đăng của mỗi MP4 thành một ma trận TikTok, Facebook Reels và YouTube Shorts; có tìm kiếm, lọc trạng thái và nút làm mới từ nền tảng. Một lượt đăng thành công cũ vẫn được giữ khi lượt sau gặp lỗi. Sau khi gửi lên nền tảng, giao diện phân biệt **Đang đăng**, **Đã đăng**, **Đã tải lên** (ví dụ YouTube riêng tư) và **Chưa đăng · lỗi**; từng nền tảng có trạng thái chi tiết và liên kết bài khi có. Các MP4 tồn tại trước khi cài PostgreSQL được seed ở **Chưa xác minh** vì không có lịch sử đăng đáng tin cậy. Tại **Thư viện**, đánh dấu **Đã đăng** hoặc **Chưa đăng** sau khi đối chiếu tài khoản. Job đang chạy khi server dừng được ghi **Gián đoạn**; hệ thống không tự gửi lại để tránh đăng trùng.

**Nhạc nền:** Mở **Kho nhạc** (`/music`) để thêm nhiều file MP3, WAV hoặc M4A, nghe thử, chỉnh trọng số 0–10 và xóa bài. Các file nằm trong `public/`; file trùng tên được thêm với hậu tố số. Trọng số mặc định là 1, trọng số 0 tạm ngừng dùng bài, trọng số càng cao thì bài càng dễ được chọn cho video mới. Khi có nhiều bài đang dùng, bộ chọn tránh lặp lại bài vừa phát. Trọng số được lưu tại `.tmp/music-library.json` và bài vừa chọn tại `.tmp/music-selection.json` qua lần khởi động lại server.

### Template Quote

- Giọng biên tập mặc định lạnh, sắc và thực dụng về lãnh đạo, quyền quyết định, chọn người, cắt lỗ, lợi ích và trách nhiệm; mỗi ý chỉ rõ hành động cùng cái giá của lựa chọn. Tránh nội dung chữa lành, nhân văn sách giáo khoa và khẩu hiệu chung chung. Chủ đề người dùng nhập vẫn là trọng tâm của cả 8 ý tưởng.
- Video mới dùng một hook khoảng 125–180 ký tự trong khối màu đỏ ở phần dưới ảnh, đủ nội dung để đọc khoảng 5 giây. Hook nêu tình huống và hệ quả bằng giọng đời thường; phần triển khai vẫn ở caption.
- Caption 550–1500 ký tự chứa đúng 5 ý đánh số, mỗi ý một đoạn riêng. Tùy chủ đề, bài viết theo dạng quy tắc ứng xử, phân tích trách nhiệm hoặc cặp ưu tiên “A > B”; có hành vi, tình huống, hệ quả cụ thể và câu chốt rõ. Video không hiện lời nhắc đọc caption.
- Quote không dùng web search hay API stock. Tải ảnh JPG, PNG hoặc WebP (tối đa 20 MB/ảnh) vào **Kho ảnh Quote**; ảnh được lưu trong `public/quote-images/` và dùng lại ở các phiên sau.
- Mỗi video Quote chọn ngẫu nhiên đúng một ảnh. Ở chế độ thủ công có thể đổi ảnh trước khi render; Auto mode tự dùng ảnh đã chọn. Nếu kho trống, hãy upload ảnh trước khi tạo video.
- Ảnh mở từ nền gần đen, hơi mờ và zoom nhẹ; trong khoảng một giây ảnh sáng và nét dần. Suốt video, ảnh trôi và zoom rất chậm dưới một vùng sáng mềm chuyển động nhẹ. Hook xuất hiện sau nhịp mở ảnh.
- Nhạc Quote được chọn khi chuẩn bị video. Nếu bản nhạc dài hơn 40 giây, hệ thống chọn điểm kết dịu trong khoảng 30–40 giây và fade âm thanh; nhạc 30–40 giây dùng gần trọn đoạn, nhạc ngắn hơn được lặp đến mốc 30 giây. Không có nhạc thì video dài 35 giây.

### CLI

```powershell
npm start -- "các quốc gia có GDP lớn nhất"
```

CLI dùng Gemini Google Search ngay khi đề xuất 6-8 ý tưởng, ưu tiên title dễ hiểu và kỳ dữ liệu mới nhất có thể tìm được. Dữ liệu cũ hơn vẫn được chấp nhận khi bảng đủ dòng, cùng metric/kỳ và có nguồn; năm và trạng thái thực tế/ước tính/dự báo vẫn hiển thị rõ. Sau khi chọn, CLI tìm dữ liệu trên web, kiểm tra cấu trúc và URL, rồi in top 10 để bạn xem lại. Gõ `yes` để viết story và tìm clip; sau đó nhập 8–20 số clip từ danh sách để tải và render. MP4 nằm trong `output/`. JSON nghiên cứu và URL footage nằm trong `.tmp/<run-id>/` để đối chiếu; `caption.txt` chỉ chứa nội dung đăng và hashtag. Nếu nguồn không truy cập được hoặc thiếu 10 item cùng metric/kỳ, run dừng và giữ `research.json`.

### Chuẩn bị bài đăng để tăng khả năng tiếp cận

- Video Ranking hiện bảng đầy đủ ngay từ khung đầu. Hook lấy từ số liệu đã kiểm tra nằm ở câu đầu caption; phần sau bổ sung bối cảnh và ghi đúng kỳ dữ liệu. Quote dạng caption cho người xem câu trả lời hoặc ý tiếp nối ngay ở câu đầu của caption. Nội dung trên video, tiêu đề và caption cần khớp nhau.
- Ở **Đăng video**, TikTok, Facebook Reels và YouTube Shorts có bản nháp riêng để sửa. Mỗi nền tảng dùng caption riêng khi đăng thủ công hoặc qua Auto/Super Auto. Hệ thống bỏ hashtag chung như `#fyp`, `#viral`, `#xuhuong` và giữ tối đa 5 tag cho TikTok, 3 tag cho Facebook/YouTube. Tag là mô tả chủ đề, không phải bảo đảm phân phối.
- Auto mode và Super Auto mặc định đăng **Công khai** trên YouTube; TikTok tự chọn **Công khai** khi Creator Info của tài khoản cho phép, nếu không thì yêu cầu chọn quyền hợp lệ. Facebook Reels đăng ở trạng thái `PUBLISHED`. Lựa chọn riêng tư bạn đã đặt rõ vẫn được giữ. Nhãn AI mặc định tắt cho footage stock + chữ; bật khi hình/âm thanh được AI tạo hoặc chỉnh sửa đáng kể. Trước khi gửi, kiểm tra tài khoản/kênh và nội dung có đúng nguồn. App TikTok chưa qua audit hoặc dự án YouTube chưa được xác minh vẫn có thể bị nền tảng giới hạn ở chế độ riêng tư.
- Sau khi đăng, theo dõi trạng thái xử lý trong Thư viện và xem Analytics từng nền tảng: tỷ lệ chọn xem, giữ chân ở vài giây đầu, thời gian xem và phản hồi của người xem. Dùng các chỉ số đó để sửa hook/chủ đề ở các video tiếp theo; không có giờ đăng, độ dài hay bộ hashtag cố định bảo đảm reach.

**Lưu ý về kiểm chứng:** Mở được URL không chứng minh số liệu đúng. Trước khi gõ `yes`, bạn cần đối chiếu giá trị, đơn vị và kỳ tại nguồn. Nội dung video chỉ hiển thị nhãn nguồn ngắn; danh sách URL đầy đủ có trong JSON kèm theo.

## Đăng TikTok (tùy chọn)

Bạn cần app TikTok Developer đã được duyệt quyền `video.publish`, người dùng đã cấp quyền OAuth qua Login Kit, và access token hợp lệ trong `TIKTOK_ACCESS_TOKEN`. Lệnh đăng sẽ hỏi caption, quyền riêng tư, tương tác và sự đồng ý cuối cùng. Có thể lấy caption từ `.tmp/<run-id>/caption.txt`:

```powershell
npm run post -- "output\ten-file-video.mp4"
```

TikTok giới hạn bài đăng của app chưa qua audit ở chế độ riêng tư. Lệnh chỉ báo video đã tải lên cùng `publish_id`; TikTok xử lý/xét duyệt sau đó. Không có tự động đăng ngay sau khi render.

## Đăng từ giao diện web

Ở chế độ thủ công, sau khi render, mở **Kết quả → Đăng video**. Chọn TikTok, Facebook Reels (Page) và/hoặc YouTube Shorts, sửa bản nháp tiêu đề/caption của từng nền tảng, chọn quyền riêng tư rồi xác nhận. Caption đăng chỉ gồm nội dung và hashtag, không kèm danh sách nguồn; dữ liệu nguồn vẫn nằm trong JSON nghiên cứu. Video được gửi khi bạn bấm **Đăng video**. Mỗi nền tảng được xử lý riêng; giao diện hiển thị lỗi hoặc ID bài đăng và có nút kiểm tra trạng thái xử lý.
Nếu đã khởi động lại server, tải lại trang rồi chọn MP4 trong **Thư viện** để mở lại biểu mẫu đăng.

**Qua Zernio (khuyên dùng):** điền `ZERNIO_API_KEY=sk_...` vào `.env` theo [.env.example](.env.example), rồi khởi động lại server. Với nền tảng chưa kết nối, bấm **Kết nối … qua Zernio** ngay trong ứng dụng; sau khi cấp quyền và chọn Facebook Page trên Zernio, trình duyệt quay lại ứng dụng và làm mới danh sách tài khoản. Giao diện lấy tài khoản và quyền riêng tư TikTok từ Zernio, upload MP4 qua URL tạm do Zernio cấp, sau đó đăng bằng `POST /v1/posts`. Chỉ các nền tảng đã kết nối mới có thể chọn. Nếu API key có nhiều hồ sơ mà không có hồ sơ mặc định, đặt `ZERNIO_PROFILE_ID`. Khóa Zernio không phải `TIKTOK_ACCESS_TOKEN`; biến đó dành riêng cho TikTok OAuth token của tích hợp trực tiếp.

**Tài khoản Zernio thứ hai:** đặt `ZERNIO_YOUTUBE_API_KEY=sk_...` trong `.env` để dùng kênh YouTube ở tài khoản đó. Ứng dụng cũng hiển thị các Facebook Page hoặc tài khoản TikTok được kết nối dưới key này cùng với tài khoản ở `ZERNIO_API_KEY`; khi đăng, ứng dụng dùng đúng key của tài khoản đã chọn cho cả upload và kiểm tra trạng thái. Nếu tài khoản Zernio thứ hai có nhiều hồ sơ mà không có hồ sơ mặc định, đặt thêm `ZERNIO_YOUTUBE_PROFILE_ID` để kết nối YouTube từ ứng dụng. Khởi động lại server rồi tải lại trang để cập nhật danh sách tài khoản.

**Qua API trực tiếp (tùy chọn):** Facebook dùng Meta Graph API trực tiếp khi có `FACEBOOK_PAGE_ACCESS_TOKEN` và chưa kết nối Facebook trong Zernio; khi đã kết nối Fanpage qua Zernio, ứng dụng ưu tiên tài khoản Zernio. TikTok và YouTube dùng API trực tiếp khi không cấu hình Zernio:

- **TikTok:** `TIKTOK_ACCESS_TOKEN` của tài khoản đã cấp scope `video.publish` cho app được duyệt Content Posting API. Quyền riêng tư và tùy chọn tương tác lấy trực tiếp từ Creator Info trước khi đăng. App chưa qua audit có thể bị giới hạn đăng riêng tư.

- Nếu ô quyền riêng tư TikTok trống, ứng dụng sẽ hiện lỗi kết nối ngay trong biểu mẫu và dừng trước khi gửi video. Với API trực tiếp, `TIKTOK_ACCESS_TOKEN` phải là user access token OAuth còn hiệu lực (scope `video.publish`). Với Zernio, kiểm tra `ZERNIO_API_KEY` và tài khoản đã kết nối. Sau khi sửa `.env`, khởi động lại server rồi bấm **Thử lại kết nối**.
- **Facebook Reels:** Lấy **Page Access Token** từ Meta Graph API Explorer bằng tài khoản có quyền tạo nội dung trên Page; chọn quyền `pages_show_list` và `pages_manage_posts`, sau đó lấy token của Page qua `GET /me/accounts`. Điền token đó vào `FACEBOOK_PAGE_ACCESS_TOKEN` trong `.env` rồi khởi động lại server. Mục **Webhooks → Page** trong Meta App Dashboard không cần cho việc đăng Reel. API đăng vào **Facebook Page**, không hỗ trợ profile cá nhân. Có thể đổi `FACEBOOK_GRAPH_VERSION` khi nâng phiên bản Graph API.
- **YouTube Shorts:** OAuth token có scope `youtube.upload`. Dùng `YOUTUBE_ACCESS_TOKEN` ngắn hạn, hoặc cấu hình `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` để server tự làm mới access token. Video 1080×1920, 30 giây của công cụ đáp ứng điều kiện định dạng Shorts; YouTube tự phân loại sau upload. Dự án API chưa được Google xác minh có thể chỉ đăng ở chế độ riêng tư.

API local: `GET /api/posts/config`, `GET /api/posts/tiktok/creator`, `POST /api/posts`, `GET /api/posts/{id}`. Thêm `?refresh=1` để hỏi trạng thái xử lý. Khi dùng Zernio, chọn `accountId` lấy từ `/api/posts/config` và gửi `consent: true` cho TikTok. Body mẫu:

```json
{
  "outputName": "ten-video.mp4",
  "consent": true,
  "targets": {
    "facebook": {"accountId": "id-page-zernio", "title": "Tiêu đề", "caption": "Mô tả", "state": "PUBLISHED"},
    "youtube": {"accountId": "id-kenh-zernio", "title": "Tiêu đề", "description": "Mô tả", "privacy": "private", "madeForKids": false},
    "tiktok": {"accountId": "id-tiktok-zernio", "caption": "Mô tả", "privacy": "PUBLIC_TO_EVERYONE", "allowComment": true, "allowDuet": false, "allowStitch": false, "isAigc": true}
  }
}
```

Tên file phải nằm trong `output/`. API trả `202` và mã lượt đăng; gọi GET để theo dõi. Lượt đăng hiện được giữ trong bộ nhớ của server, nên sau khi khởi động lại không thể xem lại mã lượt đăng cũ; bài đã gửi vẫn tồn tại trên nền tảng.

## Thành phần

- `src/cli.mjs`: workflow tuần tự.
- `src/server.mjs` và `web/`: server local cùng giao diện thao tác hằng ngày.
- `src/ai.mjs`: tạo Quote, brainstorm, web research và viết story với JSON schema.
- `src/facts.mjs`: kiểm tra/sắp xếp top 10.
- `src/stock.mjs`: tìm ứng viên Pixabay/Pexels/Coverr, tải clip đã chọn; `src/media.mjs`: chọn nhạc local.
- `remotion/`: composition Ranking và Quote.
- `src/tiktok.mjs`: đăng qua Direct Post với upload file local.

API: [Gemini Google Search](https://ai.google.dev/gemini-api/docs/google-search), [Pixabay video search](https://pixabay.com/api/docs/), [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [Facebook Reels Publishing (Meta)](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api), [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert).
Zernio: [TikTok creator info và đăng bài](https://docs.zernio.com/platforms/tiktok), [upload media](https://docs.zernio.com/guides/media-uploads), [API Quickstart](https://docs.zernio.com/).

## Duyệt footage

Ranking dừng ở trạng thái **Chọn footage** và cho phép chọn 8–20 clip. Nếu chưa đủ clip phù hợp, dùng **Thêm MP4 local** (tối đa 100 MB/file); clip này chỉ thuộc job hiện tại. Quote dừng ở bước chọn một ảnh từ kho riêng và có thể upload thêm ảnh ngay tại đó. Các job khác vẫn tiếp tục tới bước duyệt. API key luôn ở server local; trình duyệt chỉ nhận link xem trước qua proxy.

Ba nguồn có thể tìm tự động: [Pixabay](https://pixabay.com/api/docs/), [Pexels](https://www.pexels.com/api/documentation/) và [Coverr](https://api.coverr.co/docs/start/). Điền key tương ứng trong .env và khởi động lại server. Pexels đang tạm dừng cấp key mới; Coverr là tùy chọn; nếu chỉ có Pixabay, công cụ vẫn hiển thị mọi clip phù hợp để chọn. Xem [danh mục 32 nguồn footage](STOCK_SOURCES.md) để lấy clip thủ công hoặc cân nhắc tích hợp thêm.




