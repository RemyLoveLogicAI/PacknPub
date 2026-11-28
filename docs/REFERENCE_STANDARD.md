# PacknPub Reference Packaging Standard (Contract v1.0.0)

PacknPub is a versioned, evidence-backed reference packaging standard and CLI for Node.js packages targeting npm, GitHub Releases, GitHub Packages, and Homebrew. It is designed to be adopted safely on **existing repositories** without silently overwriting local decisions.

## 1. Supported Runtimes & Scope

- **Supported ecosystems:** `node-npm` (Node.js >= 20) and `homebrew-tap` (derived from the verified npm tarball).
- **Deliberate non-goal (v1):** **PyPI / Python** is explicitly out of scope in Contract v1.0.0. Passing `--targets pypi` fails with `UNSUPPORTED_ECOSYSTEM` rather than silently succeeding or generating unverified workflows. See [SECURITY.md](./SECURITY.md) for revisit criteria.
- **Authoritative manifest:** `package.json` is the single source of truth for `name`, `version`, `bin`, `exports`, `files` allowlist, `repository`, `engines`, and `license`. Derived files (such as `scripts/homebrew/<bin>.rb`) must never silently drift from `package.json`.

## 2. Reproducible Quickstart

```bash
# 1. Preview changes and unified diffs without writing any files
npx packnpub init --yes --dry-run

# 2. Initialize managed templates and record .packnpub/state.json
npx packnpub init --yes

# 3. Run machine-readable conformance gate (PASS / FAIL / HOLD)
npx packnpub check --json

# 4. Run cross-platform pre-publish verification (build, pack, isolated install smoke test)
npm run build
npx packnpub verify --skip-tag
```

## 3. Lifecycle: Build → Test → Verify → Approve → Release

1. **Build & Test (`ci.yml`):** Runs `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm run check:pkg` (`publint` + `@arethetypeswrong/cli`), and the cross-platform tarball smoke test (`node scripts/verify-release.mjs --skip-git --skip-tag`) across Linux, macOS, and Windows (Node 20, 22, 24).
2. **Verify (`release.yml` `verify` job):** Triggered on `v*.*.*` tags. Confirms git tag matches `package.json` version, runs the full verify gate, packs the tarball, generates `SHA256SUMS.txt`, and uploads both as immutable workflow artifacts.
3. **Human Approval Gate:** Every publish job (`npm`, `github-packages`, `github-release`, `homebrew`) is bound to `environment: release`. Server-side GitHub Environment **Required Reviewers** must explicitly approve before any publish job executes. **A passed verification or conformance gate never authorizes publication.**
4. **Release:**
   - **npm:** Downloads verified artifact, validates `sha256sum -c SHA256SUMS.txt`, and publishes via OIDC Trusted Publishing with SLSA provenance (`--provenance --access public`) without any `NPM_TOKEN` secret.
   - **GitHub Packages & GitHub Releases:** Verifies `SHA256SUMS.txt` and publishes using job-scoped `GITHUB_TOKEN`.
   - **Homebrew:** Computes SHA-256 of the published npm tarball and opens a pull request against `<owner>/homebrew-tap` rather than pushing directly to `main`.

## 4. Package File Allowlists, Checksums & Provenance

- **Allowlist-first packaging:** Always define `"files"` in `package.json` (never rely on `.npmignore` denylists). `verify-release.mjs` fails if secret-like filenames (`.env`, `.npmrc`, `*.pem`, `*.key`, `id_rsa`) or source/CI directories (`src/`, `tests/`, `.github/`, `node_modules/`) appear in `npm pack --dry-run --json`.
- **Integrity & provenance:** Tarballs are paired with `SHA256SUMS.txt` in CI artifacts and GitHub Releases; npm publishes emit signed SLSA provenance attestations via Sigstore OIDC; Homebrew formulae pin the immutable tarball URL and SHA-256 checksum.

## 5. Conformance Gate Semantics (`packnpub check`)

`packnpub check --json` outputs machine-readable evidence per check (`PASS`, `FAIL`, or `UNKNOWN`) plus a top-level verdict:

| Verdict | Exit Code | Rule |
| :--- | :--- | :--- |
| `PASS` | `0` | Every mandatory check in scope is `PASS`. (Still sets `publishAuthorized: false`.) |
| `FAIL` | `1` | One or more mandatory checks are `FAIL`. |
| `HOLD` | `2` | Zero mandatory `FAIL`s, but one or more mandatory checks are `UNKNOWN` (e.g., server-side GitHub Environment reviewers cannot be verified offline). |

Use `--local-only` during offline CI to evaluate local + workflow checks without counting external server-side checks as `HOLD` (external checks remain explicitly reported as `UNKNOWN`).

## 6. Accessibility & CLI Usability

- **Non-interactive safety:** Automatically disables prompts when `!stdin.isTTY`, `CI` is set, `--yes` is passed, or `--json` is passed.
- **No color-only status:** Every CLI status line uses explicit text tokens (`PASS`, `FAIL`, `WARN`, `HOLD`, `UNKNOWN`) suitable for screen readers, logs, and piping.
- **Deterministic diffs & repair:** `packnpub diff` and `packnpub upgrade --dry-run` print unified diffs before any write; every failing check includes an actionable remediation hint.

## 7. Standards Comparison & Rationale

| Concern | Chosen Standard | Reference | Why It Fits PacknPub |
| :--- | :--- | :--- | :--- |
| Package allowlist | `package.json` `"files"` allowlist | [npm package.json docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) | Fails closed; prevents local harness/secret files from leaking into tarballs. |
| npm authentication | OIDC Trusted Publishing | [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/) | Eliminates long-lived `NPM_TOKEN` secrets and binds publish to repo, workflow, and environment. |
| Build attestation | SLSA Provenance via Sigstore | [npm Provenance Statements](https://docs.npmjs.com/generating-provenance-statements/) | Cryptographically ties tarball to commit SHA and GitHub Actions workflow. |
| Workflow supply chain | 40-char commit SHA pinning + `actionlint`/`zizmor` | [GitHub Actions Secure Use](https://docs.github.com/en/actions/reference/security/secure-use), [actionlint](https://github.com/rhysd/actionlint), [zizmor](https://zizmor.sh/) | Prevents mutable-tag hijacking and catches script injection / excessive scopes statically. |
| Human approval | GitHub Deployment Environment Required Reviewers | [GitHub Deployments & Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) | Enforces server-side human approval independent of tag creation or test success. |
| Homebrew integrity | Immutable archive URL + SHA-256 checksum | [Homebrew Checksum Requirements](https://docs.brew.sh/Checksum-Requirements) | Enforces verified artifact integrity for tap users. |
| Python (v1 non-goal) | PEP 621 `pyproject.toml` + PyPI Trusted Publishers | [PyPA pyproject.toml spec](https://packaging.python.org/en/latest/specifications/pyproject-toml/), [PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/) | Documented reference standard if an owner-approved v2 Python adapter is added later. |
