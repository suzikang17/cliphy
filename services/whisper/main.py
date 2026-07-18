import logging
import os
import tempfile

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
MODEL_SIZE = "small"
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
