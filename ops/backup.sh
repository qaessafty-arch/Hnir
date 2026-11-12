#!/usr/bin/env bash
# Encrypted PostgreSQL + uploads backup for Darwaza SMS.
# Required env: DATABASE_URL, BACKUP_DIR, BACKUP_PASSPHRASE   Optional: UPLOAD_DIR, BACKUP_RETENTION_DAYS (default 30)
# Schedule (example, daily 01:30):  30 1 * * *  /opt/darwaza/ops/backup.sh >> /var/log/darwaza-backup.log 2>&1
set -euo pipefail
umask 077
: "${DATABASE_URL:?}" "${BACKUP_DIR:?}" "${BACKUP_PASSPHRASE:?}"
RET="${BACKUP_RETENTION_DAYS:-30}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
WORK="$(mktemp -d)"; trap 'rm -rf -- "$WORK"' EXIT

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$WORK/db.dump"
if [ -n "${UPLOAD_DIR:-}" ] && [ -d "$UPLOAD_DIR" ]; then tar -C "$UPLOAD_DIR" -cf "$WORK/uploads.tar" .; fi
tar -C "$WORK" -cf "$WORK/bundle.tar" $(cd "$WORK" && ls db.dump uploads.tar 2>/dev/null)
# AES-256-CBC with PBKDF2 (600k iterations); passphrase read from env, never on the command line.
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -in "$WORK/bundle.tar" -out "$BACKUP_DIR/darwaza-$TS.tar.enc"
sha256sum "$BACKUP_DIR/darwaza-$TS.tar.enc" > "$BACKUP_DIR/darwaza-$TS.tar.enc.sha256"
find "$BACKUP_DIR" -name 'darwaza-*.tar.enc*' -type f -mtime +"$RET" -delete
echo "$(date -u +%FT%TZ) backup ok: $BACKUP_DIR/darwaza-$TS.tar.enc ($(stat -c %s "$BACKUP_DIR/darwaza-$TS.tar.enc") bytes)"
# Copy $BACKUP_DIR off-site (e.g. rclone/rsync to another server or object storage) — a backup on the same disk is not a backup.
