# Changelog

## Unreleased

- `packnpub init` finishes with a live doctor scorecard and points at `verify` when the package is healthy.
- After a healthy scaffold, next-step copy tells you to build `dist` when needed and commit (or use `--skip-git`) before `verify`.
- Dry-run `init` follow-up preserves `--owner`, `--targets`, and `--force` so the real run matches the preview.
- Doctor: lockfile is required for next-step, README read errors become checks, `gh --version` times out, and control chars are stripped from scorecard output.
- README quickstart requires a real install/init command near the top (not `yarn test`-style noise); accepts `$` prompts, indentation, backticks, and `bun add`/`bun i`/`bun install`.
- Landing copy toast shows only on successful clipboard write; Pages deploys only from `main`.
- `init` exits 0 after a successful scaffold even when the attached doctor scorecard has FAILs.
- Scaffold writes are atomic (exclusive `0o600` temp + rename; explicit mode overrides, else preserve existing mode or apply `0666 & ~umask` for new files; unlink only temps this call created).
- Explicit empty `--targets` (e.g. `,`) is rejected; omitting the flag still selects all defaults.
- Landing: copy button uses visible text as its accessible name; Pause/Play (APG action labels) pauses grid/cursor looping motion and typing delays, with opt-in Play under `prefers-reduced-motion`.
- Dry-run follow-up shell-quotes `--owner` / `--targets`; invalid owners (including explicit empty `--owner ""`) are rejected.
- Doctor sanitizes C0+C1 controls (including CR/LF/tab) and requires `package-lock.json` to be a regular file.
- `packnpub doctor` checks that README opens with a real install/init command, not just that the file exists.
- Landing page redesigned (brand-first, typed happy-path demo, copy-to-clipboard) and GitHub Pages workflow added.

## 2.0.0

- Contract v1.0.0 + managed `.packnpub/state.json` with SHA-256 tracking of generated files.
- New commands: `check` (PASS/FAIL/HOLD), `diff`, `upgrade` (conflict-safe with backups), `rollback`.
- Cross-platform `scripts/verify-release.mjs` (Node); bash `.sh` kept as a legacy fallback.
- Workflow hardening: pin Actions to commit SHAs; require `environment: release` on publish jobs.
- Docs: `docs/REFERENCE_STANDARD.md`, `docs/MIGRATION.md`, `docs/SECURITY.md`.
- Agent skill at `packnpub/SKILL.md` for repository/release preparation.
- Package major bump from 0.1.0 to 2.0.0.
- Security: managed writes refuse symlinks that resolve outside the project; bin, owner, repo, package name and version are allowlisted before templating; Homebrew `desc`/`license` are Ruby-escaped; GitHub Packages publishes the checksum-verified tarball instead of a rebuild; `verify-release.mjs` rejects unsafe bin names and fetches pinned `publint`/`attw` when they are not installed locally.
- Conformance `check`: SHA pins are read from the `uses:` value (comments can't mask a mutable tag), publish jobs are found by behaviour as well as name, the `release` environment must match exactly, and job-level `write`/`write-all` grants are audited.

## 0.1.0

- `packnpub init`: CI matrix, tag-driven release workflow (npm trusted publishing, GitHub Packages, GitHub Releases, Homebrew), verify script, seed Homebrew formula.
- `packnpub doctor`: readiness checks (including bash availability for verify).
- `packnpub verify`: pre-publish gate with an isolated tarball smoke test; clear error when bash is missing.
- First-release README checklist: public-repo + npm login + trusted publishing notes; ignore local harness dirs in `.gitignore`.
