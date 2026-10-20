#!/usr/bin/env bash
# Build a signed flat apt repository (for GitHub Pages) from a folder of agent-kit .deb files.
#   packaging/build-apt-repo.sh <debs-dir> <site-dir>
# Signs with GPG_KEY_ID (default: the first secret key in the keyring); GPG_PASSPHRASE if the key
# has one. ALLOW_UNSIGNED=1 builds without signing (tests only: apt refuses unsigned repos).
# APT_REPO_URL: where the site is served (default https://ltdsword.github.io/agent-kit).
# Users add it with: curl -fsSL $APT_REPO_URL/setup.sh | sudo sh
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <debs-dir> <site-dir>" >&2; exit 2; }
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd -P)"
DEBS="$1" SITE="$2"
URL="${APT_REPO_URL:-https://ltdsword.github.io/agent-kit}"
ls "$DEBS"/*.deb >/dev/null 2>&1 || { echo "error: no .deb files in $DEBS" >&2; exit 1; }

rm -rf "$SITE"
mkdir -p "$SITE"
cp "$DEBS"/*.deb "$SITE/"
(
  cd "$SITE"
  dpkg-scanpackages --multiversion . /dev/null 2>/dev/null > Packages
  gzip -9kn Packages
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=agent-kit \
    -o APT::FTPArchive::Release::Label=agent-kit \
    -o APT::FTPArchive::Release::Description="agent-kit apt repository" \
    release . > Release
)

if [ "${ALLOW_UNSIGNED:-0}" != 1 ]; then
  KEY="${GPG_KEY_ID:-$(gpg --batch --list-secret-keys --with-colons | awk -F: '$1=="fpr"{print $10; exit}')}"
  [ -n "$KEY" ] || { echo "error: no GPG secret key to sign with (set GPG_KEY_ID)" >&2; exit 1; }
  sign=(gpg --batch --yes --local-user "$KEY")
  [ -z "${GPG_PASSPHRASE:-}" ] || sign+=(--pinentry-mode loopback --passphrase "$GPG_PASSPHRASE")
  "${sign[@]}" --clearsign -o "$SITE/InRelease" "$SITE/Release"
  "${sign[@]}" --armor --detach-sign -o "$SITE/Release.gpg" "$SITE/Release"
  gpg --batch --export "$KEY" > "$SITE/agent-kit.gpg"
fi

sed "s|@URL@|$URL|g" "$HERE/setup.sh" > "$SITE/setup.sh"
cat > "$SITE/index.html" <<EOF
<!doctype html><meta charset="utf-8"><title>agent-kit apt repository</title>
<h1>agent-kit apt repository</h1>
<pre>curl -fsSL $URL/setup.sh | sudo sh
sudo apt install agent-kit</pre>
<p><a href="https://github.com/ltdsword/agent-kit">github.com/ltdsword/agent-kit</a></p>
EOF
echo "apt repository in $SITE ($(ls "$SITE"/*.deb | wc -l) package file(s))"
