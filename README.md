# AI Story Studio — Complete Full-Stack Starter

## What is included
- Responsive web application
- Demo authentication using JWT
- SQLite database
- Projects and scenes persisted on disk
- Script → scene breakdown
- 30-minute project workflow
- Async generation job API with progress
- Provider adapter architecture for LLM, image, video, TTS and music
- Provider configuration status endpoint
- Secure server-side `.env` secrets pattern
- Media upload endpoint
- FFmpeg availability/render hook
- Timeline/editor UI
- Project management UI
- Mobile responsive UI

## Run
Requirements: Node.js 18+ and FFmpeg for final media rendering.

1. Extract ZIP.
2. Copy `.env.example` to `.env`.
3. Change `JWT_SECRET`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Real AI integration
The project intentionally does not pretend to generate AI media without a provider. Add provider SDK/API calls inside the adapter section in `src/server.js` and store keys only in `.env`.

Recommended production additions:
- PostgreSQL instead of SQLite for multi-user scale
- S3/R2/GCS media storage
- Redis + BullMQ (or equivalent) for generation jobs
- Dedicated workers for AI generation and FFmpeg
- Real OAuth/Google authentication
- Signed URLs and virus/file scanning
- Usage/credit ledger
- WebSocket/SSE job updates
- CDN
- Provider retry/fallback strategy

## 30-minute rendering architecture
Never ask one AI video request to create a 30-minute movie. The app is designed for:
script → scenes → per-scene assets → narration → music/SFX → subtitles → FFmpeg assembly → MP4.

If a scene fails, regenerate that scene only.


## OpenRouter integration
The server includes a secure `/api/ai/script` endpoint for OpenRouter.
Set these values in `.env`:

OPENROUTER_API_KEY=your_new_key
OPENROUTER_MODEL=your_supported_model

Never put the key in `public/` or frontend JavaScript. The key you previously
posted in chat should be revoked and must not be reused.

OpenRouter is used here for LLM/script/scene planning. Image, video, TTS and
music still require compatible providers and their own server-side credentials.
