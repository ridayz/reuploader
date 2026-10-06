# Reuploader

Link panjang → kompilasi momen 10–15 menit. Siap upload.

- **Jalur momen**: analisis via Cheat Clip (`/api/analyze` + heatmap + custom mood focus),
  ambil momen skor tertinggi sampai total 10–15 menit, gabung + subtitle Whisper.
- **Jalur langsung**: video ≤90 dtk → render vertikal + bumper + subtitle.
- Output: MP4 + judul + caption + hashtag, tombol buka halaman upload (YT/TikTok/FB).

## Jalan lokal

Butuh: Cheat Clip API (`:8000`), 9Router (`:20128`), ffmpeg, Python (faster-whisper).

```powershell
# backend :8001
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
# frontend :5174
cd frontend; npm install; npm run dev
```

Lihat `../PORTS.md` untuk peta port. API key agen diisi di UI (tidak disimpan di repo).
