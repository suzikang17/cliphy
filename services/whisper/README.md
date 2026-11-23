# Cliphy Whisper service

Speech to text on a machine of your own, for voice notes and podcast episodes.
The Cliphy server uses it when `WHISPER_SERVICE_URL` is set and
`DEEPGRAM_API_KEY` is not (see `apps/server/src/services/transcribe.ts` and
`docs/decisions/0071`).

It needs no GPU. On a plain CPU with the `small` model it uses about 550 MB of
memory and takes roughly one to three seconds per second of audio, depending on
how busy the machine is.

## Run it

```sh
cd services/whisper
docker build -t cliphy-whisper .

mkdir -p ~/.config/cliphy-whisper
(umask 077; echo "WHISPER_API_KEY=$(openssl rand -hex 24)" > ~/.config/cliphy-whisper/env)

docker run -d --name cliphy-whisper --restart unless-stopped \
  -p 127.0.0.1:9010:9000 \
  -v cliphy-whisper-models:/models \
  --env-file ~/.config/cliphy-whisper/env \
  cliphy-whisper

curl http://127.0.0.1:9010/health
```

The first start downloads the model (about 500 MB) into the `cliphy-whisper-models`
volume. `--restart unless-stopped` brings it back after a reboot. It listens on
this machine only until you give it a public address (next section).

A more accurate model: add `-e WHISPER_MODEL=large-v3-turbo` to `docker run`.
It needs more memory and time.

## Give it a public address

The Cliphy server runs on Vercel, so it has to reach this over the internet,
over HTTPS, because the key travels in a header. Either:

- **Tailscale Funnel** (no domain needed): `sudo tailscale funnel --bg 9010`,
  then `tailscale funnel status` shows the `https://<machine>.<tailnet>.ts.net`
  address.
- **A domain you own**: point a name at the machine and put Caddy or nginx in
  front of `127.0.0.1:9010` with a certificate.

Every call except `/health` needs the `X-API-Key` header.

## Tell Cliphy

In Vercel, for Production (and Preview if wanted), then redeploy:

```
WHISPER_SERVICE_URL=https://<the public address>
WHISPER_API_KEY=<the value in ~/.config/cliphy-whisper/env>
```

Leave `DEEPGRAM_API_KEY` unset: when both are set, Deepgram is used.

## How it is called

- `POST /jobs {"audio_url": "..."}` starts a transcription and answers at once
  with `{"id": "..."}`. `GET /jobs/<id>` says `queued`, `running`, `done` (with
  `transcript`, `duration_seconds`, `language`) or `failed` (with `error`).
  One job runs at a time; results are kept for an hour. This is what voice
  notes use: the server function that asks is cut off after a minute, so it
  cannot wait on one long call.
- `POST /transcribe {"audio_url": "..."}` waits and answers with the transcript.
  The podcast job still uses this.

## Without Docker

```sh
pip install -r requirements.txt
WHISPER_API_KEY=your-key uvicorn main:app --host 127.0.0.1 --port 9010
```
