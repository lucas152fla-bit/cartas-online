#!/usr/bin/env bash
# =============================================================================
#  Provisiona o Cartas Online numa VM Oracle Cloud (Ubuntu) — roda DAQUI, via SSH.
# =============================================================================
# Uso:
#   scripts/oracle-provision.sh <IP_PUBLICO> [dominio]
#
#   dominio padrão: <ip-com-hifens>.sslip.io  (ex.: 129-213-44-7.sslip.io)
#   — o sslip.io resolve para o próprio IP, então o Caddy emite HTTPS
#     (Let's Encrypt) sem você precisar registrar domínio.
#
# Pré-requisitos:
#   - VM Ubuntu criada com a chave pública ~/.ssh/cartas_oracle.pub
#   - Security List (VCN) com ingress 80 e 443 liberados
# =============================================================================
set -euo pipefail

IP="${1:?uso: scripts/oracle-provision.sh <IP_PUBLICO> [dominio]}"
DOMAIN="${2:-$(printf '%s' "$IP" | tr '.' '-').sslip.io}"
KEY="${ORACLE_KEY:-$HOME/.ssh/cartas_oracle}"
SSH_USER="${ORACLE_USER:-ubuntu}"
APP_DIR="/opt/cartas-online"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ Alvo: ${SSH_USER}@${IP}  ·  https://${DOMAIN}"

# 1) Empacota o app (sem node_modules/data/.git)
TAR="$(mktemp -t cartas.XXXXXX.tgz)"
tar -czf "$TAR" -C "$ROOT" \
  --exclude=node_modules --exclude=data --exclude=.git \
  --exclude='*.log' --exclude=.env .
echo "→ Enviando app ($(du -h "$TAR" | cut -f1))..."
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$TAR" "${SSH_USER}@${IP}:/tmp/cartas.tgz"

# 2) Bootstrap remoto (executa como root na VM)
REMOTE="$(mktemp -t cartas-remote.XXXXXX.sh)"
cat >"$REMOTE" <<'REMOTE_EOF'
set -euo pipefail
DOMAIN="$1"
APP_DIR="/opt/cartas-online"

export DEBIAN_FRONTEND=noninteractive
echo "→ [1/6] pacotes base"
apt-get update -y
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "→ [2/6] Node 24 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "   node $(node -v)"

echo "→ [3/6] Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "→ [4/6] firewall local (Oracle bloqueia 80/443 por iptables)"
iptables -I INPUT -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT || true
apt-get install -y iptables-persistent
netfilter-persistent save || true

echo "→ [5/6] aplicação em ${APP_DIR}"
mkdir -p "$APP_DIR"
tar -xzf /tmp/cartas.tgz -C "$APP_DIR"
chown -R ubuntu:ubuntu "$APP_DIR"
( cd "$APP_DIR" && sudo -u ubuntu npm ci --omit=dev )

if [ ! -f "$APP_DIR/.env" ]; then
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  cat > "$APP_DIR/.env" <<EOF
PORT=3000
HOST=127.0.0.1
SESSION_SECRET=${SECRET}
EOF
  chown ubuntu:ubuntu "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
fi

cat > /etc/systemd/system/cartas.service <<'EOF'
[Unit]
Description=Cartas Online
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/cartas-online
EnvironmentFile=/opt/cartas-online/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now cartas
systemctl restart cartas

echo "→ [6/6] Caddy (HTTPS automático para ${DOMAIN})"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable --now caddy
systemctl restart caddy

sleep 3
echo "--- status ---"
systemctl is-active cartas && echo "cartas: ativo"
systemctl is-active caddy  && echo "caddy: ativo"
REMOTE_EOF

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "${SSH_USER}@${IP}" \
  "sudo bash -s -- '${DOMAIN}'" < "$REMOTE"

echo ""
echo "✓ Provisionado. Abra: https://${DOMAIN}"
echo "  (o Caddy pode levar ~20s para emitir o certificado na primeira vez)"
