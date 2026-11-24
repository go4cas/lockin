#!/usr/bin/env bash
# Lock-In restore (docs/RELEASE.md, "Restore a backup" and "Move to a new server").
#
#   sudo restore.sh <lockin-backup-....tar.gz> [--data <folder>] [--user <name>] [--no-service]
#
# Stops Lock-In, moves the current data folder's contents aside to
# <data>.before-restore-<time> (nothing is deleted), unpacks the backup with its file modes,
# gives every file to the lockin user, checks the database and starts Lock-In again.
# The data folder's own backups/ folder stays where it is.
#
# --no-service skips stopping and starting systemd units and the change of owner, for
# trying a restore into a spare folder as yourself.
set -euo pipefail
umask 077

data=/var/lib/lockin
user=lockin
service=1
archive=""

die() { echo "restore: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --data) data="${2:?--data needs a folder}"; shift 2 ;;
    --user) user="${2:?--user needs a name}"; shift 2 ;;
    --no-service) service=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$archive" ] || die "give one backup file"; archive="$1"; shift ;;
  esac
done

[ -n "$archive" ] || die "which backup? Give the path of a lockin-backup-....tar.gz file"
[ -f "$archive" ] || die "no file at $archive"
command -v sqlite3 >/dev/null || die "sqlite3 is not installed (on Debian or Ubuntu: apt-get install sqlite3)"
data="${data%/}"
if [ "$service" = 1 ]; then
  [ "$(id -u)" = 0 ] || die "run this as root (sudo), or pass --no-service"
  id "$user" >/dev/null 2>&1 || die "there is no user $user; run setup.sh first"
fi

# The archive must hold one top-level folder lockin-backup-*/ and nothing outside it.
listing=$(tar -tzf "$archive") || die "$archive is not a readable .tar.gz file"
top="${listing%%$'\n'*}"
top="${top%%/*}"
case "$top" in lockin-backup-*) ;; *) die "$archive does not look like a Lock-In backup" ;; esac
if [ "$(grep -Evc "^$top(/|$)" <<<"$listing" || true)" != 0 ]; then die "$archive has files outside $top/; not restoring it"; fi
if grep -Eq '(^|/)\.\.(/|$)' <<<"$listing"; then die "$archive has '..' in a path; not restoring it"; fi

work=$(mktemp -d "${TMPDIR:-/tmp}/lockin-restore-XXXXXX")
trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzpf "$archive" --no-same-owner
[ -f "$work/$top/lockin.db" ] || die "$archive has no lockin.db"
check=$(sqlite3 "$work/$top/lockin.db" "PRAGMA integrity_check;")
[ "$check" = "ok" ] || die "the backup's database failed its integrity check: $check"

if [ "$service" = 1 ]; then
  systemctl stop lockin-backup.timer lockin.service 2>/dev/null || true
fi

mkdir -p "$data"
aside="$data.before-restore-$(date -u +%Y%m%d-%H%M%S)"
mkdir -m 700 "$aside"
moved=0
for entry in "$data"/* "$data"/.[!.]*; do
  [ -e "$entry" ] || continue
  [ "$(basename "$entry")" = backups ] && continue
  mv "$entry" "$aside/"
  moved=1
done
[ "$moved" = 1 ] || rmdir "$aside"

for entry in "$work/$top"/* "$work/$top"/.[!.]*; do
  [ -e "$entry" ] || continue
  mv "$entry" "$data/"
done
mkdir -p "$data/backups"
chmod 700 "$data" "$data/backups"

if [ "$service" = 1 ]; then
  chown -R "$user:$user" "$data"
  [ -d "$aside" ] && chown -R root:root "$aside"
  systemctl start lockin.service
  systemctl start lockin-backup.timer 2>/dev/null || true
fi

echo "restore: restored $archive into $data"
[ -d "$aside" ] && echo "restore: what was there before is in $aside (delete it once you are happy)"
exit 0
