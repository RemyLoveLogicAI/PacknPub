#!/usr/bin/env bash
# Pre-publish gate for npm packages. Run from the package root after building.
# Flags: --skip-git (allow a dirty tree, for CI), --skip-tag (no tag/version check)
set -euo pipefail

SKIP_GIT=0
SKIP_TAG=0
for arg in "$@"; do
  case "$arg" in
    --skip-git) SKIP_GIT=1 ;;
    --skip-tag) SKIP_TAG=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
pkg() { node -p "const p=require('./package.json'); $1"; }

[ -f package.json ] || fail "no package.json in $(pwd)"
NAME=$(pkg "p.name")
VERSION=$(pkg "p.version")
BIN=$(pkg "const b=p.bin; !b ? '' : typeof b==='string' ? p.name.split('/').pop() : Object.keys(b)[0]")

if [ "$SKIP_GIT" = 0 ]; then
  [ -z "$(git status --porcelain)" ] || fail "working tree is dirty (commit, stash, or pass --skip-git)"
  ok "clean git tree"
fi

if [ "$SKIP_TAG" = 0 ]; then
  TAG=${GITHUB_REF_NAME:-$(git describe --tags --exact-match 2>/dev/null || true)}
  [ -n "$TAG" ] || fail "HEAD has no tag (pass --skip-tag before tagging)"
  [ "$TAG" = "v$VERSION" ] || fail "tag $TAG != package.json v$VERSION"
  ok "tag $TAG matches version"
fi

if [ "$(pkg "(p.files||[]).includes('dist')")" = true ]; then
  [ -d dist ] || fail "dist/ missing; run the build first"
fi

FILES=$(npm pack --dry-run --json 2>/dev/null | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const j = JSON.parse(s);
  (Array.isArray(j) ? j[0] : Object.values(j)[0]).files.forEach((f) => console.log(f.path));
});')
SECRETS='(^|/)(\.env|\.npmrc|id_rsa|[^/]*\.pem|[^/]*\.key|credentials|secrets?\.)'
if echo "$FILES" | grep -Eiq "$SECRETS"; then
  echo "$FILES" | grep -Ei "$SECRETS" >&2
  fail "secret-looking files in the pack"
fi
if echo "$FILES" | grep -Eq '^(src|tests?|node_modules|\.github)/'; then
  fail "source, test, or CI files in the pack; tighten \"files\" in package.json"
fi
ok "pack contents ($(echo "$FILES" | wc -l | tr -d ' ') files)"

if [ -n "$BIN" ]; then
  ENTRY=$(pkg "const b=p.bin; typeof b==='string' ? b : Object.values(b)[0]")
  head -1 "$ENTRY" | grep -q '^#!/usr/bin/env node' || fail "$ENTRY is missing #!/usr/bin/env node"
  ok "shebang in $ENTRY"
fi

npx --yes publint >/dev/null || fail "publint (run: npx publint)"
ok "publint"
if [ "$(pkg "Boolean(p.exports)")" = true ]; then
  PROFILE=node16
  [ "$(pkg "JSON.stringify(p.exports).includes('require')")" = true ] || PROFILE=esm-only
  npx --yes @arethetypeswrong/cli --pack . --profile "$PROFILE" >/dev/null || fail "attw (run: npx @arethetypeswrong/cli --pack . --profile $PROFILE)"
  ok "attw ($PROFILE)"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
TARBALL=$(npm pack --silent --pack-destination "$TMP")
(
  cd "$TMP"
  npm init -y >/dev/null
  npm install --silent --no-audit --no-fund "./$TARBALL" >/dev/null
  if [ -n "$BIN" ]; then
    npx --no-install "$BIN" --version | grep -q "$VERSION" || exit 12
    HELP=$(npx --no-install "$BIN" --help) || exit 13
    if echo "$HELP" | grep -q '\binit\b'; then
      CI=true npx --no-install "$BIN" init --yes --dry-run >/dev/null || exit 14
    fi
  else
    node --input-type=module -e "await import('$NAME')" || exit 11
  fi
) || fail "tarball smoke test (step exit $?: 11 import, 12 --version, 13 --help, 14 init)"
ok "tarball installs and runs in isolation"

echo "PASS: $NAME@$VERSION is ready to publish"
