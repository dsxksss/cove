"""Regression checks for the Windows hidden-process stem JSON protocol.

Run with the bundled Python: python/python.exe scripts/test-stem-runner.py.
No model or microphone is required; real redirected child-process pipes are used.
"""

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
RUNNERS = [ROOT / "src-tauri/resources/ncm2acc/runner.py", ROOT / "tools/ncm2acc/runner.py"]
MESSAGE = "正在加载模型，中文 · サンキュー!! · café 🎤"
OUTPUT_PATH = "E:\\Cove\\录音\\サンキュー!! (伴奏).wav"


def load_runner(path):
    spec = importlib.util.spec_from_file_location("stem_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StemProtocolTests(unittest.TestCase):
    def test_stem_tags_do_not_confuse_song_names_or_no_vocals(self):
        for path in RUNNERS:
            runner = load_runner(path)
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in ["Song (Vocals)_(Instrumental).wav", "Song (Instrumental)_(Vocals).wav", "Song_(no_vocals).wav", "Song (人声).wav", "instrumental.wav", "Song (Vocals).json"]:
                    (root / name).write_bytes(b"fixture")
                self.assertEqual({p.name for p in runner.stem_outputs(root, "vocals")}, {"Song (Instrumental)_(Vocals).wav", "Song (人声).wav"})
                self.assertEqual({p.name for p in runner.stem_outputs(root, "instrumental")}, {"Song (Vocals)_(Instrumental).wav", "Song_(no_vocals).wav"})

    def test_ncm_entrypoint_keeps_both_stems_and_selects_by_final_label(self):
        upstream = load_runner(ROOT / "src-tauri/resources/ncm2acc/ncm2acc.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            class Separator:
                output_dir = directory
                def separate(self, _song):
                    names = ["Song (Instrumental)_(Vocals).wav", "Song (Instrumental)_(Instrumental).wav"]
                    for index, name in enumerate(names):
                        (root / name).write_bytes(bytes([index]))
                    return names
            result = upstream.extract_instrumental(Separator(), Path("Song (Instrumental).wav"), "WAV")
            self.assertEqual(result.read_bytes(), b"\x01")
            self.assertTrue((root / "Song (Instrumental)_(Vocals).wav").exists())

    def test_json_round_trips_through_gbk_and_ascii_streams(self):
        for path in RUNNERS:
            for encoding in ("gbk", "ascii"):
                with self.subTest(runner=str(path), encoding=encoding):
                    runner = load_runner(path)
                    raw = io.BytesIO()
                    stream = io.TextIOWrapper(raw, encoding=encoding)
                    with patch.object(runner.sys, "stdout", stream):
                        runner.emit("separate", 0.16, message=MESSAGE, outputPath=OUTPUT_PATH, vocalOutputPath=OUTPUT_PATH.replace("伴奏", "人声"))
                    wire = raw.getvalue()
                    self.assertTrue(wire.isascii())
                    event = json.loads(wire.decode("utf-8"))
                    self.assertEqual(event["message"], MESSAGE)
                    self.assertEqual(event["outputPath"], OUTPUT_PATH)
                    self.assertEqual(event["vocalOutputPath"], OUTPUT_PATH.replace("伴奏", "人声"))
                    stream.detach()

    def test_stdio_configures_utf8(self):
        runner = load_runner(RUNNERS[0])
        streams = [io.TextIOWrapper(io.BytesIO(), encoding="gbk") for _ in range(2)]
        with patch.object(runner.sys, "stdout", streams[0]), patch.object(runner.sys, "stderr", streams[1]):
            runner.configure_stdio()
        for stream in streams:
            self.assertEqual(stream.encoding, "utf-8")
            self.assertTrue(stream.write_through)
            stream.close()

    def test_hidden_child_process_with_ansi_locale(self):
        for path in RUNNERS:
            with self.subTest(runner=str(path)):
                code = (
                    "import runpy,sys; "
                    "m=runpy.run_path(sys.argv[1]); "
                    "m['configure_stdio'](); "
                    "m['emit']('separate',0.16,message=sys.argv[2],outputPath=sys.argv[3]); "
                    "print(sys.argv[2],file=sys.stderr,flush=True)"
                )
                env = {**os.environ, "PYTHONIOENCODING": "gbk", "PYTHONUTF8": "0"}
                result = subprocess.run(
                    [sys.executable, "-c", code, str(path), MESSAGE, OUTPUT_PATH],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env=env, timeout=20,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
                event = json.loads(result.stdout.decode("utf-8"))
                self.assertEqual(event["message"], MESSAGE)
                self.assertEqual(event["outputPath"], OUTPUT_PATH)
                self.assertIn(MESSAGE, result.stderr.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
