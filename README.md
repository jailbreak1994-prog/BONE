# 🎬 AI Video Studio

App tạo video **tự động bằng AI**: chỉ cần nhập chủ đề, app sẽ gọi API của các model AI để

1. **Viết kịch bản** chia cảnh — Claude (Anthropic), GPT (OpenAI) hoặc Gemini (Google)
2. **Tạo hình ảnh** cho từng cảnh — OpenAI gpt-image, Replicate (FLUX…), Google Imagen
3. **Tạo video clip** (tuỳ chọn) — Runway Gen-4, Google Veo, Luma Dream Machine, Replicate (Kling/Hailuo/Wan…)
4. **Lồng tiếng** — OpenAI TTS hoặc ElevenLabs (hỗ trợ tiếng Việt)
5. **Dựng & ghép video** bằng ffmpeg — hiệu ứng chuyển động Ken Burns, khớp thời lượng giọng đọc, phụ đề SRT, nhạc nền

Kết quả: file `video.mp4` (9:16 cho TikTok/Reels/Shorts, 16:9 cho YouTube, hoặc 1:1) + `subtitles.srt` + `script.json`.

```
Chủ đề ──► LLM ──► kịch bản (N cảnh: lời đọc + prompt hình ảnh)
                        │
          ┌─────────────┼─────────────┐   (song song từng cảnh)
          ▼             ▼             ▼
   Ảnh AI / Video AI    TTS giọng đọc
          └──────┬──────┘
                 ▼
     ffmpeg: dựng cảnh ► ghép ► phụ đề ► nhạc nền ► video.mp4
```

## Cài đặt

Yêu cầu **Node.js 22+**. ffmpeg được cài kèm tự động qua gói `ffmpeg-static`.

```bash
npm install
cp .env.example .env      # điền API key của dịch vụ bạn muốn dùng
npm start                 # mở http://localhost:3000
```

Chưa có key nào? Chọn các provider **Mock** trên giao diện để chạy thử toàn bộ quy trình miễn phí
(ra video ảnh màu + im lặng, dùng để kiểm tra cài đặt).

### Chạy bằng Docker

```bash
docker build -t ai-video-studio .
docker run -p 3000:3000 --env-file .env -v "$PWD/output:/app/output" ai-video-studio
```

### Dùng dòng lệnh (không cần giao diện)

```bash
npm run cli -- --topic "5 sự thật thú vị về cà phê Việt Nam" \
  --scenes 5 --duration 40 --aspect 9:16 \
  --llm anthropic --image openai --tts elevenlabs
# Video clip AI thay cho ảnh tĩnh:
npm run cli -- --topic "Hành trình hạt cà phê" --mode video --video runway --image openai --tts openai
```

## Bảng provider & API key

| Bước | Provider (id) | Biến môi trường |
|---|---|---|
| Kịch bản | Claude `anthropic` (mặc định `claude-opus-5-5`) | `ANTHROPIC_API_KEY` |
| | OpenAI `openai` | `OPENAI_API_KEY` |
| | Gemini `gemini` | `GEMINI_API_KEY` |
| Ảnh | OpenAI gpt-image `openai` | `OPENAI_API_KEY` |
| | Replicate FLUX `replicate` | `REPLICATE_API_TOKEN` |
| | Google Imagen `gemini` | `GEMINI_API_KEY` |
| Video | Runway Gen-4 `runway` (ảnh → video) | `RUNWAY_API_KEY` |
| | Google Veo `veo` | `GEMINI_API_KEY` |
| | Luma Dream Machine `luma` (text → video) | `LUMA_API_KEY` |
| | Replicate `replicate` (Kling, Hailuo, Wan…) | `REPLICATE_API_TOKEN` |
| Giọng đọc | OpenAI TTS `openai` | `OPENAI_API_KEY` |
| | ElevenLabs `elevenlabs` | `ELEVENLABS_API_KEY` |

Tên model của từng dịch vụ đều đổi được qua biến môi trường (xem `.env.example`) — các nhà cung cấp
ra model mới liên tục nên bạn chỉ cần đổi tên model, không phải sửa code.

**Chế độ video:** với provider hỗ trợ ảnh đầu vào (Runway, Veo, Replicate), app tạo ảnh trước rồi
dùng ảnh đó làm khung hình đầu cho video → nhân vật/phong cách nhất quán hơn. Nếu tạo video cho
một cảnh bị lỗi, app tự động dùng ảnh tĩnh của cảnh đó thay vì hỏng cả video.

## Cấu trúc mã nguồn

```
src/
  server.js          HTTP server + REST API + phục vụ giao diện & file output
  cli.js             chạy pipeline từ dòng lệnh
  pipeline.js        điều phối các bước, hàng đợi job, tạo phụ đề SRT
  ffmpeg.js          dựng cảnh (Ken Burns / clip), ghép, trộn nhạc nền
  util.js            fetch, poll task bất đồng bộ, giới hạn song song
  providers/
    llm.js           Claude / OpenAI / Gemini / mock
    image.js         gpt-image / Replicate / Imagen / mock
    video.js         Runway / Veo / Luma / Replicate
    tts.js           OpenAI TTS / ElevenLabs / mock
public/              giao diện web (HTML/CSS/JS thuần)
output/<job-id>/     kết quả từng video
```

### Thêm model AI mới

Mỗi file trong `src/providers/` có một bảng đăng ký (`LLM_PROVIDERS`, `IMAGE_PROVIDERS`, …).
Thêm một hàm `async ({ prompt, aspect, dest, … }) => dest` và một dòng trong bảng — giao diện tự
hiển thị provider mới.

## REST API

| Method | Đường dẫn | Mô tả |
|---|---|---|
| `GET` | `/api/providers` | Danh sách provider và trạng thái API key |
| `POST` | `/api/jobs` | Tạo video. Body: `{ topic, language, durationSec, sceneCount, aspect, style, visualMode, llm, image, video, tts, voice, subtitles }` |
| `GET` | `/api/jobs` | Danh sách job |
| `GET` | `/api/jobs/:id` | Trạng thái, tiến độ, nhật ký, kịch bản, link kết quả |

## Lưu ý

- **Chi phí:** mỗi video gọi nhiều API trả phí (1 lần LLM + N ảnh/video + N lần TTS). Video clip AI đắt
  và chậm hơn ảnh nhiều — hãy thử với ít cảnh trước.
- **Bảo mật:** API key chỉ nằm ở server (file `.env`), không gửi xuống trình duyệt. Server mặc định chỉ
  nghe trên `127.0.0.1`; nếu mở ra Internet hãy đặt sau reverse proxy có đăng nhập.
- Job được giữ trong bộ nhớ — khởi động lại server sẽ mất lịch sử trên giao diện (file trong `output/` vẫn còn).
