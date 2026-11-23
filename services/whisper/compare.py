"""Run the same recordings through several speech-to-text models and compare.

For choosing which model the service should run. Give it audio files (or
addresses of them); for each model it prints how long the transcription took
and what came out, and, where the right words are known, how many were wrong.

    python compare.py note1.m4a note2.m4a
    python compare.py --samples            # public recordings with known words

Needs: faster-whisper, onnx-asr[cpu,hub], av<17, numpy. Run it in a container
so nothing is installed on the machine:

    docker run --rm -v "$PWD":/work -v cliphy-asr-cache:/root/.cache -w /work \
      python:3.12-slim bash -c 'pip install -q faster-whisper "onnx-asr[cpu,hub]" "av<17" numpy \
      && python compare.py --samples'
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import av
import numpy as np

# Public recordings whose words are known, for when there are none of our own:
# a slice of LibriSpeech (people reading books aloud), served with its text.
# It is clean, read speech that these models have all been measured on, so it
# shows speed fairly and accuracy only roughly. Our own notes are the real test.
SAMPLES_API = (
    "https://datasets-server.huggingface.co/rows?dataset=hf-internal-testing%2F"
    "librispeech_asr_dummy&config=clean&split=validation&offset=0&length={count}"
)
SAMPLE_COUNT = 24


def fetch_samples() -> dict[str, str]:
    """Download the sample recordings; return each file's correct words."""
    rows = None
    for wait in (0, 5, 15, 30, 60):
        time.sleep(wait)
        try:
            with urllib.request.urlopen(SAMPLES_API.format(count=SAMPLE_COUNT)) as response:
                rows = json.load(response)["rows"]
            break
        except urllib.error.HTTPError as err:
            # The service is sometimes briefly unavailable; anything else is a real refusal.
            if err.code < 500:
                raise
    if rows is None:
        sys.exit("The sample recordings could not be fetched. Try again later.")
    known = {}
    for index, item in enumerate(rows):
        row = item["row"]
        audio = row["audio"][0] if isinstance(row["audio"], list) else row["audio"]
        name = f"sample-{index:02d}.wav"
        if not Path(name).exists():
            urllib.request.urlretrieve(audio["src"], name)
        known[name] = row["text"]
    return known


def load(path: str) -> np.ndarray:
    """Any audio file as 16 kHz mono floats, which is what every model here takes."""
    container = av.open(path)
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    for frame in container.decode(audio=0):
        for out in resampler.resample(frame):
            chunks.append(out.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype(np.float32) / 32768.0


# The same word written two ways is not a mistake.
SAME = {"mr": "mister", "mrs": "missus", "dr": "doctor", "st": "saint", "ok": "okay"}


def words(text: str) -> list[str]:
    plain = re.sub(r"[^a-z0-9 ]+", " ", text.lower().replace("'", ""))
    return [SAME.get(word, word) for word in plain.split()]


def word_errors(said: str, heard: str) -> tuple[int, int]:
    """How many of the words that were said came out wrong, missing or extra."""
    a, b = words(said), words(heard)
    row = list(range(len(b) + 1))
    for i, wa in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, wb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (wa != wb))
    return row[-1], len(a)


def whisper(size: str):
    from faster_whisper import WhisperModel

    model = WhisperModel(size, device="cpu", compute_type="int8")

    def run(audio: np.ndarray) -> str:
        segments, _ = model.transcribe(audio, beam_size=5)
        return "".join(s.text for s in segments).strip()

    return run


def parakeet(name: str):
    import onnx_asr

    model = onnx_asr.load_model(name, quantization="int8")
    return lambda audio: model.recognize(audio, sample_rate=16000).strip()


MODELS = {
    "whisper small": lambda: whisper("small"),
    "whisper large-v3-turbo": lambda: whisper("large-v3-turbo"),
    "parakeet tdt 0.6b v2": lambda: parakeet("nemo-parakeet-tdt-0.6b-v2"),
}


def main() -> None:
    args = sys.argv[1:]
    known: dict[str, str] = {}
    if args == ["--samples"]:
        known = fetch_samples()
        args = list(known)
    if not args:
        sys.exit(__doc__)

    clips = {path: load(path) for path in args}
    total_seconds = sum(len(a) for a in clips.values()) / 16000
    print(f"{len(clips)} recordings, {total_seconds:.0f} seconds of audio\n")

    for label, make in MODELS.items():
        started = time.time()
        run = make()
        loaded = time.time() - started
        took = 0.0
        wrong = said = 0
        outputs = {}
        for path, audio in clips.items():
            started = time.time()
            outputs[path] = run(audio)
            took += time.time() - started
            if path in known:
                w, n = word_errors(known[path], outputs[path])
                wrong, said = wrong + w, said + n
        speed = total_seconds / took if took else 0
        score = f", {wrong} of {said} words wrong ({100 * wrong / said:.1f}%)" if said else ""
        print(f"== {label}: {took:.1f}s ({speed:.1f}x real time), loaded in {loaded:.0f}s{score}")
        # With our own recordings, read what each model heard. With the many
        # samples, the count of wrong words says it.
        for path, text in outputs.items() if not known else []:
            print(f"   {path}: {text}")
        print()


if __name__ == "__main__":
    main()
