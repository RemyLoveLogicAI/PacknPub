# Changelog

## 0.1.1

- `packnpub init` finishes with a live doctor scorecard and points at `verify` when the package is healthy.
- `packnpub doctor` checks that README opens with a real install/init command, not just that the file exists.
- Landing page redesigned (brand-first, typed happy-path demo, copy-to-clipboard) and GitHub Pages workflow added.

## 0.1.0

- `packnpub init`: CI matrix, tag-driven release workflow (npm trusted publishing, GitHub Packages, GitHub Releases, Homebrew), verify script, seed Homebrew formula.
- `packnpub doctor`: readiness checks.
- `packnpub verify`: pre-publish gate with an isolated tarball smoke test.
