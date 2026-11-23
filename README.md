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
After writing files, `init` runs `doctor` and prints a scorecard — when everything passes, commit the scaffold (build first if needed), then run `npx packnpub verify --skip-tag` (or add `--skip-git` for an initial check on a dirty tree).

## Commands

```text
packnpub init      Add CI, release workflow, verify script and Homebrew formula; prints a doctor scorecard
packnpub doctor    Check the package is ready to publish
packnpub verify    Run the pre-publish gate (pack, install in isolation, smoke test)
```

`init` options: `--yes`, `--owner <name>`, `--targets npm,github-release,github-packages,homebrew`, `--force`, `--dry-run`, `--json`.
It never prompts when stdin is not a terminal or `CI` is set.

`verify` checks: clean git tree, tag matches version, no secret-looking or source files in the tarball, bin shebang, `publint`, `@arethetypeswrong/cli`, and that the packed tarball installs into an empty directory and runs `--version`, `--help` and `init --yes --dry-run`.

## First release checklist

1. `npx packnpub init && npx packnpub doctor`
2. Commit the generated files, then `npm run build && npx packnpub verify --skip-tag` (use `--skip-git` only for a throwaway initial check)
3. First publish by hand (npm needs the package to exist before trusted publishing can be set up): `npm publish --access public`
4. On npmjs.com: package Settings → Trusted Publisher → GitHub Actions, workflow `release.yml`, environment `release`.
5. In GitHub: create the `release` environment. For Homebrew, create `<owner>/homebrew-tap` and add a `HOMEBREW_TAP_TOKEN` secret (fine-grained token with write access to that repo only).
6. From then on: `npm version patch && git push --follow-tags`.

## Uninstall

Delete the files listed above. PacknPub has no runtime dependencies and leaves nothing else behind.

## License

MIT
