#!/usr/bin/env bash
# =============================================================================
#  Cartas Online — sobe o jogo + túnel público de uma vez
# =============================================================================
# Uso:
#   scripts/tunnel.sh              sobe servidor + ngrok (domínio fixo)
#   scripts/tunnel.sh --cf         sobe servidor + Cloudflare (SEM interstitial)
#   scripts/tunnel.sh status       mostra o estado atual
#   scripts/tunnel.sh stop         derruba o túnel e o servidor
#
# Variáveis de ambiente:
#   PORT=3000                                   porta do servidor
#   NGROK_DOMAIN=oxford-clay-manifesto.ngrok-free.dev   domínio fixo do ngrok
#
# Observação (ngrok free): o navegador mostra UMA vez a página "Visit Site"
# por aparelho/navegador (cookie). Para link público sem esse aviso, use --cf.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
DOMAIN="${NGROK_DOMAIN:-oxford-clay-manifesto.ngrok-free.dev}"
RUN="${TMPDIR:-/tmp}/cartas-online-tunnel"
NGROK="${NGROK_BIN:-$(command -v ngrok || echo "$HOME/.local/bin/ngrok")}"
CLOUDFLARED="${CLOUDFLARED_BIN:-$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")}"
URLFILE="$RUN/public.url"
mkdir -p "$RUN"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
info() { printf '  \033[36m•\033[0m %s\n' "$*"; }

server_up() { curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null; }

ngrok_api_url() {
  curl -fsS --max-time 3 "http://127.0.0.1:4040/api/tunnels" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).tunnels?.[0]?.public_url;if(u)process.stdout.write(u)}catch(e){}})'
}

lan_ip() {
  command -v powershell.exe >/dev/null 2>&1 || return 0
  powershell.exe -NoProfile -Command \
    "\$r = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Where-Object { \$_.NextHop -ne '0.0.0.0' } | Select-Object -First 1; (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex \$r.InterfaceIndex).IPAddress" \
    2>/dev/null | tr -d '\r'
}

copy_link() {
  command -v copiar >/dev/null 2>&1 || return 0
  copiar "$1" >/dev/null 2>&1 && info "link copiado no clipboard do Windows"
}

start_server() {
  if server_up; then ok "servidor já no ar em :$PORT"; return 0; fi
  say "Subindo servidor..."
  ( cd "$ROOT" && setsid nohup node server/index.js </dev/null >"$RUN/server.log" 2>&1 & echo $! >"$RUN/server.pid" )
  local i
  for i in $(seq 1 40); do sleep 0.5; server_up && break; done
  if server_up; then ok "servidor no ar em http://localhost:$PORT (pid $(cat "$RUN/server.pid" 2>/dev/null))"; return 0; fi
  bad "servidor não subiu — veja $RUN/server.log"; tail -n 15 "$RUN/server.log" 2>/dev/null; return 1
}

start_ngrok() {
  local url; url="$(ngrok_api_url)"
  if [ -n "$url" ]; then ok "túnel ngrok já ativo: $url"; printf '%s' "$url" >"$URLFILE"; return 0; fi
  say "Subindo túnel ngrok (→ https://$DOMAIN)..."
  setsid nohup "$NGROK" http "$PORT" --url "https://$DOMAIN" --log=stdout </dev/null >"$RUN/ngrok.log" 2>&1 &
  echo $! >"$RUN/ngrok.pid"
  local i
  for i in $(seq 1 60); do sleep 0.5; url="$(ngrok_api_url)"; [ -n "$url" ] && break; done
  if [ -n "$url" ]; then ok "túnel no ar: $url"; printf '%s' "$url" >"$URLFILE"; return 0; fi
  bad "túnel ngrok não subiu — veja $RUN/ngrok.log"; tail -n 15 "$RUN/ngrok.log" 2>/dev/null; return 1
}

start_cloudflared() {
  local url; url="$(cat "$URLFILE" 2>/dev/null)"
  if [ -n "$url" ] && curl -fsS -o /dev/null --max-time 3 "$url/" 2>/dev/null; then
    ok "túnel Cloudflare já ativo: $url"; return 0
  fi
  say "Subindo túnel Cloudflare (link público sem interstitial)..."
  : >"$RUN/cf.log"
  setsid nohup "$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate </dev/null >"$RUN/cf.log" 2>&1 &
  echo $! >"$RUN/cf.pid"
  local i
  for i in $(seq 1 60); do
    sleep 0.5
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/cf.log" 2>/dev/null | head -n1)"
    [ -n "$url" ] && break
  done
  if [ -n "$url" ]; then ok "túnel no ar: $url"; printf '%s' "$url" >"$URLFILE"; return 0; fi
  bad "túnel Cloudflare não subiu — veja $RUN/cf.log"; tail -n 15 "$RUN/cf.log" 2>/dev/null; return 1
}

print_urls() {
  local public; public="$(cat "$URLFILE" 2>/dev/null)"
  say ""
  say "════════════════════════════════════════════════════════"
  say "  🃏 Cartas Online — no ar!"
  say "════════════════════════════════════════════════════════"
  [ -n "$public" ] && say "  🌐 Link para os amigos:      $public"
  say "  💻 Você (sem interstitial):  http://localhost:$PORT"
  local lan; lan="$(lan_ip)"
  [ -n "$lan" ] && say "  📶 Mesmo Wi-Fi no celular:   http://$lan:$PORT"
  say "════════════════════════════════════════════════════════"
}

do_status() {
  say "Cartas Online — status"
  if server_up; then ok "servidor: http://localhost:$PORT"; else bad "servidor: parado"; fi
  local u; u="$(ngrok_api_url)"
  if [ -n "$u" ]; then ok "ngrok: $u"; else info "ngrok: sem túnel"; fi
  if pgrep -x cloudflared >/dev/null 2>&1; then info "cloudflare: $(cat "$URLFILE" 2>/dev/null)"; fi
}

do_stop() {
  say "Derrubando..."
  local f pid
  for f in ngrok.pid cf.pid server.pid; do
    if [ -f "$RUN/$f" ]; then
      pid="$(cat "$RUN/$f" 2>/dev/null)"
      if [ -n "$pid" ] && kill "$pid" 2>/dev/null; then ok "parado pid $pid ($f)"; fi
      rm -f "$RUN/$f"
    fi
  done
  # fallback por nome exato (seguro: não casa com esta shell)
  pkill -x ngrok      >/dev/null 2>&1 && ok "ngrok encerrado"
  pkill -x cloudflared >/dev/null 2>&1 && ok "cloudflared encerrado"
  if [ -f "$RUN/server.pid" ] || pgrep -f "node .*$ROOT/server/index.js" >/dev/null 2>&1; then
    pkill -f "node .*$ROOT/server/index.js" >/dev/null 2>&1 && ok "servidor encerrado"
  fi
  rm -f "$URLFILE"
  say "Pronto."
}

MODE="ngrok"
case "${1:-}" in
  status) do_status; exit 0 ;;
  stop)   do_stop;   exit 0 ;;
  --cf|cf|cloudflare) MODE="cf" ;;
  "" ) : ;;
  *) say "Opção desconhecida: $1"; say "Uso: scripts/tunnel.sh [--cf|status|stop]"; exit 2 ;;
esac

rm -f "$URLFILE"
start_server || exit 1
if [ "$MODE" = "cf" ]; then start_cloudflared || exit 1; else start_ngrok || exit 1; fi

print_urls
PUBLIC="$(cat "$URLFILE" 2>/dev/null)"
[ -n "$PUBLIC" ] && copy_link "$PUBLIC"
