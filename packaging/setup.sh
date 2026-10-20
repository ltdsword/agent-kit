#!/bin/sh
# Add the agent-kit apt repository (Debian, Ubuntu, and Ubuntu on Windows WSL):
#   curl -fsSL @URL@/setup.sh | sudo sh
#   sudo apt install agent-kit
set -eu
URL="@URL@"
[ "$(id -u)" -eq 0 ] || { echo "run with sudo: curl -fsSL $URL/setup.sh | sudo sh" >&2; exit 1; }
mkdir -p /usr/share/keyrings
curl -fsSL "$URL/agent-kit.gpg" -o /usr/share/keyrings/agent-kit.gpg
chmod 644 /usr/share/keyrings/agent-kit.gpg
echo "deb [signed-by=/usr/share/keyrings/agent-kit.gpg] $URL ./" > /etc/apt/sources.list.d/agent-kit.list
apt-get update
echo "agent-kit repository added. Install with: sudo apt install agent-kit"
