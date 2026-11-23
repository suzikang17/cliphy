# The Whisper transcription service as a container: `docker run` on any
# machine, x86 or ARM, with no Python to set up. See README.md.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

# The model is downloaded on first start and kept in this folder; mount a
# volume here so a restart does not download it again.
ENV HF_HOME=/models
VOLUME /models

EXPOSE 9000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9000"]
