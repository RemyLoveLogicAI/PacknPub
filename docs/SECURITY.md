# Security Model & Threat Analysis (Contract v1.0.0)

## 1. Threat Model & Controls

| ID | Threat | Normative Mitigation | Automated Verification |
| :--- | :--- | :--- | :--- |
| **TM-01** | Mutable GitHub Action tag hijacking (`@v4` repointed upstream) | Every `uses:` in `ci.yml` and `release.yml` is pinned to a 40-char commit SHA with a `# vX.Y.Z` comment. | `workflow.actions_sha_pinned` check + policy mutation test |
| **TM-02** | Accidental or unauthorized publish on tag push or partial target selection | Every publish job (`npm`, `github-packages`, `github-release`, `homebrew`) requires `environment: release`. Server-side GitHub Required Reviewers + tag rulesets are mandatory. | `workflow.human_approval_environment` check + policy mutation test |
| **TM-03** | Shell injection via `${{ ... }}` or tampered build artifacts | Job outputs are passed via `env:` variables (never interpolated in `run:` scripts). Publish jobs run `sha256sum -c SHA256SUMS.txt` on downloaded artifacts before publishing. | `workflow.artifact_checksum_verified` check + policy mutation test |
| **TM-04** | Silent overwrite of user customizations or path traversal from crafted `package.json` `bin` names | Three-way hash conflict detection against `.packnpub/state.json` halts with unified diff; output paths are confined inside repo root. | Conflicting & invalid fixture suite + path-traversal unit tests |
| **TM-05** | Credential persistence or static token abuse | `persist-credentials: false` on read-only checkouts; OIDC Trusted Publishing for npm (no `NPM_TOKEN`); PR-based Homebrew tap updates instead of direct `main` push. | Workflow policy checks + static audit (`actionlint` / `zizmor`) |

## 2. Human Approval Enforcement Requirements

Workflow YAML alone cannot enforce human approval without repository configuration:

1. In GitHub **Settings → Environments → `release`**, enable **Required reviewers** and add authorized release maintainers.
2. Enable **Prevent self-review** where team size permits, and restrict **Deployment branches and tags** to `v*.*.*`.
3. Configure a **Tag ruleset** restricting `v*.*.*` tag creation to maintainers.
4. **Plan note:** On GitHub Free/Pro plans, Environment Required Reviewers are available on **public** repositories; private repositories require GitHub Team/Enterprise or an equivalent external approval gate.

Because local CLI checks cannot query GitHub repository settings offline, `external.github_environment_reviewers` always reports `UNKNOWN` (resulting in a `HOLD` verdict unless `--local-only` is explicitly requested for offline CI).

## 3. PyPI Policy (Deliberate v1 Non-Goal)

PacknPub v1.0.0 deliberately excludes PyPI publishing:
- Node.js + Homebrew is the active portfolio release surface and requires full end-to-end hardening first.
- Supporting PyPI safely requires a separate manifest parser (`pyproject.toml` per PEP 621), isolated `sdist` + `wheel` verification (`twine check`), and PyPI Trusted Publishers (OIDC) behind the same human-approved environment gate.
- Until explicitly authorized and tested as a separate adapter, `--targets pypi` returns a deterministic `UNSUPPORTED_ECOSYSTEM` error.

## 4. Failure & Incident Recovery

- **Failed local upgrade:** Run `npx packnpub rollback` to restore the latest pre-upgrade snapshot from `.packnpub/backups/`.
- **Denied or failed release approval:** No artifact is published; delete or supersede the tag only after fixing the root cause and re-running `verify`.
- **Suspected credential or action compromise:** Revoke fine-grained `HOMEBREW_TAP_TOKEN`, rotate pinned action SHAs via reviewed PR, and audit npm provenance attestations with `npm audit signatures`.
