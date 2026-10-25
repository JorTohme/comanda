#!/bin/sh
# One logical backup of the comanda database: pg_dump | gzip into $BACKUP_DIR, then prune old dumps.
# Reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE from the environment. Optional: BACKUP_DIR, BACKUP_RETENTION_DAYS.
set -eu
dir="${BACKUP_DIR:-/backups}"
days="${BACKUP_RETENTION_DAYS:-14}"
name="comanda-$(date -u +%Y%m%d-%H%M%S).sql.gz"
mkdir -p "$dir"
# Dump to a temp name first so a failed run never leaves a truncated .sql.gz behind.
pg_dump --no-owner --clean --if-exists -f "$dir/.tmp.sql"
gzip -c "$dir/.tmp.sql" > "$dir/$name.tmp"
rm -f "$dir/.tmp.sql"
mv "$dir/$name.tmp" "$dir/$name"
find "$dir" -name 'comanda-*.sql.gz' -mtime "+$days" -delete
echo "backup ok: $name"
