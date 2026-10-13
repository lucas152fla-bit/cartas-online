#!/usr/bin/env bash
# Start de produção: restaura o SQLite do bucket (se houver) e sobe o app
# com replicação contínua via Litestream. Sem LITESTREAM_BUCKET, sobe direto.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="data/cartas.db"
mkdir -p data bin
LS="./bin/litestream"

if [ -x "$LS" ] && [ -n "${LITESTREAM_BUCKET:-}" ] && [ -n "${LITESTREAM_ACCESS_KEY_ID:-}" ]; then
  CFG="$(mktemp)"
  cat > "$CFG" <<EOF
dbs:
  - path: $(pwd)/$DB
    replicas:
      - type: s3
        endpoint: ${LITESTREAM_ENDPOINT}
        bucket: ${LITESTREAM_BUCKET}
        path: ${LITESTREAM_PATH:-cartas.db}
        region: ${LITESTREAM_REGION:-auto}
        force-path-style: ${LITESTREAM_FORCE_PATH_STYLE:-true}
        access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
EOF
  echo "→ Litestream: restaurando banco (se existir no bucket)..."
  "$LS" restore -config "$CFG" -if-db-not-exists -if-replica-exists "$(pwd)/$DB" || true
  echo "→ Litestream: iniciando replicação contínua + app"
  exec "$LS" replicate -config "$CFG" -exec "node server/index.js"
fi

echo "→ Subindo sem replicação (dados efêmeros neste host)"
exec node server/index.js
