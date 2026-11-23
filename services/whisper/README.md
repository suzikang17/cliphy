# Cliphy transcription service

Speech to text on a machine of your own, for voice notes and podcast episodes.
(The folder and the settings are named for Whisper, the model it began with.)
The Cliphy server uses it when `WHISPER_SERVICE_URL` is set and
`DEEPGRAM_API_KEY` is not (see `apps/server/src/services/transcribe.ts` and
`docs/decisions/0071`).

It needs no GPU. The default model is NVIDIA's Parakeet (`nemo-parakeet-tdt-0.6b-v2`,
English), chosen by measuring. On an 8-core ARM machine, 24 public recordings
with known text (204 seconds of speech):

| Model                    | Time  | Speed          | Words wrong |
| ------------------------ | ----- | -------------- | ----------- |
| Parakeet TDT 0.6B v2     | 12 s  | 17x real time  | 2.4%        |
| Whisper `large-v3-turbo` | 577 s | 0.4x real time | 2.8%        |
| Whisper `small`          | 155 s | 1.3x real time | 5.8%        |

`compare.py` reruns this, on the public samples or on recordings of your own.
The samples are clean, read speech, so the accuracy figures are a rough guide;
your own notes are the real test. Memory: about 1.3 GB idle, up to about 2 GB
while reading a two-minute note.

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

The first start downloads the model (about 700 MB) into the `cliphy-whisper-models`
volume. `--restart unless-stopped` brings it back after a reboot. It listens on
this machine only until you give it a public address (next section).

Another model: add `-e WHISPER_MODEL=<name>` to `docker run`.
`nemo-parakeet-tdt-0.6b-v3` covers 25 European languages. For anything else,
a Whisper model (`small`, `large-v3-turbo`) covers about a hundred languages
and is much slower on a CPU.

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
