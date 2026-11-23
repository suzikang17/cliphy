import logging
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import av
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("whisper")

app = FastAPI(title="Cliphy Whisper Service")

WHISPER_API_KEY = os.environ.get("WHISPER_API_KEY", "")
# Which model does the listening. Measured on this kind of machine (CPU only,
# 24 public recordings, 204 seconds of speech):
#   nemo-parakeet-tdt-0.6b-v2   17x real time, 2.4% of words wrong   (default)
#   large-v3-turbo (Whisper)    0.4x real time, 2.8%
#   small (Whisper)             1.3x real time, 5.8%
# Parakeet v2 is English only; nemo-parakeet-tdt-0.6b-v3 covers 25 European
# languages; the Whisper models cover about a hundred. `compare.py` reruns the test.
MODEL_NAME = os.environ.get("WHISPER_MODEL", "nemo-parakeet-tdt-0.6b-v2")
PARAKEET = MODEL_NAME.startswith(("nemo-", "parakeet"))
DOWNLOAD_TIMEOUT = 600  # 10 minutes
# Parakeet reads a recording whole up to this length: that is the most accurate
# (a five-minute test lost nothing), but memory grows with length (about 2 GB at
# two minutes, 4 GB at five). Longer ones are cut into pieces of at most
# PIECE_SECONDS, and only at a pause of PAUSE_MS or more, so sentences are
# rarely split (the same test then kept 26 of 28 sentences word for word).
LONG_SECONDS = 120
PIECE_SECONDS = 40
PAUSE_MS = 1500

whisper_model = None
parakeet_model = None
parakeet_long = None


@app.on_event("startup")
def load_model() -> None:
    global whisper_model, parakeet_model, parakeet_long
    logger.info("Loading model '%s'...", MODEL_NAME)
    if PARAKEET:
        import onnx_asr

        parakeet_model = onnx_asr.load_model(MODEL_NAME, quantization="int8")
        parakeet_long = parakeet_model.with_vad(
            onnx_asr.load_vad("silero"),
            min_silence_duration_ms=PAUSE_MS,
            max_speech_duration_s=PIECE_SECONDS,
        )
    else:
        from faster_whisper import WhisperModel

        whisper_model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    logger.info("Model loaded.")


def decode(path: str) -> np.ndarray:
    """Any audio file as 16 kHz mono floats."""
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    with av.open(path) as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if not WHISPER_API_KEY:
        # No key configured — allow all (dev mode)
        return await call_next(request)
    provided = request.headers.get("X-API-Key", "")
    if provided != WHISPER_API_KEY:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return await call_next(request)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class TranscribeRequest(BaseModel):
    audio_url: HttpUrl


class TranscribeResponse(BaseModel):
    transcript: str
    duration_seconds: float
    language: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "device": "cpu"}


# ---------------------------------------------------------------------------
# Jobs: start one, then ask how it is going
# ---------------------------------------------------------------------------
# A caller that cannot wait (a serverless function is cut off after a minute)
# starts a job, gets its id straight away, and asks again until it is done.
# One job runs at a time, in order; the rest wait their turn.

JOB_TTL_SECONDS = 60 * 60
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
worker = ThreadPoolExecutor(max_workers=1)


def run_transcription(path: str) -> dict:
    if PARAKEET:
        audio = decode(path)
        seconds = len(audio) / 16000
        if seconds == 0:
            return {"transcript": "", "duration_seconds": 0.0, "language": "en"}
        if seconds <= LONG_SECONDS:
            transcript = parakeet_model.recognize(audio, sample_rate=16000)  # type: ignore[union-attr]
        else:
            parts = parakeet_long.recognize(audio, sample_rate=16000)  # type: ignore[union-attr]
            transcript = " ".join(part.text.strip() for part in parts)
        return {"transcript": transcript.strip(), "duration_seconds": seconds, "language": "en"}

    segments, info = whisper_model.transcribe(path, beam_size=5)  # type: ignore[union-attr]
    transcript = "".join(seg.text for seg in segments).strip()
    return {
        "transcript": transcript,
        "duration_seconds": float(info.duration) if info.duration else 0.0,
        "language": info.language or "en",
    }


def download(audio_url: str) -> str:
    """Fetch the audio into a temp file and return its path."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".audio") as tmp:
        path = tmp.name
    timeout = httpx.Timeout(connect=30.0, read=DOWNLOAD_TIMEOUT, write=30.0, pool=5.0)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", audio_url) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Audio URL returned HTTP {response.status_code}")
            with open(path, "wb") as f:
                for chunk in response.iter_bytes(chunk_size=65536):
                    f.write(chunk)
    return path


def work(job_id: str, audio_url: str) -> None:
    path: str | None = None
    with jobs_lock:
        jobs[job_id]["status"] = "running"
    try:
        path = download(audio_url)
        result = run_transcription(path)
        with jobs_lock:
            jobs[job_id].update(status="done", **result)
        logger.info("Job %s done: %.1fs of audio", job_id, result["duration_seconds"])
    except Exception as exc:  # noqa: BLE001 - the reason is reported to the caller
        logger.exception("Job %s failed: %s", job_id, exc)
        with jobs_lock:
            jobs[job_id].update(status="failed", error=str(exc))
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def forget_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with jobs_lock:
        for job_id in [k for k, v in jobs.items() if v["created"] < cutoff]:
            del jobs[job_id]


@app.post("/jobs", status_code=202)
def start_job(body: TranscribeRequest):
    forget_old_jobs()
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "created": time.time()}
    worker.submit(work, job_id, str(body.audio_url))
    return {"id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            return JSONResponse(status_code=404, content={"error": "No such job"})
        return {k: v for k, v in job.items() if k != "created"}


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(body: TranscribeRequest):
    """Wait for the transcript. For callers that can; the others use /jobs."""
    audio_url = str(body.audio_url)
    logger.info("Transcription request: %s", audio_url)
    path: str | None = None
    try:
        path = download(audio_url)
        result = run_transcription(path)
        logger.info("Transcription complete: %.1fs of audio", result["duration_seconds"])
        return TranscribeResponse(**result)
    except Exception as exc:  # noqa: BLE001 - the reason is reported to the caller
        logger.exception("Transcription failed for %s: %s", audio_url, exc)
        return JSONResponse(status_code=500, content={"error": str(exc)})
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
