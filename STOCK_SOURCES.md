# 32 nguồn footage: API và cách truy cập

Cập nhật 06/10/2026. **Có API** khác với **có thể lấy key mới** và **API cho phép tải clip gốc**. Chỉ tích hợp tự động khi đã xác minh đủ ba điều kiện. Kiểm tra giấy phép của từng clip trước khi dùng trong video.

## Đã tích hợp

| # | Nguồn | Tình trạng |
|---|---|---|
| 1 | [Pixabay](https://pixabay.com/api/docs/) | API tìm và tải video; đang có key trong máy |
| 2 | [Pexels](https://www.pexels.com/api/documentation/) | Có API video, adapter hỗ trợ key đã cấp; [đang tạm dừng cấp key mới](https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key) |
| 3 | [Coverr](https://api.coverr.co/docs/start/) | API tìm và tải video; cần tạo key |

## Có API chính thức, chưa tích hợp

| # | Nguồn | Tình trạng |
|---|---|---|
| 4 | [Vecteezy](https://www.vecteezy.com/developers) | API tìm và tải video; có gói Free cho nội dung Free, điều khoản giấy phép riêng |
| 5 | [Magnific/Freepik](https://docs.magnific.com/api-reference/videos/videos-api) | API stock video hiện hành với tìm kiếm và download; cần key và kiểm tra giá/giấy phép |
| 6 | [Shutterstock](https://www.shutterstock.com/developers/documentation/searching) | API video thương mại, cần quyền cấp phép |
| 7 | [Adobe Stock](https://developer.adobe.com/stock/docs/api/11-search-reference/) | API tìm video; tải bản gốc cần giấy phép |
| 8 | [Pond5](https://www.pond5.com/api) | API đối tác cho stock video |
| 9 | [Storyblocks](https://www.storyblocks.com/resources/business-solutions/api) | API doanh nghiệp/đối tác |
| 10 | [Getty Images](https://github.com/gettyimages/gettyimages-api_nodejs) | API tìm và cấp phép video |
| 11 | [Videvo](https://www.videvo.net/blog/announcing-the-new-api/) | Đã công bố API năm 2021 để hiện gallery và đưa người dùng tới trang tải; [trang API hiện chuyển sang Magnific](https://www.videvo.net/api/). Chưa xác minh được endpoint Videvo cũ còn hoạt động hay có tải MP4 trực tiếp. |

## Chưa tìm thấy API công khai phù hợp

Các kho sau vẫn có thể dùng qua **Thêm MP4 local** sau khi tải clip theo điều khoản của họ. “Chưa tìm thấy” không khẳng định họ không có API nội bộ hoặc chương trình đối tác riêng.

| # | Nguồn | # | Nguồn |
|---|---|---|---|
| 12 | [Mixkit](https://mixkit.co/free-stock-video/) | 13 | [Life of Vids](https://www.lifeofvids.com/) |
| 14 | [Videezy](https://www.videezy.com/) | 15 | [Dareful](https://dareful.com/) |
| 16 | [Vidsplay](https://www.vidsplay.com/) | 17 | [Mazwai](https://mazwai.com/) |
| 18 | [Splitshire](https://www.splitshire.com/) | 19 | [Motion Places](https://www.motionplaces.com/) |
| 20 | [Clipstill](https://clipstill.com/) | 21 | [Free Nature Stock](https://freenaturestock.com/) |
| 22 | [MotionElements](https://www.motionelements.com/) | 23 | [Envato Elements](https://elements.envato.com/stock-video) |
| 24 | [Artgrid](https://artgrid.io/) | 25 | [Motion Array](https://motionarray.com/browse/stock-video/) |
| 26 | [Depositphotos](https://depositphotos.com/stock-videos.html) | 27 | [Dreamstime](https://www.dreamstime.com/stock-video-footage) |
| 28 | [123RF](https://www.123rf.com/stock-footage/) | 29 | [Alamy](https://www.alamy.com/stock-video/) |
| 30 | [Filmsupply](https://www.filmsupply.com/) | 31 | [Dissolve](https://dissolve.com/) |
| 32 | [Freepik Videos](https://www.freepik.com/videos) | | |

**Ưu tiên tiếp theo:** Coverr nếu muốn thêm nguồn ngay; Vecteezy sau khi có key và kiểm tra điều kiện Free. Mixkit và Life of Vids phù hợp với đường tải thủ công. Videvo cần xác nhận với nhà cung cấp về quyền API hiện hành trước khi viết adapter.
