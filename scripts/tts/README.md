# Post narration (Kokoro TTS)

`npm run build:audio` gives each blog post a natural-voice "Listen to this post"
MP3, generated locally with [Kokoro](https://github.com/hexgrad/kokoro) — free,
offline, no API key, no cloud. The MP3 + per-block highlight timings are baked
into `posts/<slug>.html`; posts without audio fall back to the browser's Web
Speech voice, so this step is optional.

## One-time setup

```bash
brew install espeak-ng ffmpeg          # phonemes + mp3 encoding
python3.12 -m venv scripts/tts/venv    # torch needs a stable Python
scripts/tts/venv/bin/pip install kokoro soundfile
```

The venv (`scripts/tts/venv/`) is gitignored — it's ~2 GB of PyTorch.

## Regenerating audio

```bash
npm run build:blog          # regenerate posts from markdown first
npm run build:audio         # then synthesize + bake (all posts)
npm run build:audio -- rag-eval-lying-metrics   # or one post by slug
```

Idempotent: a content hash is stored with each post's audio, so unchanged posts
are skipped. Change the voice in `scripts/build-audio.mjs` (`VOICE` — e.g.
`af_heart`, `af_bella`, `am_fenrir`).
