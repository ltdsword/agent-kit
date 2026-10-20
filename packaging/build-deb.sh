#!/usr/bin/env bash
# Build agent-kit_<version>_all.deb from the last commit (git archive: untracked or uncommitted
# files never ship).
#   packaging/build-deb.sh [version] [out-dir]
# version: default from the latest v* tag (v0.2.0 -> 0.2.0), else 0.0.0~git<hash>.
# out-dir: default dist/. MAINTAINER overrides the package's Maintainer field.
# Layout: the kit in /usr/share/agent-kit, /usr/bin/agent-kit -> its install.sh (the script finds
# the kit by following its own symlink, so no code changes are needed).
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd -P)"
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(git -C "$ROOT" describe --tags --match 'v[0-9]*' 2>/dev/null | sed 's/^v//; s/-/+/; s/-/./')" \
    || true
  [ -n "$VERSION" ] || VERSION="0.0.0~git$(git -C "$ROOT" rev-parse --short HEAD)"
fi
VERSION="${VERSION#v}"
[[ "$VERSION" =~ ^[0-9][A-Za-z0-9.+~-]*$ ]] || { echo "error: bad version '$VERSION'" >&2; exit 2; }
OUT="$(mkdir -p "${2:-$ROOT/dist}" && cd "${2:-$ROOT/dist}" && pwd -P)"
MAINTAINER="${MAINTAINER:-ltdsword <ltdsword@users.noreply.github.com>}"
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] \
  || echo "warning: uncommitted changes are not packaged (building from HEAD)" >&2

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
pkg="$stage/agent-kit"
mkdir -p "$pkg/DEBIAN" "$pkg/usr/bin" "$pkg/usr/share/agent-kit" "$pkg/usr/share/doc/agent-kit"
git -C "$ROOT" archive HEAD .agent-system .claude/agents/scout.md README.md LICENSE \
  | tar -x -C "$pkg/usr/share/agent-kit"
ln -s ../share/agent-kit/.agent-system/scripts/install.sh "$pkg/usr/bin/agent-kit"
cp "$ROOT/LICENSE" "$pkg/usr/share/doc/agent-kit/copyright"
chmod -R u+rwX,go+rX,go-w "$pkg"   # 644/755 whatever the umask

cat > "$pkg/DEBIAN/control" <<EOF
Package: agent-kit
Version: $VERSION
Architecture: all
Maintainer: $MAINTAINER
Installed-Size: $(du -sk "$pkg/usr" | cut -f1)
Depends: bash, git, python3 (>= 3.11)
Suggests: herdr
Section: devel
Priority: optional
Homepage: https://github.com/ltdsword/agent-kit
Description: multi-agent coding orchestration kit (orchestrator, scout, workers)
 agent-kit sets up an AI workspace next to a Git repo: an orchestrator plans and reviews, a
 read-only scout researches, and workers implement in Git worktrees, coordinated by a scheduler.
 The agent programs (Claude Code, Codex CLI) and the Herdr multiplexer are installed separately.
EOF

deb="$OUT/agent-kit_${VERSION}_all.deb"
dpkg-deb --root-owner-group -Zxz --build "$pkg" "$deb" >/dev/null
echo "$deb"
