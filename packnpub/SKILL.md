---
name: packnpub
description: Prepare a project repository or Node package using PacknPub's release-readiness workflow. Use when a user asks to apply PacknPub, set up a PacknPub-style repository, or prepare an npm package for its release pipeline; adapt the principles for non-Node projects rather than inventing an npm package.
---

# PacknPub repository and release preparation

PacknPub generates release infrastructure for an **existing named Node package**; it does not create Git repositories, application code, a README, tests, or a license. When preparing a different kind of project, use its applicable principles—clear setup, intentional file inclusion, repeatable checks, CI, release boundaries and a content-aware secret review—without claiming the npm generator or verifier was run successfully.

## 1. Inspect before changing anything

- Identify the exact project, its existing repository, remotes, visibility, working-tree changes, package metadata and intended distribution. Check for an existing repository before creating another. Preserve unrelated work and avoid overwriting existing setup.
- Determine whether the deliverable is an npm package with a real importable module or CLI. A static site, research artifact or unpublished application is not automatically an npm package. Do not create a fake entry point to satisfy a smoke test.
- If a remote repository is requested, use the user's specified owner and visibility; if unspecified, choose an appropriate existing owner and private visibility for a new repository. Include only task-relevant files, verify license/provenance and scan file contents as well as names for secrets before any push.
- Preserve the user's requested scope: setting up a repository is not authorization to publish a package, create release tags, enable new credentials, or alter unrelated repositories.

## 2. Apply PacknPub to compatible Node packages

Use an existing trusted `packnpub` executable, or the project's local CLI when available. Start in the package root, where `package.json` has a `name`. Inspect the target project's manifest and scripts first.

```sh
packnpub init --yes --owner <owner> --targets <targets> --dry-run --json
packnpub init --yes --owner <owner> --targets <targets>
# init prints a doctor scorecard; re-check or machine-read with:
packnpub check --local-only --json
packnpub doctor --json
packnpub diff
```

Select only intended targets from `npm,github-release,github-packages,homebrew`; `homebrew` requires `npm`. `init` normally adds CI, a tag-triggered release workflow, `scripts/verify-release.mjs` (plus a legacy `.sh`), `.packnpub/state.json`, and a Homebrew formula only when selected. Existing files are skipped unless `--force`; do not use `--force` without a concrete, reviewed reason.

The current generator fills absent manifest fields, including a default `files` whitelist of `bin`, `dist`, `README.md`, `LICENSE`, Node `>=20`, and `publishConfig` with public access. These defaults can be wrong for the target. Set intentional fields first and review the dry run, generated workflow and exact package contents; do not imply that a private repo is safe to publish because a pipeline exists. The generated release workflow can publish selected targets when a matching version tag is pushed.

## 3. Verify and report

Run the project's relevant lint, tests and build first. For compatible packages, inspect `npm pack --dry-run --json` and run the generated verification script with flags appropriate to the state. `--skip-tag` and `--skip-git` bypass those checks; report them and do not treat that result as a final release gate. The verifier may download tools, create an isolated temporary npm project and run the package's CLI or import it. Its secret check matches **filenames**, not file contents.

For non-Node projects, create only the documentation and automated checks appropriate to the actual artifact. A static UI can have a private development-only Node manifest and CI without an npm release workflow. Verify the real user-facing behavior where feasible and state gaps.

Report repository location, visibility, relevant setup and fresh verification evidence. Distinguish a local commit, a pushed branch, configured CI, passing remote CI and a published release. Preserve existing untracked files, and do not create or push a release tag merely to demonstrate the workflow.
