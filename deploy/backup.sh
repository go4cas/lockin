#!/usr/bin/env bash
# Lock-In backup (docs/RELEASE.md, "Backups").
#
#   backup.sh [--data <folder>] [--out <folder>] [--keep <n>]
#
# Writes one archive, lockin-backup-<UTC time>.tar.gz, of everything in the data folder
# except its backups/ folder. The database is copied with SQLite's online backup, so it is
# consistent even while Lock-In is running a night. File modes are kept (0600 files, 0700
# folders, SA-10), and the archive itself is 0600. Keeps the newest <n> archives (default 14).
#
# Run it as the user that owns the data folder (systemd's lockin-backup.service does).
# Needs: bash, tar, gzip, sqlite3.
set -euo pipefail
umask 077

data=/var/lib/lockin
out=""
keep=14

die() { echo "backup: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --data) data="${2:?--data needs a folder}"; shift 2 ;;
    --out) out="${2:?--out needs a folder}"; shift 2 ;;
    --keep) keep="${2:?--keep needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
done

case "$keep" in ''|*[!0-9]*) die "--keep must be a whole number" ;; esac
[ "$keep" -ge 1 ] || die "--keep must be 1 or more"
data="${data%/}"
[ -d "$data" ] || die "no data folder at $data"
[ -f "$data/lockin.db" ] || die "no lockin.db in $data; is this a Lock-In data folder?"
command -v sqlite3 >/dev/null || die "sqlite3 is not installed (on Debian or Ubuntu: apt-get install sqlite3)"
out="${out:-$data/backups}"
mkdir -p "$out"
chmod 700 "$out"

stamp=$(date -u +%Y%m%d-%H%M%S)
name="lockin-backup-$stamp"
stage=$(mktemp -d "$out/.stage-XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/$name"
chmod 700 "$stage/$name"

# Everything except the database files and the backups folder, keeping modes and times.
for entry in "$data"/* "$data"/.[!.]*; do
  [ -e "$entry" ] || continue
  base=$(basename "$entry")
  case "$base" in
    backups|lockin.db|lockin.db-wal|lockin.db-shm|lockin.db-journal) continue ;;
  esac
  # Skip the output folder if it was put inside the data folder under another name.
  if [ "$(cd "$entry" 2>/dev/null && pwd -P)" = "$(cd "$out" && pwd -P)" ]; then continue; fi
  cp -a "$entry" "$stage/$name/"
done

# The database: SQLite's online backup reads a consistent copy, including what is still in
# the write-ahead log, while the server keeps writing. Waits up to 10 s for a busy database.
sqlite3 "$data/lockin.db" ".timeout 10000" ".backup '$stage/$name/lockin.db'"
chmod 600 "$stage/$name/lockin.db"
check=$(sqlite3 "$stage/$name/lockin.db" "PRAGMA integrity_check;")
[ "$check" = "ok" ] || die "the copied database failed its integrity check: $check"
chmod 700 "$stage/$name"

# tar keeps each file's mode (-p on extract); owners are stored by number, and restore.sh
# gives everything to the lockin user, so a new server with another uid works too.
tar -C "$stage" --numeric-owner -czf "$stage/$name.tar.gz" "$name"
chmod 600 "$stage/$name.tar.gz"
mv "$stage/$name.tar.gz" "$out/$name.tar.gz"

# Keep the newest $keep archives. Names sort by time.
mapfile -t all < <(find "$out" -maxdepth 1 -type f -name 'lockin-backup-*.tar.gz' -printf '%f\n' | sort)
drop=$(( ${#all[@]} - keep ))
for (( i = 0; i < drop; i++ )); do rm -f -- "$out/${all[$i]}"; done

size=$(du -h "$out/$name.tar.gz" | cut -f1)
echo "backup: wrote $out/$name.tar.gz ($size); keeping the newest $keep"
