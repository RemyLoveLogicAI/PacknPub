# PacknPub

[![npm](https://img.shields.io/npm/v/packnpub)](https://www.npmjs.com/package/packnpub)
[![CI](https://github.com/RemyLoveLogicAI/PacknPub/actions/workflows/ci.yml/badge.svg)](https://github.com/RemyLoveLogicAI/PacknPub/actions/workflows/ci.yml)

Evidence-backed release standard for Node packages: npm, GitHub Releases, GitHub Packages, and Homebrew.

```bash
npx packnpub init --yes
```

Or with Homebrew: `brew install RemyLoveLogicAI/tap/packnpub`

## What `init` adds

| File | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Lint, test, build and cross-platform tarball smoke test (Linux/macOS/Windows × Node 20/22/24) |
| `.github/workflows/release.yml` | Tag `v*.*.*` → verify → npm (OIDC) → GitHub Packages → GitHub Release + checksums → Homebrew bump |
| `scripts/verify-release.mjs` | Cross-platform pre-publish gate (Node; no bash required) |
| `scripts/verify-release.sh` | Legacy bash gate kept for older adopters |
| `scripts/homebrew/<bin>.rb` | Seed formula, copied into your tap on first release |
| `.packnpub/state.json` | Contract/template versions and SHA-256 of managed files |

It also fills in missing `package.json` fields (`repository`, `files`, `engines`, `publishConfig`, `scripts.verify`) and never overwrites what you set.

Re-running `init` is safe: existing files are skipped unless you pass `--force`.
After writing files, `init` runs `doctor` and prints a scorecard — when everything passes, run `npm run build` if `files` includes `dist`, commit the scaffold, then `npx packnpub verify --skip-tag` (or add `--skip-git` for an initial check on a dirty tree). A missing `package-lock.json` is a FAIL: create it with `npm install` before verify.

## Commands

```text
packnpub init      Add CI, release workflow, verify scripts, Homebrew formula and state; prints a doctor scorecard
packnpub check     Machine-readable conformance gate (PASS / FAIL / HOLD)
packnpub doctor    Local readiness and workflow hardening checks
packnpub diff      Preview unified diffs and drift against the current contract
packnpub upgrade   Safely upgrade managed templates (halts on conflicts; backs up first)
packnpub rollback  Restore the latest pre-upgrade backup snapshot
packnpub verify    Pre-publish gate (pack, isolated install, smoke test)
```

`init` options: `--yes`, `--owner <name>`, `--targets npm,github-release,github-packages,homebrew`, `--force`, `--dry-run`, `--json`.
Never prompts when stdin is not a TTY or `CI` is set. `homebrew` requires `npm`.

Docs: [REFERENCE_STANDARD.md](docs/REFERENCE_STANDARD.md), [MIGRATION.md](docs/MIGRATION.md), [SECURITY.md](docs/SECURITY.md).

## First release checklist

1. Keep the GitHub repo **public** for open packages (npm provenance / trusted publishing expect that for free provenance).
2. Sign in to npm with an account that can publish the package name: `npm login` (do not commit tokens; `E401` means the token is missing or invalid).
3. `npx packnpub init && npx packnpub check --local-only && npx packnpub doctor`
4. Ensure `package-lock.json` exists, commit the generated files, then `npm run build && npx packnpub verify --skip-tag` (use `--skip-git` only for a throwaway initial check)
5. First publish by hand — trusted publishing can only be configured after the package exists on npm. `init` sets `publishConfig.provenance: true`, which fails outside CI, so skip provenance for this bootstrap publish: `npm publish --access public --provenance=false` (or temporarily unset `publishConfig.provenance`). Re-enable provenance before the trusted-publisher / release.yml path.
6. On npmjs.com: package Settings → Trusted Publisher → GitHub Actions, workflow `release.yml`, environment `release`.
7. In GitHub: create the `release` environment. For Homebrew, create `<owner>/homebrew-tap` and add a `HOMEBREW_TAP_TOKEN` secret (fine-grained token with write access to that repo only).
8. From then on: `npm version patch && git push --follow-tags` (release.yml publishes via OIDC; no `NPM_TOKEN` secret).

A passing verify gate does **not** authorize publish. Publish still needs an explicit human “yes”.

## Uninstall

Delete the files listed above and `.packnpub/`. PacknPub has no runtime dependencies.

## License

MIT
