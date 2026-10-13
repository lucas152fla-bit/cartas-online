# 🃏 Cartas Online

Jogo de cartas para jogar com os amigos pelo navegador — funciona em **iOS, Android e PC** (é um PWA instalável). Base com contas, amigos, perfis personalizáveis (avatar 2D), chat e carteira com duas moedas, além do **jogo 21 (Blackjack)** e do **Poker (Texas Hold'em)** contra robôs e amigos. O 21 tem **robôs em quantidade à escolha**, **partidas salvas** (jogadas, tempo e pontuação) e **ranking geral**.

## O que já está pronto

- **Contas** — cadastro e login por apelido + senha (sem e-mail). Durante o desenvolvimento, o app entra automaticamente como **convidado** (`__dev`) sem tela de login.
- **Perfis personalizáveis** — nome de exibição, avatar (emoji) e cor.
- **Amigos** — busca por apelido, pedidos de amizade (enviar/aceitar/recusar), presença online em tempo real.
- **Chat** — conversa direta (1:1) para cada amigo, **grupos** e um **mural global** para todo mundo. Mensagens em tempo real, indicador de "digitando", contagem de não lidas e notificações.
- **Jogo 21 (Blackjack)** — mesas multijogador (até 6 lugares) contra a banca, com **sala de espera**, **3 baralhos** (Clássico, Royal e Neon), **escolha de quantidade de robôs** (0 a 5), apostas em fichas, turnos por tempo e pagamentos automáticos na carteira. Veja "Como jogar 21".
- **Poker (Texas Hold'em)** — mesas de até 6 lugares (gente e robôs), com **3 baralhos/temas** (Clássico, Royal e Neon) e **blinds e buy-in configuráveis** (Baixo 2/5 🪙, Clássico 5/10 🪙, Médio 10/25 🪙 ou Alto 50/100 🪙). Tem pré-flop, flop, turn, river e showdown, com **avaliação de mãos**, **potes laterais** (all-in), **aumentos** (mín/½ pote/pote/all-in), **cartas reveladas no fim** e **interações** (emotes). O anfitrião escolhe o baralho, ajusta os robôs e o buy-in na criação e abre as mãos.
- **Partidas salvas** — cada rodada fica registrada no banco com **jogadas** (aposta/pedir/parar/…), **tempo** e **pontuação**, e alimenta o **ranking geral** (🏆 na tela Jogar) ordenado por vitórias.
- **Carteira com 2 moedas** — 🪙 **Fichas** e 💎 **Gemas**, com **conversão nos dois sentidos** e extrato completo.
- **Instalável (PWA)** — adicione à tela de início no celular e use como app.

## Requisitos

- **Node.js 22 ou superior** (usa o `node:sqlite` embutido — sem dependências nativas).

## Como rodar

```bash
cd cartas-online
npm install
npm start
```

Abra `http://localhost:3000`.

### Jogar com os amigos na mesma rede (Wi‑Fi / modo LAN)

1. Descubra o IP da rede da sua máquina: `hostname -I` (Linux) ou `ipconfig` (Windows).
2. Os amigos acessam `http://SEU_IP:3000` no celular ou PC (na tela inicial há o botão **🔗 Convidar** com o endereço do servidor).
3. No **WSL**, os outros aparelhos devem usar o IP de LAN do **Windows** (o do `ipconfig`), não o de `hostname -I` (IP interno do WSL).
4. Interessante para a "mesa de festa": um anfitrião roda o servidor, todos entram pelo link, e um cria a mesa na aba **Jogar**.

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `0.0.0.0` | Interface de rede |
| `SESSION_SECRET` | gerado em `data/.secret` | Assinatura dos tokens de login |
| `DB_PATH` | `data/cartas.db` | Arquivo do banco SQLite |
| `DISABLE_GUEST` | vazio | Defina `1` para desligar o **login de convidado** (`__dev`) e exigir conta cadastrada |

## Hospedagem online (para jogar de qualquer lugar)

O projeto é um app Node único com SQLite, então roda em qualquer host Node:

- **Render / Railway / Fly.io** — crie um Web Service, build `npm install`, start `npm start`. Use um **disco persistente** para a pasta `data/` (senão o banco some a cada deploy).
- **VPS (ex.: Oracle Free, DigitalOcean)** — suba o código, `npm install`, e mantenha de pé com `pm2`:
  ```bash
  npm i -g pm2
  pm2 start server/index.js --name cartas
  pm2 save && pm2 startup
  ```
  Coloque um Nginx/Caddy na frente para HTTPS (necessário para o PWA instalável).

Defina `SESSION_SECRET` com um valor aleatório em produção.

## Estrutura

```
cartas-online/
├── server/
│   ├── index.js      Servidor Express + Socket.IO
│   ├── db.js         Banco SQLite (node:sqlite) e esquema
│   ├── auth.js       Cadastro, login (scrypt) e tokens
│   ├── api.js        Rotas REST (amigos, conversas, carteira)
│   ├── realtime.js   Presença online e mensagens em tempo real
│   └── games/
│       ├── blackjack.js  Motor e mesas do 21 (REST + Socket.IO)
│       └── poker.js      Motor e mesas do Poker (Texas Hold'em, REST + Socket.IO)
├── public/
│   ├── index.html    Interface (SPA)
│   ├── css/style.css Estilos responsivos
│   ├── js/           app.js, api.js, state.js, ui.js, blackjack.js, poker.js,
│   │                 avatar3d.js, celebrate.js, emotes.js
│   ├── sw.js         Service worker (PWA)
│   └── icons/        Ícones gerados
├── scripts/
│   ├── make-icons.mjs  Gera os ícones PNG sem dependências
│   ├── full-smoke.mjs  Teste ponta-a-ponta do 21 (robôs, queda + retorno, rank)
│   └── poker-smoke.mjs Teste ponta-a-ponta do Poker (mãos, showdown, aumento, carteira)
└── data/             Banco (criado automaticamente)
```

## Economia das moedas

- 🪙 **Fichas** — moeda do dia a dia (bônus inicial de 1.000).
- 💎 **Gemas** — moeda premium (bônus inicial de 10).
- **Conversão:** 1 💎 = 10 🪙. A volta aplica um pequeno spread (1 🪙 ≈ 0,09 💎), então 100 🪙 = 9 💎.
- Toda movimentação fica no **extrato**.

> As taxas ficam em `server/db.js` (`GEMAS_PARA_FICHAS` e `SPREAD_FICHAS_PARA_GEMAS`) e são fáceis de ajustar.

## Como jogar 21

1. Abra a aba **Jogar** e clique em **＋ Nova mesa** — você vira o anfitrião.
2. Na criação: escolha o **baralho** (Clássico, Royal ou Neon) e a **quantidade de robôs** (0 a 5) que vão sentar com você.
3. A mesa abre na **sala de espera**. Os amigos entram pela lista do lobby (até 6 lugares) ou pelo link do servidor (botão **🔗 Convidar**) e cada um faz sua **aposta em fichas** (mínimo 10 🪙). O anfitrião pode trocar o baralho enquanto espera.
4. O anfitrião clica **Iniciar rodada**: cada jogador recebe 2 cartas, a banca mostra uma carta virada para baixo e as apostas são debitadas da carteira.
5. Na sua vez (a mesa mostra quem está jogando): **Pedir** outra carta, **Parar** ou **Dobrar** (na primeira mão).
6. A banca compra até 17 e os pagamentos saem automáticos: 21 na mão paga **1,5×**, vitória **1×**, empate devolve a aposta.
7. Quem demora mais de 30 s perde a vez (para a mesa não travar). No fim, o anfitrião abre a **Nova rodada** (as fichas do pote continuam apostadas).
8. **Caiu da mesa?** Se um jogador desconectar no meio da rodada, um **robô assume** o lugar e joga por ele até o fim. Ele pode **voltar depois** e retoma o controle do próprio assento.
9. As rodadas ficam salvas (jogadas, tempo e pontuação) e a **soma de vitórias** vira o **ranking geral** — abra o 🏆 na tela Jogar.

> As apostas são debitadas da carteira ao iniciar a rodada e os prêmios creditados no fim — tudo aparece no **extrato**. O ranking soma vitórias, partidas, saldo (net) e pontuação média do histórico salvo no banco.

## Como jogar Poker

1. Na aba **Jogar**, toque em **♠ Poker** e depois em **＋ Nova mesa** — escolha o nome, a **quantidade de robôs** (0 a 5), o **baralho** (Clássico, Royal ou Neon) e os **blinds** (Baixo 2/5 · buy-in 100, Clássico 5/10 · 200, Médio 10/25 · 500 ou Alto 50/100 · 2000).
2. Cada um entra com o **buy-in** 🪙 da mesa a cada mão, de acordo com os blinds escolhidos.
3. O anfitrião pode **trocar o baralho** (na sala de espera), **＋ Robô / − Robô** e clica **Iniciar mão** quando houver 2+ jogadores.
4. Na sua vez (a mesa marca quem joga): **Desistir**, **Pagar/Mesa** ou **Aumentar** (com atalhos Mín / ½ pote / Pote / All-in).
5. As ruas são **Pré-flop → Flop → Turn → River → Showdown**; no fim as cartas aparecem e o vencedor leva o pote (com **potes laterais** quando há all-in).
6. Ao fim da mão o anfitrião volta à **sala de espera** (para reajustar robôs/entradas) e abre a **próxima mão**.

> As entradas e prêmios passam pela **carteira** (extrato). Os robôs têm IA simples por força de mão e pot odds.

## Próximos passos (os jogos)

A base, o **21** e o **Poker** já estão jogáveis — as duas rodadas ficam salvas no banco (jogadas, tempo, pontuação) e somam no 🏆 **ranking geral** (aba Geral / 🃏 21 / ♠ Poker). Ideias para continuar:

1. **Torneios/mesas em grupo** — cada mesa ligada a um **grupo** existente, com convite direto e placar persistente.
2. **Histórico detalhado na tela** — abrir as mãos salvas (jogadas, board, resultado e saldo) além do ranking.
3. **Novos jogos de cartas** — Truco, Fodinha, Buraco, etc., reaproveitando amigos, chats e carteira.

Cada mesa é um estado de jogo no servidor, com apostas debitadas da carteira e prêmios creditados aos vencedores.

## Segurança

- Senhas com `scrypt` (sal por usuário); tokens assinados por HMAC.
- Em produção: rode atrás de HTTPS e defina `SESSION_SECRET`.
