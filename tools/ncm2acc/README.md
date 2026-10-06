# Cove ncm2acc runtime

`runner.py` is the JSON-line bridge used by the Tauri command
`studio_prepare_instrumental`. The development build can execute it directly
with the bundled Python runtime; a release build may replace it with a compiled
`ncm2acc-runner.exe`. Keep a pinned copy of the upstream `ncm2acc.py`,
`ncmdump-go.exe`, FFmpeg, the Python runtime and the audio-separator model under
the application's `resources/ncm2acc` directory.

The upstream project is:

<https://github.com/dsxksss/ncm2mp32acc>

The runner invokes the upstream script in `--once` mode and never moves or
deletes the user's original `.ncm` file. The binary/model files are intentionally
not checked into this source repository; release packaging must add them after
license and checksum review.
