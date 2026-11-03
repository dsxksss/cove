"""Verify an isolated /COVEVERIFY installation against the staged edition."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("edition", choices=("full", "player"))
parser.add_argument("--extracted", action="store_true", help="Verify payload extracted without running the installer or touching the registry")
parser.add_argument("--payload-root", type=Path, help="A fresh extraction directory containing {app}")
parser.add_argument("--version", default=json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"])
args = parser.parse_args()
package = ROOT / ".tmp" / f"Cove-{args.version}-Windows-x64"
installed = package / f"extracted-{args.edition}" / "{app}" if args.extracted else package / f"verification-{args.edition}"
if args.payload_root:
    assert args.extracted
    installed = args.payload_root.resolve() / "{app}"
staged = ROOT / ".tmp" / f"release-{args.version}-{args.edition}"
assert installed.resolve().is_relative_to((ROOT / ".tmp").resolve())

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest().upper()

report = {"version": args.version, "edition": args.edition, "mode": "payload-extraction" if args.extracted else "isolated-installation", "checks": {}}
exe = installed / "netease-music-player.exe"
assert exe.is_file()
assert digest(exe) == digest(staged / exe.name)
report["checks"]["applicationSha256"] = digest(exe)
readme = ROOT / "tools/installer" / ("README.md" if args.edition == "full" else "README-player.md")
assert digest(installed / "INSTALLATION.md") == digest(readme)
report["checks"]["readme"] = True
assert not list(package.glob("verification-desktop/*.lnk")), "verification shortcuts must stay inside their own installation"
label = "Cove" if args.edition == "full" else "Cove Player"
if not args.extracted:
    for folder in ("verification-desktop", "verification-start-menu"):
        assert (installed / folder / f"{label}.lnk").is_file(), f"missing isolated {folder} shortcut"
    report["checks"]["isolatedShortcutFiles"] = True

def run(command, **kwargs):
    result = subprocess.run([str(value) for value in command], capture_output=True, timeout=360, creationflags=subprocess.CREATE_NO_WINDOW, **kwargs)
    assert result.returncode == 0, f"command failed: {command[0]}: {result.stderr[-3000:]!r} {result.stdout[-3000:]!r}"
    return result

if args.edition == "player":
    assert not (installed / "resources").exists(), "player edition must omit Studio runtime"
    assert not (installed / "docs/cover-studio-guide.md").exists()
    files = [path.relative_to(installed).as_posix() for path in installed.rglob("*") if path.is_file()]
    assert not any(path.endswith((".py", ".ckpt", ".yaml")) for path in files)
    assert not any(Path(path).name.lower() in ("ffmpeg.exe", "ncmdump-go.exe", "python.exe") for path in files)
    report["checks"]["noStudioRuntime"] = True
    metadata = json.loads((package / "BUILD-player.json").read_text(encoding="utf-8"))
    if args.extracted and metadata.get("prerequisiteStrategy") == "download-if-missing":
        assert not list((installed.parent / "{tmp}").rglob("*.exe")), "light installer must not embed offline prerequisite installers"
        report["checks"]["noEmbeddedPrerequisiteInstallers"] = True
        portable_path = package / f"Cove_{args.version}-player-portable.zip"
        prefix = f"Cove-{args.version}-player/"
        with zipfile.ZipFile(portable_path) as archive:
            names = [name for name in archive.namelist() if not name.endswith("/")]
            assert sorted(names) == sorted([prefix + "netease-music-player.exe", prefix + "README.md"])
            assert archive.testzip() is None
            exe_bytes = archive.read(prefix + "netease-music-player.exe")
            assert hashlib.sha256(exe_bytes).hexdigest().upper() == digest(staged / "netease-music-player.exe")
            assert archive.read(prefix + "README.md") == readme.read_bytes()
        portable_report = {"version": args.version, "passed": True, "applicationSha256": digest(exe), "files": names, "bytes": portable_path.stat().st_size}
        (package / "portable-verification-player.json").write_text(json.dumps(portable_report, indent=2), encoding="utf-8")
    report["checks"]["installedFiles"] = files
else:
    source = ROOT / "src-tauri/resources/ncm2acc"
    runtime = installed / "resources/ncm2acc"
    count = total = 0
    for path in source.rglob("*"):
        if not path.is_file() or path.name == ".gitignore" or path.suffix == ".pyc" or "__pycache__" in path.parts:
            continue
        target = runtime / path.relative_to(source)
        assert target.is_file(), f"missing runtime file: {target}"
        assert path.stat().st_size == target.stat().st_size and digest(path) == digest(target), f"runtime mismatch: {target}"
        count += 1; total += path.stat().st_size
    assert digest(runtime / "NOTICE.md") == digest(ROOT / "tools/ncm2acc/NOTICE.md")
    assert digest(installed / "docs/cover-studio-guide.md") == digest(ROOT / "docs/cover-studio-guide.md")
    report["checks"]["runtime"] = {"matchedFiles": count, "matchedBytes": total}
    print(json.dumps({"runtime": report["checks"]["runtime"]}), flush=True)
    audio = package / f"verification-audio-{args.version}"; audio.mkdir(exist_ok=True)
    sample = audio / "input.wav"
    with wave.open(str(sample), "wb") as stream:
        stream.setparams((2, 2, 48000, 96000, "NONE", "not compressed"))
        stream.writeframes(b"".join(struct.pack("<hh", value, value) for value in (round(5000 * math.sin(2 * math.pi * 440 * i / 48000)) for i in range(96000))))
    original = digest(sample)
    result = run([runtime / "python/python.exe", "-u", runtime / "runner.py", "--input", sample, "--output", audio / "cpu", "--title", "release-verification", "--device", "cpu", "--timeout-minutes", "5"], cwd=audio)
    (audio / "cpu-runner.jsonl").write_bytes(result.stdout)
    (audio / "cpu-runner.stderr.log").write_bytes(result.stderr)
    events = [json.loads(line) for line in result.stdout.decode("utf-8", "replace").splitlines() if line.startswith("{")]
    completed = next(event for event in reversed(events) if event.get("outputPath"))
    for key in ("outputPath", "vocalOutputPath"):
        assert Path(completed[key]).is_file() and Path(completed[key]).stat().st_size > 10000
    report["checks"]["cpuSeparation"] = True
    ffmpeg = runtime / "ffmpeg.exe"
    run([ffmpeg, "-v", "error", "-y", "-i", sample, "-af", "rubberband=tempo=1:pitch=2:formant=preserved:pitchq=quality,apad=whole_len=96000,atrim=end_sample=96000", "-c:a", "pcm_s16le", audio / "pitch.wav"])
    with wave.open(str(audio / "pitch.wav"), "rb") as stream:
        assert stream.getnframes() == 96000 and stream.getframerate() == 48000
    run([ffmpeg, "-v", "error", "-y", "-i", sample, "-codec:a", "libmp3lame", "-b:a", "320k", audio / "output.mp3"])
    assert (audio / "output.mp3").stat().st_size > 10000 and digest(sample) == original
    report["checks"]["installedPitchAndMp3"] = True

report["passed"] = True
kind = "payload" if args.extracted else "installation"
(package / f"{kind}-verification-{args.edition}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=True), flush=True)
