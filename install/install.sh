#!/bin/sh
# Installs the agent of the Steuerzentrale on a new server (docs/server-hinzufuegen.md, BAULISTE.md
# Z-302). The Zentrale serves this script under agent.<domain>/install.sh with its own address and
# the public key that signs agent binaries and manifests filled in; the interface shows the command:
#
#   curl -fsSL https://agent.<domain>/install.sh | sudo sh -s -- --token <one-time token>
#
# It checks the system (Debian 13 or Ubuntu 24.04, amd64 or arm64, cgroup v2, the clock), installs
# Podman (4.9 or later), minisign and unattended-upgrades, loads the agent and checks its checksum
# against the minisign signature, lets rootless services bind ports from 80, keeps the manifest key
# and sets the agent up as a systemd service, which exchanges the token for its client certificate.
# Running it again on a joined server changes nothing but the binary, the packages and the unit.
#
# With SZ_INSTALL_NUR_LADEN=1 sourcing it only defines the functions (scripts/install-sh.test.ts).
set -eu

ZENTRALE='@ZENTRALE@'
SCHLUESSEL='@SCHLUESSEL@'
# The public test key (test/schluessel/): accepted only with --testmodus (docs/plan.md, "Signaturen
# in Tests")
TEST_SCHLUESSEL='RWRIyXK5ooYVPbx8wak0UtxTTy6wWLdKm1lGfSg8ZJudL8LJxj7pxXFU'
PODMAN_MINDESTENS='4.9'
# More apart than this from the Zentrale's clock, certificates and signatures would be judged wrong
MAX_ABWEICHUNG_S=60
BINARY=/usr/local/bin/steuerzentrale-agent
KONFIG=/etc/steuerzentrale
ZUSTAND=/var/lib/steuerzentrale
UNIT=/etc/systemd/system/steuerzentrale-agent.service

meldung() { printf 'steuerzentrale: %s\n' "$*" >&2; }
abbruch() {
	meldung "$*"
	exit 1
}

argumente_lesen() {
	TOKEN=''
	TESTMODUS=0
	while [ $# -gt 0 ]; do
		case "$1" in
		--token)
			[ $# -ge 2 ] || abbruch "--token needs a value"
			TOKEN=$2
			shift 2
			;;
		--zentrale)
			[ $# -ge 2 ] || abbruch "--zentrale needs a value"
			ZENTRALE=$2
			shift 2
			;;
		--testmodus)
			TESTMODUS=1
			shift
			;;
		*) abbruch "unknown argument: $1" ;;
		esac
	done
	printf '%s' "$TOKEN" | grep -Eqx '[A-Za-z0-9_-]{20,200}' ||
		abbruch "--token is missing or is no one-time token of the Zentrale"
}

# The key this script was served with, and the test key only in test mode; outside it the Zentrale
# is reached over https only, so neither the token nor the binary travels openly
schluessel_pruefen() {
	printf '%s' "$SCHLUESSEL" | grep -Eqx 'RW[A-Za-z0-9+/]{54}' ||
		abbruch "this script carries no public key: the Zentrale serves it without its agent files"
	if [ "$TESTMODUS" != 1 ]; then
		[ "$SCHLUESSEL" != "$TEST_SCHLUESSEL" ] ||
			abbruch "the Zentrale signs with the public test key; that is for tests only (--testmodus)"
		case "$ZENTRALE" in
		https://*) ;;
		*) abbruch "the Zentrale must be reached over https, not $ZENTRALE" ;;
		esac
	fi
	CURL_PROTOKOLLE='=https'
	[ "$TESTMODUS" != 1 ] || CURL_PROTOKOLLE='=https,http'
}

os_feld() { sed -n "s/^$1=//p" /etc/os-release | tr -d '"'; }

system_pruefen() {
	[ "$(id -u)" = 0 ] || abbruch "run as root (sudo sh)"
	[ -r /etc/os-release ] || abbruch "/etc/os-release is missing"
	system="$(os_feld ID):$(os_feld VERSION_ID)"
	case "$system" in
	debian:13 | ubuntu:24.04) ;;
	*) abbruch "Debian 13 or Ubuntu 24.04 needed, this is $system" ;;
	esac
	case "$(uname -m)" in
	x86_64) ARCH=x64 ;;
	aarch64 | arm64) ARCH=arm64 ;;
	*) abbruch "amd64 or arm64 needed, this is $(uname -m)" ;;
	esac
	# Rootless Podman limits memory and processes only on the unified hierarchy (cgroup v2)
	[ -f /sys/fs/cgroup/cgroup.controllers ] || abbruch "cgroup v2 (unified hierarchy) needed"
	for controller in cpu memory pids; do
		grep -qw "$controller" /sys/fs/cgroup/cgroup.controllers ||
			abbruch "the cgroup controller $controller is missing"
	done
}

uhrzeit_pruefen() {
	datum=$(curl -fsS --proto "$CURL_PROTOKOLLE" -D - -o /dev/null "$ZENTRALE/health" |
		tr -d '\r' | sed -n 's/^[Dd]ate: //p' | head -n 1)
	[ -n "$datum" ] || abbruch "the Zentrale at $ZENTRALE does not answer with its time"
	abweichung=$(($(date -u +%s) - $(date -u -d "$datum" +%s)))
	[ "${abweichung#-}" -le "$MAX_ABWEICHUNG_S" ] ||
		abbruch "the clock is ${abweichung}s off the Zentrale's; set it (NTP) and run again"
}

pakete_installieren() {
	meldung "installing Podman, minisign and unattended-upgrades"
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -q >/dev/null
	apt-get install -y -q podman uidmap dbus-user-session minisign unattended-upgrades \
		ca-certificates curl >/dev/null
	version=$(podman --version | sed -n 's/^podman version //p')
	dpkg --compare-versions "$version" ge "$PODMAN_MINDESTENS" ||
		abbruch "Podman $PODMAN_MINDESTENS or later needed, this is $version"
	# Security updates on their own; reboots only in the maintenance window (docs/plan.md, OS-Updates)
	cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

# Rootless Podman under a user's systemd needs these controllers delegated (podman-systemd.unit(5)
# with rootless cgroups v2); systemd delegates only memory and pids to user@.service by default
delegation_einrichten() {
	mkdir -p /etc/systemd/system/user@.service.d
	cat >/etc/systemd/system/user@.service.d/steuerzentrale-delegate.conf <<'EOF'
[Service]
Delegate=cpu cpuset io memory pids
EOF
	systemctl daemon-reload
	delegiert=$(systemctl show -p DelegateControllers --value user@0.service)
	for controller in cpu memory pids; do
		printf '%s\n' "$delegiert" | grep -qw "$controller" ||
			abbruch "systemd does not delegate $controller to user services ($delegiert)"
	done
}

agent_laden() {
	for datei in SHA256SUMS SHA256SUMS.minisig "steuerzentrale-agent-linux-$ARCH"; do
		curl -fsSL --proto "$CURL_PROTOKOLLE" -o "$1/$datei" "$ZENTRALE/agent/$datei" ||
			abbruch "cannot load $datei from $ZENTRALE"
	done
}

# The checksums must carry a valid signature of the key above, and the binary its checksum there
agent_pruefen() {
	geladen=$1
	datei="steuerzentrale-agent-linux-$2"
	minisign -V -q -P "$SCHLUESSEL" -m "$geladen/SHA256SUMS" -x "$geladen/SHA256SUMS.minisig" ||
		abbruch "the signature of SHA256SUMS does not hold: the agent is not installed"
	zeile=$(grep -E "^[0-9a-f]{64}  $datei\$" "$geladen/SHA256SUMS") ||
		abbruch "SHA256SUMS has no checksum for $datei"
	(cd "$geladen" && printf '%s\n' "$zeile" | sha256sum -c --status) ||
		abbruch "the checksum of $datei does not match: the agent is not installed"
}

server_einrichten() {
	# The Pforte (Caddy, rootless) takes 80 and 443 (docs/plan.md, Pforte)
	printf 'net.ipv4.ip_unprivileged_port_start=80\n' >/etc/sysctl.d/90-steuerzentrale.conf
	sysctl -q -p /etc/sysctl.d/90-steuerzentrale.conf
	install -d -m 0700 "$ZUSTAND"
}

# A server keeps the key it trusts: a Zentrale cannot swap it by having the script run again
manifest_schluessel_ablegen() {
	if [ -f "$1" ]; then
		grep -qxF "$SCHLUESSEL" "$1" || abbruch "$1 holds another key than this Zentrale's; nothing changed"
		return
	fi
	printf 'untrusted comment: public key for the manifests of the Steuerzentrale\n%s\n' \
		"$SCHLUESSEL" >"$1"
}

beitreten() {
	if [ -f "$ZUSTAND/agent.pem" ] && [ -f "$KONFIG/agent.json" ]; then
		meldung "the server has joined already; the token stays unused"
		return
	fi
	if [ "$TESTMODUS" = 1 ]; then
		printf '%s\n' "$TOKEN" | "$BINARY" beitreten --zentrale "$ZENTRALE" --testmodus
	else
		printf '%s\n' "$TOKEN" | "$BINARY" beitreten --zentrale "$ZENTRALE"
	fi
}

dienst_einrichten() {
	cat >"$UNIT" <<EOF
[Unit]
Description=Agent of the Steuerzentrale
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=$BINARY dienst
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
	systemctl enable -q steuerzentrale-agent.service
	systemctl restart steuerzentrale-agent.service
	sleep 2
	systemctl is-active -q steuerzentrale-agent.service ||
		abbruch "the agent's service does not run: journalctl -u steuerzentrale-agent"
}

main() {
	argumente_lesen "$@"
	schluessel_pruefen
	system_pruefen
	install -d -m 0755 "$KONFIG"
	manifest_schluessel_ablegen "$KONFIG/manifest.pub"
	uhrzeit_pruefen
	pakete_installieren
	delegation_einrichten
	ordner=$(mktemp -d)
	trap 'rm -rf "$ordner"' EXIT
	agent_laden "$ordner"
	agent_pruefen "$ordner" "$ARCH"
	install -m 0755 "$ordner/steuerzentrale-agent-linux-$ARCH" "$BINARY"
	server_einrichten
	beitreten
	dienst_einrichten
	meldung "done: the agent runs and has its certificate"
}

if [ "${SZ_INSTALL_NUR_LADEN:-}" != 1 ]; then main "$@"; fi
