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
    def test_json_round_trips_through_gbk_and_ascii_streams(self):
        for path in RUNNERS:
            for encoding in ("gbk", "ascii"):
                with self.subTest(runner=str(path), encoding=encoding):
                    runner = load_runner(path)
                    raw = io.BytesIO()
                    stream = io.TextIOWrapper(raw, encoding=encoding)
                    with patch.object(runner.sys, "stdout", stream):
                        runner.emit("separate", 0.16, message=MESSAGE, outputPath=OUTPUT_PATH)
                    wire = raw.getvalue()
                    self.assertTrue(wire.isascii())
                    event = json.loads(wire.decode("utf-8"))
                    self.assertEqual(event["message"], MESSAGE)
                    self.assertEqual(event["outputPath"], OUTPUT_PATH)
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
