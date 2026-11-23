import logging
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
from faster_whisper import WhisperModel
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("whisper")

app = FastAPI(title="Cliphy Whisper Service")

model: WhisperModel | None = None

WHISPER_API_KEY = os.environ.get("WHISPER_API_KEY", "")
# "small" is quick on a plain CPU. "large-v3-turbo" is more accurate and still
# usable on a machine with several cores. Set WHISPER_MODEL to change it.
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
DEVICE = "cpu"
COMPUTE_TYPE = "int8"
DOWNLOAD_TIMEOUT = 600  # 10 minutes


@app.on_event("startup")
def load_model() -> None:
    global model
    logger.info("Loading Whisper model '%s' on %s (%s)...", MODEL_SIZE, DEVICE, COMPUTE_TYPE)
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    logger.info("Model loaded.")


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
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE}


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
    segments, info = model.transcribe(path, beam_size=5)  # type: ignore[union-attr]
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
async def transcribe(body: TranscribeRequest):
    audio_url = str(body.audio_url)
    logger.info("Transcription request: %s", audio_url)

    tmp_path: str | None = None
    try:
        # Download audio to a temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".audio") as tmp:
            tmp_path = tmp.name

        timeout = httpx.Timeout(connect=30.0, read=DOWNLOAD_TIMEOUT, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", audio_url) as response:
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Audio URL returned HTTP {response.status_code}",
                    )
                with open(tmp_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)

        logger.info("Download complete, starting transcription: %s", audio_url)

        # Run transcription (blocking — fine for a dedicated service)
        segments, info = model.transcribe(tmp_path, beam_size=5)  # type: ignore[union-attr]

        transcript_parts: list[str] = [seg.text for seg in segments]
        transcript = "".join(transcript_parts).strip()

        duration = float(info.duration) if info.duration else 0.0
        language = info.language or "en"

        logger.info(
            "Transcription complete: %s | duration=%.1fs language=%s chars=%d",
            audio_url,
            duration,
            language,
            len(transcript),
        )

        return TranscribeResponse(
            transcript=transcript,
            duration_seconds=duration,
            language=language,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Transcription failed for %s: %s", audio_url, exc)
        return JSONResponse(status_code=500, content={"error": str(exc)})
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
