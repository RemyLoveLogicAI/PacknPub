# Changelog

## Unreleased

- `packnpub init` finishes with a live doctor scorecard and points at `verify` when the package is healthy.
- After a healthy scaffold, next-step copy tells you to build `dist` when needed and commit (or use `--skip-git`) before `verify`.
- Dry-run `init` follow-up preserves `--owner`, `--targets`, and `--force` so the real run matches the preview.
- Doctor: lockfile is required for next-step, README read errors become checks, `gh --version` times out, and control chars are stripped from scorecard output.
- README quickstart requires a real install/init command near the top (not `yarn test`-style noise).
- Landing copy toast shows only on successful clipboard write; Pages deploys only from `main`.
- `init` exits 0 after a successful scaffold even when the attached doctor scorecard has FAILs.
- Scaffold writes are atomic (temp file + rename) and preserve an existing destination mode on overwrite.
- Dry-run follow-up shell-quotes `--owner` / `--targets`; invalid owners (including explicit empty `--owner ""`) are rejected.
- Doctor sanitizes C0+C1 controls (including CR/LF/tab) and requires `package-lock.json` to be a regular file.
- `packnpub doctor` checks that README opens with a real install/init command, not just that the file exists.
- Landing page redesigned (brand-first, typed happy-path demo, copy-to-clipboard) and GitHub Pages workflow added.

## 2.0.0

- First public major release: bump package version from 0.1.0 to 2.0.0.

## 0.1.0

- `packnpub init`: CI matrix, tag-driven release workflow (npm trusted publishing, GitHub Packages, GitHub Releases, Homebrew), verify script, seed Homebrew formula.
- `packnpub doctor`: readiness checks (including bash availability for verify).
- `packnpub verify`: pre-publish gate with an isolated tarball smoke test; clear error when bash is missing.
- First-release README checklist: public-repo + npm login + trusted publishing notes; ignore local harness dirs in `.gitignore`.
