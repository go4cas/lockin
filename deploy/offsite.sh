#!/usr/bin/env bash
# Lock-In off-server backup copy (docs/RELEASE.md, "Off-server copy").
#
#   offsite.sh [--data <folder>] [--credentials <file>]
#
# Uploads the newest lockin-backup-*.tar.gz from <data>/backups to a private Cloudflare R2
# bucket (any S3-compatible store works), so a lost server does not take its backups with it.
# Run by lockin-offsite.service after each successful backup. The bucket's own lifecycle
# rule deletes old copies.
#
# The credentials file holds four lines and never goes in the repository:
#   R2_ACCOUNT_ID=<32 hex characters>   R2_BUCKET=<bucket name>
#   R2_ACCESS_KEY_ID=<key id>           R2_SECRET_ACCESS_KEY=<secret>
# and optionally R2_ENDPOINT=https://... for another S3-compatible store.
# Default: $CREDENTIALS_DIRECTORY/r2 (systemd LoadCredential), else /etc/lockin/r2.env.
# Needs: bash, curl 7.75 or newer (AWS SigV4 signing).
set -euo pipefail
umask 077

data=/var/lib/lockin
creds=""

die() { echo "offsite: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --data) data="${2:?--data needs a folder}"; shift 2 ;;
    --credentials) creds="${2:?--credentials needs a file}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
done

if [ -z "$creds" ]; then
  if [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -f "$CREDENTIALS_DIRECTORY/r2" ]; then creds="$CREDENTIALS_DIRECTORY/r2"; else creds=/etc/lockin/r2.env; fi
fi
[ -r "$creds" ] || die "cannot read the credentials file $creds"
command -v curl >/dev/null || die "curl is not installed"

# Read the values without running the file as a script.
value() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$creds" | tail -1 | tr -d '\r' | sed 's/[[:space:]]*$//; s/^"\(.*\)"$/\1/'; }
account=$(value R2_ACCOUNT_ID)
bucket=$(value R2_BUCKET)
key_id=$(value R2_ACCESS_KEY_ID)
secret=$(value R2_SECRET_ACCESS_KEY)
endpoint=$(value R2_ENDPOINT)

[[ "$bucket" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || die "R2_BUCKET is missing or not a bucket name"
[[ "$key_id" =~ ^[A-Za-z0-9]+$ ]] || die "R2_ACCESS_KEY_ID is missing or has unexpected characters"
[[ "$secret" =~ ^[A-Za-z0-9/+=]+$ ]] || die "R2_SECRET_ACCESS_KEY is missing or has unexpected characters"
if [ -n "$endpoint" ]; then
  [[ "$endpoint" =~ ^https://[A-Za-z0-9.:-]+$ ]] || die "R2_ENDPOINT must be https://<host>"
else
  [[ "$account" =~ ^[0-9a-f]{32}$ ]] || die "R2_ACCOUNT_ID is missing or not 32 hex characters"
  endpoint="https://$account.r2.cloudflarestorage.com"
fi

data="${data%/}"
newest=$(find "$data/backups" -maxdepth 1 -type f -name 'lockin-backup-*.tar.gz' -printf '%f\n' 2>/dev/null | sort | tail -1)
[ -n "$newest" ] || die "no backup archive in $data/backups"

# The key and secret go to curl on standard input, never on its command line (where any
# user on the server could read them).
url="$endpoint/$bucket/$newest"
printf 'user = "%s:%s"\n' "$key_id" "$secret" \
  | curl -fsS --proto '=https' --retry 3 --max-time 600 -K - \
      --aws-sigv4 "aws:amz:auto:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
      -T "$data/backups/$newest" "$url" >/dev/null \
  || die "upload of $newest to bucket $bucket failed"
echo "offsite: copied $newest to bucket $bucket"
