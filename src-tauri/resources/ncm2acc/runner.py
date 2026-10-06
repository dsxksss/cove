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
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


DEFAULT_CHUNK_DURATION = 60.0
DEFAULT_TIMEOUT_MINUTES = 45.0
DEFAULT_MEMORY_FLOOR_MIB = 1024


def available_memory_bytes() -> int | None:
    """Return available physical memory on Windows without another dependency."""
    if os.name != "nt":
        return None
    try:
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(MemoryStatus)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullAvailPhys)
    except Exception:
        pass
    return None


def nvidia_gpu_available() -> bool:
    """Check the installed driver, not just whether bundled Torch has CUDA."""
    candidates = []
    located = shutil.which("nvidia-smi")
    if located:
        candidates.append(located)
    if os.name == "nt":
        candidates.extend([
            str(Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32" / "nvidia-smi.exe"),
            str(Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe"),
        ])
    for candidate in dict.fromkeys(candidates):
        try:
            probe = subprocess.run([candidate, "-L"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=8)
            if probe.returncode == 0 and "GPU" in probe.stdout:
                return True
        except (OSError, subprocess.SubprocessError):
            continue
    return False


class SeparationProgress:
    """Read actual chunk/inference progress from the bundled separator's log."""

    def __init__(self) -> None:
        self.chunk, self.chunks, self.fraction = 1, 1, 0.0
        self.ready = False
        self.stage = "separate"
        self.device = "检测设备"

    def feed(self, text: str) -> None:
        for line in re.split(r"[\r\n]", text):
            if "setting Torch device to CUDA" in line:
                self.device = "NVIDIA GPU"
            elif "running in CPU mode" in line:
                self.device = "CPU"
            chunk = re.search(r"Processing chunk (\d+)/(\d+):", line)
            if chunk:
                self.chunk, self.chunks = map(int, chunk.groups())
                self.fraction, self.ready = 0.0, True
            if "Starting separation process" in line:
                self.ready = True
            if self.ready:
                # Ignore model-download bars, which also use tqdm percentages.
                match = re.search(r"(\d{1,3})%\|.*?\|\s*\d+/\d+", line)
                if match:
                    self.fraction = min(1.0, int(match.group(1)) / 100)
            if "Merging " in line and " chunks for stem:" in line:
                self.stage = "finalize"

    def event(self, elapsed: float) -> dict:
        if self.stage == "finalize":
            return dict(stage="finalize", progress=0.94, message="正在合并伴奏…", indeterminate=True, elapsedSec=elapsed)
        if not self.ready:
            return dict(stage="separate", progress=0.16, message=f"正在加载模型（{self.device}）…", indeterminate=True, elapsedSec=elapsed)
        fraction = (self.chunk - 1 + self.fraction) / max(1, self.chunks)
        return dict(stage="separate", progress=0.2 + fraction * 0.7, message=f"正在分离人声（{self.device}）· 分段 {self.chunk}/{self.chunks} · {round(fraction * 100)}%", indeterminate=False, elapsedSec=elapsed)


def stop_process(process: subprocess.Popen) -> None:
    """Stop the worker and its decrypt/FFmpeg descendants, then reap it."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)
    else:
        process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def configure_stdio() -> None:
    # Hidden Windows processes use redirected handles, not a UTF-8 console.
    # Do not inherit a machine's GBK/ANSI locale for the JSON protocol or logs.
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", write_through=True)


def emit(stage: str, progress: float, **extra: object) -> None:
    payload = {"stage": stage, "progress": max(0.0, min(1.0, progress)), **extra}
    # ASCII JSON escapes preserve Unicode after serde_json decoding and also
    # remain safe when an older launcher forces an ANSI stdout wrapper.
    print(json.dumps(payload, ensure_ascii=True), flush=True)


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--format", default="WAV")
    parser.add_argument("--model", default="")
    # CPU is the portable default. Bundled CUDA/PyTorch can report a CUDA
    # build even when the target machine has no usable NVIDIA device.
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--chunk-duration", type=float, default=DEFAULT_CHUNK_DURATION)
    parser.add_argument("--timeout-minutes", type=float, default=DEFAULT_TIMEOUT_MINUTES)
    parser.add_argument("--memory-floor-mib", type=int, default=DEFAULT_MEMORY_FLOOR_MIB)
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
            emit("decrypt", 0.08, message="正在解密原曲…")
            command = [sys.executable, str(upstream), "--watch", str(watch), "--output", str(output), "--ncmdump", str(ncmdump), "--fmt", args.format, "--once"]
        else:
            emit("prepare", 0.08, message="正在准备分离模型…")
            # Recent audio-separator releases expose the CLI as a console
            # entry point without a module-level `__main__` wrapper.
            command = [sys.executable, "-u", "-c", "import torch; torch.set_num_threads(2); torch.set_num_interop_threads(2); from audio_separator.utils.cli import main; main()"]
            command += [
                str(source),
                "--output_dir", str(output),
                "--output_format", args.format,
                "--model_file_dir", str(root / "models"),
                "--single_stem", "Instrumental",
                "--chunk_duration", str(max(10.0, args.chunk_duration)),
                "--mdxc_segment_size", "256", "--mdxc_override_model_segment_size",
                "--mdxc_batch_size", "1", "--mdxc_overlap", "2",
            ]
            model = Path(args.model) if args.model else next(iter((root / "models").glob("*.ckpt")), None)
            if model and model.exists():
                command += ["--model_filename", model.name]
        environment = os.environ.copy()
        environment["PATH"] = str(root) + os.pathsep + environment.get("PATH", "")
        environment["PYTHONIOENCODING"] = "utf-8:backslashreplace"
        environment["PYTHONUTF8"] = "1"
        # PyTorch/OpenMP may otherwise create one worker per logical core.
        # That is fast on a workstation but can exhaust RAM on a laptop.
        for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "TORCH_NUM_THREADS"):
            environment[name] = "2"
        environment["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
        use_cuda = args.device == "cuda" or (args.device == "auto" and nvidia_gpu_available())
        if not use_cuda:
            # `-1` is required on Windows; an empty value can still leave the
            # CUDA runtime visible to some PyTorch builds.
            environment["CUDA_VISIBLE_DEVICES"] = "-1"
        # Let PyTorch validate GPU compatibility; a missing nvidia-smi in PATH
        # does not mean CUDA is unavailable. Avoid mixed precision on CPU.
        environment["PYTHONUNBUFFERED"] = "1"
        environment["COVE_NCM2ACC_CHUNK_DURATION"] = str(max(10.0, args.chunk_duration))
        environment["COVE_NCM2ACC_THREADS"] = "2"
        environment["COVE_NCM2ACC_USE_AUTOCAST"] = "1" if use_cuda else "0"
        # Model loading and CPU separation can take several minutes.  Do not
        # leave the UI at the initial 8% while waiting for a subprocess that
        # intentionally produces no stdout until it finishes.
        emit("separate", 0.16, message=f"正在加载模型（{'NVIDIA GPU' if use_cuda else 'CPU'}），首次运行可能需要几分钟…", indeterminate=True, elapsedSec=0)
        # Keep diagnostic logs after the temporary audio has been cleaned up.
        log_path = args.output / "separator.log"
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
            return_code = None
            failure = None
            low_memory_samples = 0
            activity = SeparationProgress()
            with log_path.open("r", encoding="utf-8", errors="replace") as reader:
                try:
                    while process.poll() is None:
                        elapsed = round(time.monotonic() - started_at, 1)
                        available = available_memory_bytes()
                        low_memory_samples = low_memory_samples + 1 if available is not None and available < max(128, args.memory_floor_mib) * 1024 * 1024 else 0
                        if low_memory_samples >= 3:
                            failure = f"可用内存持续低于 {max(128, args.memory_floor_mib)} MiB，已停止任务以避免系统卡死。请关闭其他程序后重试。"
                            return_code = 9
                            break
                        if elapsed >= max(1.0, args.timeout_minutes) * 60:
                            failure = f"分离任务超过 {args.timeout_minutes:g} 分钟，已停止。请检查设备性能或使用较短音频重试。"
                            return_code = 15
                            break
                        activity.feed(reader.read())
                        emit(**activity.event(elapsed))
                        time.sleep(1.0)
                finally:
                    stop_process(process)
            if return_code is None:
                return_code = process.returncode
        if return_code != 0:
            details = log_path.read_text("utf-8", errors="replace")[-2000:]
            emit("separate", 1, error=failure or details or f"分离进程退出码 {return_code}", message="伴奏生成失败")
            return return_code

        emit("finalize", 0.92, message="正在写入伴奏文件…")
        candidates = sorted(output.glob("*(伴奏).*"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not candidates:
            candidates = sorted([item for item in output.iterdir() if any(token in item.stem.lower() for token in ("instrumental", "no_vocals", "accompaniment"))], key=lambda item: item.stat().st_mtime, reverse=True)
        if not candidates:
            emit("finalize", 1, error="分离完成但未找到伴奏输出文件", message="未找到伴奏输出文件")
            return 3
        destination = args.output / f"{args.title or candidates[0].stem} (伴奏){candidates[0].suffix}"
        shutil.copy2(candidates[0], destination)
        emit("finalize", 1, outputPath=str(destination), message="伴奏已生成")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
