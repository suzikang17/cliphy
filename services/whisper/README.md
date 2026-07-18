# Cliphy Whisper Service

Self-hosted audio transcription service for podcast episodes.

## Setup

```bash
pip install -r requirements.txt
```

## Configuration

Copy .env.example to .env and set WHISPER_API_KEY.

## Run

```bash
WHISPER_API_KEY=your-key uvicorn main:app --host 0.0.0.0 --port 9000
```

## Run as systemd service (recommended)

Create /etc/systemd/system/cliphy-whisper.service:

```ini
[Unit]
Description=Cliphy Whisper Transcription Service
After=network.target

[Service]
User=sk
WorkingDirectory=/home/sk/cliphy/services/whisper
Environment=WHISPER_API_KEY=your-key-here
ExecStart=/usr/local/bin/uvicorn main:app --host 0.0.0.0 --port 9000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable cliphy-whisper
sudo systemctl start cliphy-whisper
```

## Add to server .env

```
WHISPER_SERVICE_URL=http://localhost:9000
WHISPER_API_KEY=your-key-here
```

First run downloads the Whisper small model (~500MB) automatically.
