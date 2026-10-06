# Third-party packaging checklist

The runner is an integration layer for `dsxksss/ncm2mp32acc`:

<https://github.com/dsxksss/ncm2mp32acc>

Before creating a distributable Windows installer, record the exact upstream
commit, verify redistribution terms for the upstream script, `ncmdump-go.exe`,
FFmpeg, Python/audio-separator and the selected separation model, and include
their notices beside the packaged resources. The repository intentionally keeps
large binaries and model files out of source control.
