# Changelog

## 2.0.0

- First public major release: bump package version from 0.1.0 to 2.0.0.

## 0.1.0

- `packnpub init`: CI matrix, tag-driven release workflow (npm trusted publishing, GitHub Packages, GitHub Releases, Homebrew), verify script, seed Homebrew formula.
- `packnpub doctor`: readiness checks (including bash availability for verify).
- `packnpub verify`: pre-publish gate with an isolated tarball smoke test; clear error when bash is missing.
- First-release README checklist: public-repo + npm login + trusted publishing notes; ignore local harness dirs in `.gitignore`.
