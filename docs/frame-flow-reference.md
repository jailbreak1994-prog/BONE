# Tham khảo ý tưởng: Frame Flow

> Tài liệu lưu ý tưởng để xây tính năng **Frame Flow** cho AI Video Studio.
> Nguồn: phần công khai của trang `aivideoauto.com/frame-flow` (xem ngày 30/09/2026, chưa đăng nhập)
> và ảnh chụp giao diện tab Image / Video của trang đó do chủ dự án gửi.
> Chỉ tham khảo **cách hoạt động và bố cục**. Không sao chép tên, logo, hình ảnh hay mã nguồn của họ.

---

## 1. Frame Flow là gì

Mô tả trên trang:

> "Từ một ý tưởng thành chuỗi cảnh, giọng đọc, chuyển động rồi video sẵn sàng đăng.
> Mở một cuộc trò chuyện để tiếp tục, hoặc tạo motion mới."

Quy trình 5 bước (ghi ngay trên trang):

```
Prompt → Cảnh AI → Giọng đọc → Code & Motion → Render
```

| Bước | Ý nghĩa |
|---|---|
| **Prompt** | Người dùng nhập ý tưởng |
| **Cảnh AI** | AI chia ý tưởng thành chuỗi cảnh |
| **Giọng đọc** | AI lồng tiếng từng cảnh |
| **Code & Motion** | AI **viết code hoạt hình**: chữ, logo, số liệu, icon chuyển động, hiệu ứng chuyển cảnh (motion graphics) |
| **Render** | Chuyển code hoạt hình + giọng đọc thành file video |

**Điểm khác biệt chính** so với Auto Video hiện có: video không chỉ là ảnh/clip AI ghép lại,
mà là **motion graphics do AI lập trình** – kiểu video quảng cáo, giải thích, giới thiệu sản phẩm.

## 2. Cách dùng: dạng trò chuyện

- Mỗi video là **một cuộc trò chuyện** ("Motion của bạn"), có nút **"Tạo motion mới"**.
- Người dùng chat để tạo, rồi **chat tiếp để sửa** (đổi màu, đổi chữ, chỉnh tốc độ cảnh…).
- Danh sách các motion đã làm được lưu lại để mở ra làm tiếp.
- Trang chủ Frame Flow có 2 mục: **HOME** và **STUDIO**.

## 3. Bốn mẫu gợi ý ("Bốn hướng kể chuyện")

| Mẫu | Nội dung chính |
|---|---|
| **Typography chuyển động** | Số liệu và tiêu đề đập nhịp |
| **Hero sản phẩm** | Card sản phẩm, slogan, logo |
| **Video giải thích** | Từng bước, icon, giọng đọc |
| **Câu chuyện thương hiệu** | Logo, slogan, nhạc hiệu |

## 4. Tham khảo bố cục các tab khác (từ ảnh chụp)

**Thanh menu trên:** Home, Explore, Image, Video, Audio, Music, …, Chat AI, Frame Flow, Auto Workflow, Bảng giá.

**Tab Image:**
- Chế độ: *Đơn* / *Auto Mode*; công tắc *Đa model*.
- Model (VD: GPT Image), Chế độ (Low…), Tỉ lệ (16:9…), Phân giải (1k…).
- Ảnh tham chiếu (tối đa 8), ô Mô tả, nút "Tạo Ảnh" kèm số credit.
- Bên phải: Mẫu, Hiện tại, Lịch sử, Thư viện, API; tìm kiếm, sắp xếp Mới/Cũ, thanh chỉnh cỡ lưới.

**Tab Video:**
- Chế độ: *Đơn* / *Multi* / *Auto*.
- Model (VD: Kling 3.0 Omni), Chế độ (Standard…), Tỉ lệ, Thời lượng (4s…).
- Hai kiểu đầu vào: *Từ Ảnh Frame* / *Từ Thành Phần*; ô Ảnh đầu / Ảnh cuối; công tắc *Multi-Shot*.
- Ô Kịch bản, nút "Tạo Video" kèm số credit.
- Bên phải: Phiên, Thư viện, API; Chọn tất cả.

## 5. So với AI Video Studio hiện tại

| Hạng mục | Hiện có | Còn thiếu |
|---|---|---|
| Prompt → chia cảnh | ✅ Auto Video (Claude/GPT/Gemini) | — |
| Giọng đọc | ✅ OpenAI TTS, ElevenLabs | — |
| Ảnh / video AI cho cảnh | ✅ | — |
| Tab Ảnh / Video / Giọng đọc + thư viện | ✅ | Chế độ Multi / Auto, chọn nhiều model cùng lúc, credit |
| **Code & Motion** | ❌ | AI viết code hoạt hình cho từng cảnh |
| **Render code → video** | ❌ | Trình duyệt ẩn "quay" hoạt hình → ffmpeg ghép với giọng đọc |
| **Chat để chỉnh sửa** | ❌ | Khung chat + xem trước trực tiếp |
| Danh sách "Motion của bạn" | ❌ | Lưu từng cuộc trò chuyện + phiên bản |

## 6. Phương án xây dựng đề xuất (chưa làm)

**Giao diện tab Frame Flow**
- Màn hình đầu: tiêu đề, nút "Tạo motion mới", 4 thẻ mẫu, danh sách "Motion của bạn".
- Màn hình làm việc: **bên trái khung chat**, **bên phải khung xem trước** (phát thử hoạt hình ngay trên
  trình duyệt) + danh sách cảnh (timeline) + nút **Render**.

**Luồng xử lý**
1. Người dùng nhập ý tưởng hoặc chọn mẫu → Claude lập kịch bản cảnh (lời đọc, thời lượng, bố cục, màu sắc).
2. Tạo giọng đọc từng cảnh → đo thời lượng thật để canh nhịp hoạt hình.
3. (Tuỳ chọn) tạo ảnh AI làm nền / ảnh sản phẩm cho cảnh.
4. Claude viết code hoạt hình cho mỗi cảnh (HTML/CSS + thư viện animation), trong khuôn mẫu cố định
   để code luôn chạy được; app kiểm tra lỗi, lỗi thì tự nhờ AI sửa.
5. Xem trước trong trình duyệt; người dùng chat để sửa → AI chỉ sửa cảnh liên quan, giữ lịch sử phiên bản.
6. **Render**: trình duyệt ẩn (Playwright/Chromium) chạy hoạt hình theo từng khung hình (30 fps),
   chụp lại → ffmpeg ghép thành mp4 kèm giọng đọc, nhạc nền, phụ đề.

**Cần chuẩn bị**
- **API key Claude** (console.anthropic.com) cho bước viết code hoạt hình – gói Claude Pro không dùng được.
- Key OpenAI hoặc ElevenLabs cho giọng đọc (đã có sẵn trong app).
- Trình duyệt ẩn cho bước render (~150MB, tự tải khi `npm install`).

**Thứ tự làm gợi ý**
1. Khuôn mẫu hoạt hình + render 1 cảnh ra mp4 (không cần AI) để chắc chắn phần render chạy.
2. Claude viết code cảnh theo 4 mẫu + ghép nhiều cảnh + giọng đọc.
3. Giao diện chat + xem trước + lưu "Motion của bạn".
4. Chat chỉnh sửa từng cảnh, lịch sử phiên bản.
5. Bổ sung: nhạc nền, phụ đề, logo/ảnh sản phẩm tải lên, xuất nhiều tỉ lệ.

## 7. Chưa biết (cần xem thêm khi có ảnh chụp bên trong)

- Giao diện bên trong một cuộc trò chuyện Frame Flow (cần đăng nhập mới thấy).
- Các tuỳ chọn khi render (tỉ lệ, độ phân giải, fps, nhạc).
- Chi phí credit cho mỗi motion.
