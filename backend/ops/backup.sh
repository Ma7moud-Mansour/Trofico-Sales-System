#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGSERVICE:?Configure a read-only backup PostgreSQL service and PGPASSFILE}"
: "${BACKUP_DIR:?Use a private directory outside the application and public files}"
: "${BACKUP_GPG_RECIPIENT:?Provide the operations encryption key recipient}"
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/sales-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
pg_dump --format=custom --no-owner --no-acl | gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$target"
test -s "$target"
printf '%s\n' 'Encrypted backup completed; upload to the configured off-host store and verify retention.'
