#!/usr/bin/env bash
# Baixa o binário do Litestream para ./bin (usado no build do Render).
# Se falhar, NÃO quebra o build — o app sobe sem replicação.
set -uo pipefail
VER="${LITESTREAM_VERSION:-0.5.17}"
case "$(uname -m)" in
  x86_64|amd64) A=x86_64 ;;
  aarch64|arm64) A=arm64 ;;
  *) echo "arquitetura não suportada: $(uname -m)"; exit 0 ;;
esac
mkdir -p bin
URL="https://github.com/benbjohnson/litestream/releases/download/v${VER}/litestream-${VER}-linux-${A}.tar.gz"
echo "→ baixando litestream v${VER} (${A})"
if curl -fsSL "$URL" -o /tmp/litestream.tgz; then
  tar -xzf /tmp/litestream.tgz -C bin 2>/dev/null || tar -xzf /tmp/litestream.tgz -C bin
  chmod +x bin/litestream
  ./bin/litestream version || true
else
  echo "→ download falhou; seguindo sem Litestream"
fi
exit 0
