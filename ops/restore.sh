#!/usr/bin/env bash
# Restore an encrypted backup into an EMPTY target database.
#   BACKUP_PASSPHRASE=... ./restore.sh <file.tar.enc> <target DATABASE_URL> [uploads target dir]
# Restore into a new database first, verify, then switch the application's DATABASE_URL.
set -euo pipefail
umask 077
FILE="${1:?backup file}"; TARGET="${2:?target database url}"; UPL="${3:-}"
: "${BACKUP_PASSPHRASE:?}"
if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
WORK="$(mktemp -d)"; trap 'rm -rf -- "$WORK"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$FILE" -out "$WORK/bundle.tar"
tar -C "$WORK" -xf "$WORK/bundle.tar"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$WORK/db.dump"
if [ -n "$UPL" ] && [ -f "$WORK/uploads.tar" ]; then mkdir -p "$UPL"; tar -C "$UPL" -xf "$WORK/uploads.tar"; fi
psql "$TARGET" -tAc "SELECT 'restored: ' || (SELECT count(*) FROM students) || ' students, ' || (SELECT count(*) FROM grade_records) || ' grade records, ' || (SELECT count(*) FROM audit_logs) || ' audit rows'"
