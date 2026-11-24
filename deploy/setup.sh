#!/usr/bin/env bash
# Lock-In server setup (docs/RELEASE.md). Safe to run again: each run brings the server to
# the same state and only restarts Lock-In when something changed.
#
#   sudo deploy/setup.sh --public-url https://quiz.example.com --version v1.0.0
#   sudo deploy/setup.sh --public-url https://quiz.example.com --binary ./lockin-linux-x64
#   sudo deploy/setup.sh                       (again later: keeps the saved settings)
#
# Options:
#   --public-url <url>  The address teams use, https. Saved in /etc/lockin/lockin.env.
#   --version <tag>     Download that release from GitHub and check its SHA-256.
#   --binary <file>     Install this binary instead (for example one you built).
#   --port <number>     Port on 127.0.0.1 for the Cloudflare tunnel (default 8080).
#   --repo <owner/name> Where releases are downloaded from (default go4cas/lockin).
#   --no-journald       Do not install Lock-In's own log retention file.
#
# What it does: installs sqlite3 if missing, makes the lockin system user, installs the
# binary to /usr/local/bin/lockin (the old one stays as lockin.previous), writes the
# settings file, installs the systemd units and the backup script, backs up the data before
# replacing a binary, starts Lock-In, checks it answers, and prints the setup code if no
# host password is set yet. It never opens a firewall port and never touches Cloudflare.
# On a server shared with other apps it refuses a port another program already listens on,
# and its logs go to their own journal namespace, so their retention never touches others.
set -euo pipefail
umask 022

here=$(cd "$(dirname "$0")" && pwd -P)
repo=go4cas/lockin
public_url=""
version=""
binary=""
port=""
journald=1

BIN=/usr/local/bin/lockin
LIB=/usr/local/lib/lockin
ETC=/etc/lockin
ENV_FILE=$ETC/lockin.env
DATA=/var/lib/lockin
UNITS=/etc/systemd/system

say() { echo "setup: $*"; }
die() { echo "setup: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --public-url) public_url="${2:?--public-url needs a URL}"; shift 2 ;;
    --version) version="${2:?--version needs a tag like v1.0.0}"; shift 2 ;;
    --binary) binary="${2:?--binary needs a file}"; shift 2 ;;
    --port) port="${2:?--port needs a number}"; shift 2 ;;
    --repo) repo="${2:?--repo needs owner/name}"; shift 2 ;;
    --no-journald) journald=0; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

[ "$(id -u)" = 0 ] || die "run this as root: sudo $0 $*"
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then die "Lock-In's server binary is for Linux on x86-64 only"; fi
command -v systemctl >/dev/null || die "this server has no systemd"
[ -z "$version" ] || [ -z "$binary" ] || die "give --version or --binary, not both"
for f in systemd/lockin.service systemd/lockin-backup.service systemd/lockin-backup.timer backup.sh restore.sh journald-lockin.conf; do
  [ -f "$here/$f" ] || die "missing $here/$f; run setup.sh from a full copy of the repository's deploy/ folder"
done

# Settings: from the flags, else from the saved file.
saved() { if [ -f "$ENV_FILE" ]; then sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; fi; }
public_url="${public_url:-$(saved LOCKIN_PUBLIC_URL)}"
port="${port:-$(saved LOCKIN_PORT)}"
port="${port:-8080}"
[ -n "$public_url" ] || die "first run: give --public-url https://<your quiz address>"
case "$public_url" in https://?*) ;; *) die "--public-url must start with https:// (Cloudflare gives the address its certificate)" ;; esac
case "$public_url" in *[[:space:]\"\'\$\`\\]*) die "--public-url has a character it cannot have" ;; esac
public_url="${public_url%/}"
case "$port" in ''|*[!0-9]*) die "--port must be a number" ;; esac
if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then die "--port must be between 1024 and 65535"; fi

# A shared server: never take a port another app is already listening on.
if command -v ss >/dev/null; then
  listeners=$(ss -Hltnp "sport = :$port" 2>/dev/null || true)
  if [ -n "$listeners" ] && ! grep -q '"lockin"' <<<"$listeners"; then
    die "port $port is already used by another program on this server. Pick a free port with --port (see: sudo ss -ltnp)"
  fi
fi

changed=0     # anything that needs Lock-In restarted
had_binary=0; [ -x "$BIN" ] && had_binary=1

# 1. Packages the scripts need.
need=()
command -v sqlite3 >/dev/null || need+=(sqlite3)
command -v curl >/dev/null || need+=(curl)
command -v sha256sum >/dev/null || need+=(coreutils)
if [ ${#need[@]} -gt 0 ]; then
  command -v apt-get >/dev/null || die "please install: ${need[*]}"
  say "installing ${need[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}" >/dev/null
fi

# 2. The lockin system user: no login shell, no home folder of its own.
if ! id lockin >/dev/null 2>&1; then
  say "adding the system user lockin"
  useradd --system --user-group --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin lockin
fi

# 3. The binary.
cpu_flavour() { grep -qw avx2 /proc/cpuinfo && echo "lockin-linux-x64" || echo "lockin-linux-x64-baseline"; }
new=""
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ -n "$version" ]; then
  case "$version" in v[0-9]*.[0-9]*.[0-9]*) ;; *) die "--version looks like v1.0.0" ;; esac
  asset=$(cpu_flavour)
  base="https://github.com/$repo/releases/download/$version"
  say "downloading $asset $version from github.com/$repo"
  curl -fsSL --proto '=https' -o "$tmp/$asset" "$base/$asset" || die "could not download $base/$asset"
  curl -fsSL --proto '=https' -o "$tmp/$asset.sha256" "$base/$asset.sha256" || die "could not download $base/$asset.sha256"
  (cd "$tmp" && sha256sum -c --quiet "$asset.sha256") || die "the download does not match its SHA-256; not installing it"
  say "SHA-256 checked"
  new="$tmp/$asset"
elif [ -n "$binary" ]; then
  [ -f "$binary" ] || die "no file at $binary"
  if [ "$(cpu_flavour)" = lockin-linux-x64-baseline ] && [[ "$binary" != *baseline* ]]; then
    say "warning: this CPU has no AVX2. Use the lockin-linux-x64-baseline build if Lock-In will not start."
  fi
  cp "$binary" "$tmp/lockin"
  new="$tmp/lockin"
elif [ "$had_binary" = 0 ]; then
  die "first run: give --version v1.0.0 (download a release) or --binary <file>"
fi

if [ -n "$new" ]; then
  chmod 755 "$new"
  got=$("$new" --version 2>&1) || die "the new binary does not run here: $got"
  if [ "$had_binary" = 1 ] && cmp -s "$new" "$BIN"; then
    say "Lock-In $got is already installed"
  else
    if [ "$had_binary" = 1 ] && [ -f "$DATA/lockin.db" ]; then
      say "backing up the data before replacing the binary"
      install -d -m 755 "$LIB"
      install -m 755 "$here/backup.sh" "$LIB/backup.sh"
      runuser -u lockin -- "$LIB/backup.sh" --data "$DATA" --keep 14 || die "the backup failed, so the binary was not replaced"
      cp -p "$BIN" "$BIN.previous"
    fi
    install -m 755 "$new" "$BIN.new"
    mv -f "$BIN.new" "$BIN"
    say "installed Lock-In $got to $BIN"
    changed=1
  fi
fi

# 4. Settings file. Never holds secrets (TECH-SPEC 4.2).
install -d -m 755 "$ETC"
cat > "$tmp/lockin.env" <<ENV
# Lock-In settings, written by deploy/setup.sh. Change them by running setup.sh again
# with --public-url or --port. Lock-In only listens on this machine; the Cloudflare tunnel
# forwards to it. Never set LOCKIN_BIND to 0.0.0.0 on a server (docs/RELEASE.md).
LOCKIN_PUBLIC_URL=$public_url
LOCKIN_PORT=$port
LOCKIN_BIND=127.0.0.1
ENV
if ! cmp -s "$tmp/lockin.env" "$ENV_FILE"; then
  install -m 644 "$tmp/lockin.env" "$ENV_FILE"
  say "wrote $ENV_FILE"
  changed=1
fi

# 5. Scripts, units and journal retention.
install -d -m 755 "$LIB"
for s in backup.sh restore.sh; do
  cmp -s "$here/$s" "$LIB/$s" || { install -m 755 "$here/$s" "$LIB/$s"; say "installed $LIB/$s"; }
done
units_changed=0
for u in lockin.service lockin-backup.service lockin-backup.timer; do
  if ! cmp -s "$here/systemd/$u" "$UNITS/$u"; then
    install -m 644 "$here/systemd/$u" "$UNITS/$u"
    say "installed $UNITS/$u"
    units_changed=1
  fi
done
# Lock-In logs to its own journal namespace (LogNamespace=lockin in the unit), so this
# retention applies to Lock-In's logs only, never to other apps on the server.
if [ "$journald" = 1 ]; then
  if ! cmp -s "$here/journald-lockin.conf" /etc/systemd/journald@lockin.conf; then
    install -m 644 "$here/journald-lockin.conf" /etc/systemd/journald@lockin.conf
    say "set Lock-In's own logs to be kept for 30 days"
    if systemctl is-active --quiet systemd-journald@lockin.service; then
      systemctl restart systemd-journald@lockin.service || say "warning: could not restart Lock-In's journal; the new retention applies after a reboot"
    fi
  fi
fi
if [ "$units_changed" = 1 ]; then
  systemctl daemon-reload
  changed=1
fi

# 6. Start, or restart if something changed.
systemctl enable --quiet lockin.service lockin-backup.timer
systemctl start lockin-backup.timer
if [ "$changed" = 1 ] && systemctl is-active --quiet lockin.service; then
  say "restarting Lock-In"
  systemctl restart lockin.service
else
  systemctl start lockin.service
fi

# 7. Check it answers on 127.0.0.1.
ok=0
for _ in $(seq 1 30); do
  # Check the answer is Lock-In's, not another app's on the same port.
  body=$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/ping" 2>/dev/null || true)
  if [[ "$body" == *'"app":"lockin"'* ]]; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "setup: Lock-In did not answer on 127.0.0.1:$port within 30 seconds. Its last log lines:" >&2
  journalctl --namespace=lockin -u lockin.service -n 30 --no-pager >&2 || true
  if [ -f "$BIN.previous" ]; then echo "setup: to go back to the previous binary: sudo cp -p $BIN.previous $BIN && sudo systemctl restart lockin" >&2; fi
  exit 1
fi
say "Lock-In $("$BIN" --version) is running on 127.0.0.1:$port for $public_url"

# 8. The setup code, while no host password is set.
if [ ! -f "$DATA/auth.json" ]; then
  code=$(runuser -u lockin -- "$BIN" setup-code --data "$DATA" 2>/dev/null | tail -1 || true)
  if [ -n "$code" ]; then say "no host password yet. Open $public_url/host and use the setup code: $code"; fi
fi
say "done"
