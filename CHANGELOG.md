# Changelog

## 2.0.0

- First public major release (from 0.1.0).
- `packnpub doctor` warns when bash is missing (required for verify; Git Bash or WSL on Windows).
- `packnpub verify` prints a clear error when bash is not on PATH.
- `packnpub init` skips exec-bit chmod on win32 to avoid EPERM noise.
- README first-release checklist covers public repo, npm login, and trusted publishing.
- `.gitignore` ignores local harness dirs (`.crew-ledger/`, `.cursor/`, `.taskplane/`).

## 0.1.0

- `packnpub init`: CI matrix, tag-driven release workflow (npm trusted publishing, GitHub Packages, GitHub Releases, Homebrew), verify script, seed Homebrew formula.
- `packnpub doctor`: readiness checks.
- `packnpub verify`: pre-publish gate with an isolated tarball smoke test.
