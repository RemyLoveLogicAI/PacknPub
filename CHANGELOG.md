# Changelog

## 0.1.1

- `packnpub init` finishes with a live doctor scorecard and points at `verify` when the package is healthy.
- After a healthy scaffold, next-step copy tells you to build `dist` when needed and commit (or use `--skip-git`) before `verify`.
- Dry-run `init` follow-up preserves `--owner`, `--targets`, and `--force` so the real run matches the preview.
- Doctor: lockfile is required for next-step, README read errors become checks, `gh --version` times out, and control chars are stripped from scorecard output.
- README quickstart requires a real install/init command near the top (not `yarn test`-style noise).
- Landing copy toast reports failure when clipboard write fails; Pages deploys only from `main`.
- Scaffold writes are atomic (temp file + rename).
- `packnpub doctor` checks that README opens with a real install/init command, not just that the file exists.
- Landing page redesigned (brand-first, typed happy-path demo, copy-to-clipboard) and GitHub Pages workflow added.

## 0.1.0

- `packnpub init`: CI matrix, tag-driven release workflow (npm trusted publishing, GitHub Packages, GitHub Releases, Homebrew), verify script, seed Homebrew formula.
- `packnpub doctor`: readiness checks.
- `packnpub verify`: pre-publish gate with an isolated tarball smoke test.
