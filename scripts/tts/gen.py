#!/usr/bin/env python3
"""Synthesize post narration with Kokoro (local, offline, free).

Reads a JSON array of block strings (one per readable block: title, dek,
paragraphs, headings, list items) from --in, speaks each block, concatenates
them into a single MP3 with a small gap between blocks, and prints a JSON
result to stdout:

    {"timings": [0.0, 3.21, ...], "duration": 187.4}

timings[i] is the second-offset where block i's speech starts, so the page can
highlight the block currently being read. One block == one entry, in order.

    python gen.py --in blocks.json --out ../../posts/slug.mp3 --voice am_michael
"""
import argparse, json, subprocess, sys, tempfile, os
import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24000
GAP = np.zeros(int(0.28 * SR), dtype=np.float32)  # breath between blocks


def synth_block(pipe, voice, text):
    text = (text or "").strip()
    if not text:
        return np.zeros(int(0.15 * SR), dtype=np.float32)
    parts = [audio for _, _, audio in pipe(text, voice=voice)]
    if not parts:
        return np.zeros(int(0.15 * SR), dtype=np.float32)
    return np.concatenate(parts).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--meta", dest="meta", required=True)
    ap.add_argument("--voice", default="am_michael")
    args = ap.parse_args()

    with open(args.inp) as f:
        blocks = json.load(f)

    pipe = KPipeline(lang_code="a")  # American English
    pieces, timings, t = [], [], 0.0
    for text in blocks:
        audio = synth_block(pipe, args.voice, text)
        timings.append(round(t, 3))
        pieces.append(audio)
        pieces.append(GAP)
        t += (len(audio) + len(GAP)) / SR

    full = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav = tmp.name
    sf.write(wav, full, SR)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    # 64k mono mp3 is plenty for speech and keeps the committed file small.
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
         "-ac", "1", "-b:a", "64k", args.out],
        check=True,
    )
    os.unlink(wav)

    with open(args.meta, "w") as f:
        json.dump({"timings": timings, "duration": round(len(full) / SR, 2)}, f)
    print(f"synth: {len(blocks)} blocks -> {round(len(full)/SR,1)}s", file=sys.stderr)


if __name__ == "__main__":
    main()
