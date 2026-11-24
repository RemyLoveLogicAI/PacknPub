# PacknPub

[![npm](https://img.shields.io/npm/v/packnpub)](https://www.npmjs.com/package/packnpub)
[![CI](https://github.com/RemyLoveLogicAI/PacknPub/actions/workflows/ci.yml/badge.svg)](https://github.com/RemyLoveLogicAI/PacknPub/actions/workflows/ci.yml)

Add a production-grade release pipeline to any Node package with one command.

```bash
npx packnpub init
```

Or with Homebrew: `brew install RemyLoveLogicAI/tap/packnpub`

## What `init` adds

| File | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Lint, test, build and tarball smoke test on Linux, macOS and Windows, Node 20/22/24 |
| `.github/workflows/release.yml` | On a `v*.*.*` tag: verify, publish to npm with trusted publishing (no tokens), GitHub Packages, a GitHub Release with checksums, and a Homebrew formula bump |
| `scripts/verify-release.sh` | Pre-publish gate you can run locally |
| `scripts/homebrew/<bin>.rb` | Seed formula, copied into your tap on the first release |

It also fills in missing `package.json` fields (`repository`, `files`, `engines`, `publishConfig`, `scripts.verify`) and never overwrites what you set.

Re-running `init` is safe: existing files are skipped unless you pass `--force`.

## Commands

```text
packnpub init      Add CI, release workflow, verify script and Homebrew formula
packnpub doctor    Check the package is ready to publish
packnpub verify    Run the pre-publish gate (pack, install in isolation, smoke test)
```

`init` options: `--yes`, `--owner <name>`, `--targets npm,github-release,github-packages,homebrew`, `--force`, `--dry-run`, `--json`.
It never prompts when stdin is not a terminal or `CI` is set.

`verify` checks: clean git tree, tag matches version, no secret-looking or source files in the tarball, bin shebang, `publint`, `@arethetypeswrong/cli`, and that the packed tarball installs into an empty directory and runs `--version`, `--help` and `init --yes --dry-run`.

## First release checklist

1. Keep the GitHub repo **public** for open packages (npm provenance / trusted publishing expect that for free provenance).
2. Sign in to npm with an account that can publish the package name: `npm login` (do not commit tokens; `E401` means the token is missing or invalid).
3. `npx packnpub init && npx packnpub doctor`
4. `npm run build && npx packnpub verify --skip-tag`
5. First publish by hand — trusted publishing can only be configured after the package exists on npm. `init` sets `publishConfig.provenance: true`, which fails outside CI, so skip provenance for this bootstrap publish: `npm publish --access public --provenance=false` (or temporarily unset `publishConfig.provenance`). Re-enable provenance before the trusted-publisher / release.yml path.
6. On npmjs.com: package Settings → Trusted Publisher → GitHub Actions, workflow `release.yml`, environment `release`.
7. In GitHub: create the `release` environment. For Homebrew, create `<owner>/homebrew-tap` and add a `HOMEBREW_TAP_TOKEN` secret (fine-grained token with write access to that repo only).
8. From then on: `npm version patch && git push --follow-tags` (release.yml publishes via OIDC; no `NPM_TOKEN` secret).

## Uninstall

Delete the files listed above. PacknPub has no runtime dependencies and leaves nothing else behind.

## License

MIT
