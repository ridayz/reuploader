#!/usr/bin/env python3
"""Reuploader: momen compilation + direct Shorts reupload (stdlib + fastapi + requests)."""
import json
import math
import os
import re
import subprocess
import threading
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Reuploader")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(BASE, "work")
os.makedirs(WORK, exist_ok=True)
CHEAT = os.environ.get("CHEAT_URL", "http://127.0.0.1:8000")

_jobs: Dict[str, Any] = {}


class CompileRequest(BaseModel):
    url: str
    moods: List[str] = Field(default_factory=lambda: ["lucu", "marah"])
    min_score: int = 70
    oai_base_url: str = ""
    oai_api_key: str = ""
    oai_model: str = ""


def _vid(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{6,})", url or "")
    return m.group(1) if m else "video"


def _srt_time(t: float) -> str:
    t = max(0.0, t)
    h, r = divmod(int(t), 3600)
    m, s = divmod(r, 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _prog(jid, pct, stage, **kw):
    d = {"pct": pct, "stage": stage, "done": False}
    d.update(kw)
    _jobs[jid] = d


def _analyze(url: str, mood_focus: str, oai: dict):
    import requests as _rq
    body = {"url": url, "duration": "60s",
            "custom_prompt": ("Fokus HANYA momen: " + mood_focus +
                              ". Abaikan momen lain sebagus apa pun."),
            "target_clip_count": 30,
            "oai_base_url": oai.get("base_url", ""),
            "oai_api_key": oai.get("api_key", ""),
            "oai_model": oai.get("model", "")}
    r = _rq.post(CHEAT + "/api/analyze", json=body, timeout=900)
    r.raise_for_status()
    last = None
    for line in r.text.split("\n"):
        if line.startswith("data:"):
            try:
                last = json.loads(line[5:])
            except Exception:
                pass
    if not last or "result" not in last:
        raise RuntimeError("analyze gagal: " + r.text[-300:])
    return last["result"]


def _dl_full(url: str, vid: str) -> str:
    out = os.path.join(WORK, f"{vid}_full.%(ext)s")
    if not any(f.startswith(vid + "_full.") for f in os.listdir(WORK)):
        subprocess.run([os.environ.get("PY", "python"), "-m", "yt_dlp",
                        "-f", "bv*[height<=720]+ba/b[height<=720]/b",
                        "--merge-output-format", "mp4", "-o", out, url],
                       check=True, timeout=1800,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cands = [f for f in os.listdir(WORK) if f.startswith(vid + "_full.")]
    return os.path.join(WORK, cands[0])


def _sub_ass(path: str, words, s: float, e: float, transcript: str = "") -> bool:
    if not words and transcript:
        ws = transcript.split()
        dur = max(1.0, e - s)
        per, evts = 8, []
        for i in range(0, len(ws), per):
            t0 = s + i / max(1, len(ws)) * dur
            t1 = s + min(len(ws), i + per) / max(1, len(ws)) * dur
            evts.append((t0, t1, " ".join(ws[i:i + per])))
    elif words:
        evts = []
        buf = []
        for i in range(0, len(words), 8):
            ch = words[i:i + 8]
            evts.append((ch[0][0] + s, ch[-1][1] + s, " ".join(w[2] for w in ch)))
    else:
        return False
    head = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n"
            "ScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, "
            "PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
            "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Default,Arial,44,&H00FFFFFF,&H000019FF,&H80000000,&H00000000,0,0,0,0,"
            "100,100,0,0,1,2,0,2,40,40,60,1\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

    def at(t):
        t = max(0.0, t)
        h, r = divmod(int(t), 3600)
        m, sec = divmod(r, 60)
        return f"{h}:{m:02d}:{sec:02d}.{int(round((t - int(t)) * 100)):02d}"

    with open(path, "w", encoding="utf-8") as f:
        f.write(head)
        for t0, t1, ln in evts:
            f.write(f"Dialogue: 0,{at(t0)},{at(min(t1, e))},Default,,0,0,0,,{ln}\n")
    return True


def _whisper_words(wav: str):
    try:
        import wave
        import numpy as _np
        from faster_whisper import WhisperModel
        global _wm
        try:
            _wm
        except NameError:
            _wm = None
        if _wm is None:
            _wm = WhisperModel("small", device="cpu", compute_type="int8")
        with wave.open(wav, "rb") as w:
            audio = _np.frombuffer(w.readframes(w.getnframes()), dtype=_np.int16).astype(_np.float32) / 32768.0
        segs, _ = _wm.transcribe(audio, word_timestamps=True)
        out = []
        for sg in segs:
            for w in (sg.words or []):
                if w.word.strip():
                    out.append((float(w.start), float(w.end), w.word.strip()))
        return out
    except Exception:
        return []


def _run_compile(jid: str, req: CompileRequest):
    try:
        oai = {"base_url": req.oai_base_url, "api_key": req.oai_api_key, "model": req.oai_model}
        _prog(jid, 2, "analyze")
        res = _analyze(req.url, " dan ".join(req.moods), oai)
        clips = [c for c in res.get("clips", []) if int(c.get("virality_score", 0)) >= req.min_score]
        clips.sort(key=lambda c: int(c.get("virality_score", 0)), reverse=True)
        picked, total = [], 0.0
        for c in clips:
            d = max(1.0, float(c.get("end_time", 0)) - float(c.get("start_time", 0)))
            if total + d <= 900.0:
                picked.append(c)
                total += d
            if total >= 600.0:
                break
        clips = sorted(picked, key=lambda c: float(c.get("start_time", 0)))
        if not clips or total < 60.0:
            _jobs[jid] = {"pct": 0, "stage": "error", "done": True,
                           "error": f"momen kurang (cuma {total:.0f}s). Turunkan ambang skor."}
            return
        vid = _vid(req.url)
        _prog(jid, 8, "download", total=len(clips))
        src = _dl_full(req.url, vid)
        segs = []
        for i, c in enumerate(clips):
            s, e = float(c["start_time"]), float(c["end_time"])
            tag = f"{vid}_seg{i}"
            segp = os.path.join(WORK, tag + ".mp4")
            assp = os.path.join(WORK, tag + ".ass")
            wavp = os.path.join(WORK, tag + ".wav")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(s), "-t", str(round(e - s, 1)),
                            "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavp],
                           check=True, timeout=300,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            words = _whisper_words(wavp)
            try:
                os.remove(wavp)
            except Exception:
                pass
            ok = _sub_ass(assp, words, 0, e - s, c.get("transcript", "")) if (words or c.get("transcript")) else False
            vf = "subtitles='" + assp.replace("\\", "/").replace(":", "\\:") + "'" if ok else "null"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(s), "-t", str(round(e - s, 1)),
                            "-i", src, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
                            "-crf", "23", "-c:a", "aac", segp],
                           check=True, timeout=900,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            segs.append(segp)
            _prog(jid, round(8 + 80 * (i + 1) / len(clips), 1), f"moment {i + 1}/{len(clips)}",
                  total=len(clips), done_count=i + 1)
        lst = os.path.join(WORK, f"{vid}_list.txt")
        with open(lst, "w", encoding="utf-8") as f:
            for sp in segs:
                f.write(f"file '{sp.replace(chr(39), chr(39)+chr(92)+chr(39))}'\n")
        out = os.path.join(WORK, f"{vid}_kompilasi.mp4")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                        "-i", lst, "-c", "copy", out],
                       check=True, timeout=900,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for f in os.listdir(WORK):
            if f.startswith(vid + "_seg"):
                try:
                    os.remove(os.path.join(WORK, f))
                except Exception:
                    pass
        tags = " ".join((clips[0].get("hashtag_suggestion", "") or "").split()[:8])
        mins = round(total / 60, 1)
        _jobs[jid] = {"pct": 100, "stage": "done", "done": True,
                        "file": os.path.basename(out),
                        "title": f"Kompilasi Momen {(' & '.join(req.moods)).title()} ({len(clips)} momen, {mins} mnt)",
                        "caption": f"{len(clips)} momen terbaik ({mins} menit) pilihan AI. {tags}",
                        "moments": len(clips), "minutes": mins}
    except Exception as ex:
        _jobs[jid] = {"pct": 0, "stage": "error", "done": True, "error": str(ex)[:300]}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/compile")
def compile_video(req: CompileRequest):
    jid = os.urandom(6).hex()
    _jobs[jid] = {"pct": 0, "stage": "start", "done": False}
    threading.Thread(target=_run_compile, args=(jid, req), daemon=True).start()
    return {"job_id": jid, "done": False}


@app.get("/api/compile-progress/{jid}")
def compile_progress(jid: str):
    j = _jobs.get(jid)
    if not j:
        from fastapi import HTTPException
        raise HTTPException(404, "unknown job")
    return j


@app.get("/api/compile-file/{name}")
def compile_file(name: str):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    if not re.fullmatch(r"[A-Za-z0-9_\-]+\.(mp4|jpg)", name):
        raise HTTPException(400, "bad name")
    p = os.path.join(WORK, name)
    if not os.path.exists(p):
        raise HTTPException(404, "not found")
    mt = "video/mp4" if name.endswith(".mp4") else "image/jpeg"
    return FileResponse(p, media_type=mt, filename=name)
