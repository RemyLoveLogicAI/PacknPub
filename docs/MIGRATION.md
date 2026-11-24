# Versioning, Compatibility & Migration Guide

## 1. Contract & Template Versioning

PacknPub versions its normative contract (`contractVersion`) and template set (`templateVersion`) independently from the CLI package version, recording both in `.packnpub/state.json`:

```json
{
  "schemaVersion": 1,
  "contractVersion": "1.0.0",
  "templateVersion": "1.0.0",
  "targets": ["npm", "github-release", "github-packages", "homebrew"],
  "owner": "RemyLoveLogicAI",
  "repo": "PacknPub",
  "managedFiles": {
    ".github/workflows/ci.yml": { "sha256": "<hash>", "template": "workflows/ci.yml" }
  }
}
```

## 2. Compatibility Matrix

| Source Project State | Target Contract | Migration Path | Conflict Behavior |
| :--- | :--- | :--- | :--- |
| Clean Node repo (no PacknPub files) | `1.0.0` | `npx packnpub init --yes` | Halts if any target path already exists unmanaged |
| Legacy unversioned PacknPub (`0.1.0` / `2.0.0`, no `.packnpub/state.json`) | `1.0.0` | `npx packnpub upgrade --dry-run` → `npx packnpub upgrade` | Treats existing files as user-owned; halts with unified diff unless `--force` is explicitly passed |
| Versioned PacknPub (`1.0.0` with `.packnpub/state.json`) | `1.0.0+` | `npx packnpub diff` → `npx packnpub upgrade --dry-run` → `npx packnpub upgrade` | Updates unmodified managed files automatically; halts on any locally modified file |

## 3. Safe Upgrade & Rollback Workflow

```bash
# 1. Inspect drift and preview unified diffs
npx packnpub diff

# 2. Dry-run upgrade (mutates nothing; exits non-zero if conflicts exist)
npx packnpub upgrade --dry-run

# 3. Apply upgrade (creates atomic backup in .packnpub/backups/<timestamp>)
npx packnpub upgrade

# 4. Roll back to the most recent backup snapshot if needed
npx packnpub rollback
```

## 4. Conflict Semantics

- PacknPub **never** silently overwrites a file whose current SHA-256 differs from `.packnpub/state.json` (or an existing unmanaged file with no state entry).
- When a conflict is detected, `upgrade` exits with status `1`, prints the conflicting paths and unified diffs, and leaves the working tree untouched.
- Passing `--force` explicitly records a backup snapshot before overwriting, so `packnpub rollback` can still restore the prior state atomically.
