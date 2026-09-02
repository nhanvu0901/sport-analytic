"""Chatterbox TTS worker. Runs in its OWN venv, never the project's.

Adapted from comic-book-pipeline/stages/stage_4/_chatterbox_worker.py, which
keeps it dependency-free of the caller on purpose: chatterbox-tts pins
transformers 5, huggingface_hub 1.x and its own torch, so it has to stay in an
isolated venv and talk over a file.

Protocol
--------
  argv[1] = job JSON
      {"chunks": [{"text": str, "key": str, "seed": int, "exaggeration": float, "cfg_weight": float}, ...],
       "out_dir": str,
       "audio_prompt": str | null,   # reference wav = the voice to clone
       "temperature": float,
       "device": "mps" | "cuda" | "cpu" | null}
  writes  out_dir/<key>.wav, one per chunk, at the model's native rate
  prints  one JSON line per finished chunk so a long run shows progress
"""
from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path


def main() -> int:
    job = json.loads(Path(sys.argv[1]).read_text())
    out_dir = Path(job["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)

    import torch
    from chatterbox.tts import ChatterboxTTS

    def save_wav(path: Path, wav, sr: int) -> None:
        """float32 [-1,1] -> 16-bit PCM via the stdlib. torchaudio.save routes
        through TorchCodec, another native dep to keep matched to torch."""
        x = wav.detach().cpu().reshape(-1).clamp(-1.0, 1.0)
        pcm = (x * 32767.0).round().to(torch.int16).numpy().tobytes()
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(int(sr))
            wf.writeframes(pcm)

    device = job.get("device") or ("mps" if torch.backends.mps.is_available() else "cpu")
    t0 = time.time()
    model = ChatterboxTTS.from_pretrained(device=device)
    print(json.dumps({"ready": True, "device": device, "sr": int(model.sr),
                      "load_sec": round(time.time() - t0, 1)}), flush=True)

    prompt = job.get("audio_prompt") or None
    temperature = float(job.get("temperature", 0.8))
    for i, ch in enumerate(job["chunks"]):
        t = time.time()
        key = ch["key"]
        seed = int(ch["seed"])
        try:
            # Seed BEFORE generate, per chunk: a global (or absent) seed means
            # editing one sentence reshuffles the delivery of every other
            # sentence too, and the approved take is lost.
            torch.manual_seed(seed)
            if device == "mps" and hasattr(torch, "mps") and hasattr(torch.mps, "manual_seed"):
                torch.mps.manual_seed(seed)
            wav = model.generate(
                ch["text"],
                audio_prompt_path=prompt,
                exaggeration=float(ch.get("exaggeration", 0.5)),
                cfg_weight=float(ch.get("cfg_weight", 0.5)),
                temperature=temperature,
            )
            path = out_dir / f"{key}.wav"
            save_wav(path, wav, model.sr)
            sec = wav.shape[-1] / float(model.sr)
            print(json.dumps({"i": i, "key": key, "seed": seed, "sec": round(sec, 4),
                              "sr": int(model.sr), "gen_sec": round(time.time() - t, 1)}), flush=True)
        except Exception as exc:            # one bad chunk must not lose the run
            print(json.dumps({"i": i, "key": key, "seed": seed, "error": repr(exc)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
