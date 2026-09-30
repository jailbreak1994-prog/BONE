# Tham khảo quy trình: Video Reel / quảng cáo UGC tiếng Thái (Insuna)

> Quy trình thủ công chủ dự án đang dùng (Video 3 và bộ video quảng cáo), lưu lại để tham khảo
> khi đưa vào AI Video Studio. **Mỗi bước đều dừng lại chờ duyệt** trước khi sang bước sau.

---

## Bước 1 — Chốt ý tưởng và kịch bản

- Dạng video: **mở hộp**, **lối sống**, **thảo dược**, hoặc **quảng cáo có hook**.
- Độ dài: **Reel đăng Page 20–25 giây**, **quảng cáo 23–28 giây**.
- Bảng cảnh gồm: thời gian từng cảnh · lời đọc **tiếng Thái kèm nghĩa tiếng Việt** · hình ảnh từng cảnh ·
  có / không có chữ trên màn hình.
- **Lời đọc không được nói chữa bệnh hay giảm đường huyết.**
- 👉 Duyệt kịch bản.

## Bước 2 — Ảnh khung cho các cảnh có sản phẩm (không tốn credit)

- Tạo bằng **Nano Banana 2** trên Flow, **luôn kèm ảnh tham chiếu thật**:
  - `tham-chieu-1-hop-va-chai-khong-fujina.png` → hộp và lọ
  - `tham-chieu-6-vien-uong.png` → viên nâu
- 5 quy tắc kiểm tra:
  1. Chỉ ghi **"Insuna"**, không có FUJINA.
  2. Nhân vật là **người Thái**, thấy rõ mặt.
  3. Đúng tỷ lệ: hộp **5,5×5,5×10,5 cm**, lọ thấp hơn hộp, ly nước cao hơn hộp.
  4. Viên uống **tròn dẹt, màu nâu xám có đốm**.
  5. Cảnh sản phẩm **khác hẳn** mọi ảnh/video đã đăng.

## Bước 3 — Clip chuyển động (Veo 3.1 Lite, 10 credit / clip 8 giây)

- **Mọi cảnh đều là video có chuyển động** (VD: cầm hộp → mở nắp → đổ viên ra tay). Riêng **end card là ảnh tĩnh**.
- Cảnh có sản phẩm: chế độ **Khung hình** – ảnh bước 2 làm khung bắt đầu, có thể thêm khung kết thúc.
- Cảnh không có sản phẩm (hook, gia đình ăn cơm…): tạo từ prompt.
- Tải clip về, **soát từng khung hình**, ghi chú lỗi (nhãn biến dạng, vật thể bay, nắp méo…).
- 👉 Xem ảnh tổng hợp các clip → chọn: dùng luôn / cắt bỏ đoạn lỗi / tạo lại.

## Bước 4 — Giọng đọc (MiniMax v2.8 HD, giọng "Gentle Woman", qua aivideoauto)

- Viết **toàn bộ bằng chữ Thái**, không chữ Latin, không chữ số
  (VD: Insuna → อินซูน่า, 120 → หนึ่งร้อยยี่สิบ) để máy không đọc lẫn.
- Chi phí ~0,5 credit / ký tự (~100–260 credit / video).
- 👉 Nghe duyệt giọng đọc trước khi ghép.

## Bước 5 — Ghép video

- Khung **1080×1920, 30 fps**.
- Mỗi câu giọng đọc đặt vào **đầu cảnh tương ứng**.
- **Nhạc nền nhỏ lại khi có giọng đọc** (ducking).
- **End card Insuna 2,5–3 giây.**
- Chữ trên màn hình chỉ thêm khi muốn; **tránh 14% phía trên và 35% phía dưới** khung hình.
- 👉 Xem video hoàn chỉnh.

## Bước 6 — Lưu và đăng

- Lưu vào `D:\HÀNG THÁI\video\...`.
- Caption tiếng Thái, **luôn kết bằng dòng ⚠️ ผลิตภัณฑ์เสริมอาหาร…** → duyệt caption.
- Page → Thước phim → chọn file → dán caption → đăng ngay hoặc hẹn giờ → kiểm tra bài đã lên.

## Chi phí & thời gian mỗi video

- Flow: ~40–80 credit (4–8 clip) · Giọng đọc: ~100–260 credit · Thời gian: ~1–2 giờ.

---

## Đối chiếu với AI Video Studio

| Bước | App đã có | Có thể làm thêm |
|---|---|---|
| 1. Kịch bản | Auto Video viết kịch bản chia cảnh, chọn ngôn ngữ | Mẫu "Insuna UGC": 4 dạng video, độ dài Reel/Quảng cáo, bảng cảnh Thái + nghĩa Việt, cờ chữ trên màn hình, **bộ lọc từ ngữ cấm** (chữa bệnh, giảm đường huyết…), **dừng chờ duyệt** |
| 2. Ảnh khung | Tab Ảnh: Nano Banana + tối đa 8 ảnh tham chiếu | **Bộ ảnh tham chiếu cố định** của sản phẩm (tự đính kèm), checklist 5 quy tắc hiện cạnh ảnh để duyệt |
| 3. Clip | Tab Video: Veo với ảnh đầu / ảnh cuối | Tạo hàng loạt theo bảng cảnh, **ảnh tổng hợp khung hình** để soát lỗi, nút *dùng / cắt đoạn / tạo lại* cho từng clip |
| 4. Giọng đọc | OpenAI TTS, ElevenLabs | Thêm **MiniMax TTS** (gọi API trực tiếp); **tự chuyển số và chữ Latin sang chữ Thái** trước khi đọc; nghe duyệt từng câu |
| 5. Ghép | ffmpeg ghép cảnh + giọng + phụ đề + nhạc nền | Xuất **1080×1920**, **ducking** nhạc nền, đặt giọng đọc đầu cảnh, **end card** ảnh tĩnh 2,5–3 giây, chữ trên màn hình trong **vùng an toàn** |
| 6. Đăng | — | Soạn **caption tiếng Thái kèm dòng cảnh báo bắt buộc**; lưu vào thư mục chọn sẵn |

## Lưu ý khi đưa vào app

- **Nhãn AI và watermark:** app sẽ **không** làm tính năng cắt bỏ watermark của Flow hay hướng dẫn tắt
  "Thêm nhãn AI" khi đăng. Nội dung có người thật do AI tạo, dùng cho **quảng cáo thực phẩm bổ sung**, thường
  bắt buộc phải công khai là AI theo chính sách của Meta và quy định quảng cáo. Gỡ nhãn có thể khiến bài bị gỡ
  hoặc tài khoản quảng cáo bị hạn chế. Nên để nguyên nhãn AI, và dùng clip không watermark nếu dịch vụ tạo video cho phép.
- **Tuân thủ nội dung sức khoẻ:** giữ quy tắc không nói chữa bệnh / giảm đường huyết và dòng
  ⚠️ ผลิตภัณฑ์เสริมอาหาร… trong caption; app có thể kiểm tra tự động nhưng người duyệt vẫn chịu trách nhiệm cuối.
