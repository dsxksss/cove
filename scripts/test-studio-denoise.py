"""Run the bundled denoiser on deterministic noise; no microphone is needed."""
import array
import math
from pathlib import Path
import random
import subprocess
import unittest
import wave

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = ROOT / "src-tauri/resources/ncm2acc/ffmpeg.exe"
OUTPUT = ROOT / ".tmp/studio-denoise-regression"


class DenoiseTests(unittest.TestCase):
    def test_noise_reduction_keeps_duration_and_original(self):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        randomizer = random.Random(42)
        rate = 48000
        samples = array.array("h", (
            round(32767 * (randomizer.uniform(-0.008, 0.008) +
                (0.15 * math.sin(2 * math.pi * 440 * i / rate) if rate < i < 2 * rate else 0)))
            for i in range(3 * rate)
        ))
        source = OUTPUT / "noisy.wav"
        with wave.open(str(source), "wb") as stream:
            stream.setparams((1, 2, rate, len(samples), "NONE", "not compressed"))
            stream.writeframes(samples.tobytes())
        original = source.read_bytes()
        before = math.sqrt(sum((v / 32768) ** 2 for v in samples[-rate // 2:]) / (rate // 2))
        for reduction in (6, 12, 18):
            target = OUTPUT / f"denoised-{reduction}.wav"
            subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(source), "-af",
                f"afftdn=nr={reduction}:nf=-40:tn=1", "-c:a", "pcm_s24le", str(target)],
                check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            decoded = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(target), "-f", "f32le", "-"],
                check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            audio = array.array("f", decoded.stdout)
            after = math.sqrt(sum(v * v for v in audio[-rate // 2:]) / (rate // 2))
            self.assertEqual(len(audio), len(samples), "denoising must not shift the lyric timeline")
            self.assertLess(after, before * 0.9, f"noise should fall at strength {reduction}")
            self.assertGreater(max(abs(v) for v in audio[rate:2 * rate]), 0.08, "voice-like tone must remain")
            self.assertEqual(source.read_bytes(), original, "source recording must stay untouched")
            print(f"strength={reduction}dB noise RMS {before:.6f} -> {after:.6f}, duration=3s")


if __name__ == "__main__":
    unittest.main()
