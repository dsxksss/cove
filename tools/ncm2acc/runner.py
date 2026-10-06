#!/usr/bin/env python3
"""JSON-line bridge used by Cove's Tauri stem job.

Place this file, the upstream ncm2acc.py, ncmdump-go.exe and the bundled
Python/audio-separator runtime in the packaged resources/ncm2acc directory.
The runner deliberately keeps the upstream folder-watch implementation intact
and drives it in --once mode for one input file.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", write_through=True)


def emit(stage: str, progress: float, **extra: object) -> None:
    payload = {"stage": stage, "progress": max(0.0, min(1.0, progress)), **extra}
    print(json.dumps(payload, ensure_ascii=True), flush=True)


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--format", default="WAV")
    parser.add_argument("--model", default="")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    upstream = root / "ncm2acc.py"
    ncmdump = root / "ncmdump-go.exe"
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cove-ncm2acc-") as temp:
        temp_root = Path(temp)
        watch = temp_root / "watch"
        output = temp_root / "output"
        watch.mkdir()
        output.mkdir()
        source = watch / args.input.name
        shutil.copy2(args.input, source)

        is_ncm = source.suffix.lower() == ".ncm"
        if is_ncm:
            if not upstream.exists():
                emit("prepare", 1, error="缺少 ncm2acc.py")
                return 2
            if not ncmdump.exists():
                emit("prepare", 1, error=f"缺少 ncmdump-go.exe: {ncmdump}")
                return 2
            emit("decrypt", 0.08)
            command = [sys.executable, str(upstream), "--watch", str(watch), "--output", str(output), "--ncmdump", str(ncmdump), "--fmt", args.format, "--once"]
        else:
            emit("prepare", 0.08)
            separator_candidates = [root / "audio-separator.exe", root / "python" / "Scripts" / "audio-separator.exe"]
            separator = next((path for path in separator_candidates if path.exists()), None)
            # Recent audio-separator releases expose the CLI as a console
            # entry point without a module-level `__main__` wrapper.
            command = [str(separator)] if separator else [sys.executable, "-c", "from audio_separator.utils.cli import main; main()"]
            command += [
                str(source),
                "--output_dir", str(output),
                "--output_format", args.format,
                "--model_file_dir", str(root / "models"),
            ]
            model = Path(args.model) if args.model else next(iter((root / "models").glob("*.ckpt")), None)
            if model and model.exists():
                command += ["--model_filename", model.name]
        environment = os.environ.copy()
        environment["PYTHONIOENCODING"] = "utf-8:backslashreplace"
        environment["PYTHONUTF8"] = "1"
        environment["PATH"] = str(root) + os.pathsep + environment.get("PATH", "")
        # Model loading and CPU separation can take several minutes.  Do not
        # leave the UI at the initial 8% while waiting for a subprocess that
        # intentionally produces no stdout until it finishes.
        emit("separate", 0.16)
        log_path = temp_root / "separator.log"
        with log_path.open("w", encoding="utf-8", errors="replace") as log:
            process = subprocess.Popen(
                command,
                cwd=root,
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=log,
                stderr=subprocess.STDOUT,
                env=environment,
            )
            started_at = time.monotonic()
            while process.poll() is None:
                elapsed = time.monotonic() - started_at
                # Keep room for the final file copy. This is an activity
                # indicator, not a claim about model-level exact progress.
                emit("separate", min(0.92, 0.16 + elapsed / 240.0))
                time.sleep(1.0)
            return_code = process.returncode
        if return_code != 0:
            details = log_path.read_text("utf-8", errors="replace")[-2000:]
            emit("separate", 1, error=details or f"分离进程退出码 {return_code}")
            return return_code

        emit("separate", 0.65)
        candidates = sorted(output.glob("*(伴奏).*"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not candidates:
            candidates = sorted([item for item in output.iterdir() if any(token in item.stem.lower() for token in ("instrumental", "no_vocals", "accompaniment"))], key=lambda item: item.stat().st_mtime, reverse=True)
        if not candidates:
            emit("finalize", 1, error="分离完成但未找到伴奏输出文件")
            return 3
        destination = args.output / f"{args.title or candidates[0].stem} (伴奏){candidates[0].suffix}"
        shutil.copy2(candidates[0], destination)
        emit("finalize", 1, outputPath=str(destination))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
