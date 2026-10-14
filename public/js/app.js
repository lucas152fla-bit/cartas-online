import { api, setToken, getToken } from './api.js';
import { state, upsertConversation, sortConversations, totalUnread, totalFriendRequests } from './state.js';
import { $, $$, escapeHtml, toast, formatTime, formatDateTime, avatarHtml, userAvatarHtml, openModal, closeModal, debounce } from './ui.js';
import { initBlackjack, enterJogar, openCreateTable, leaveTable, openInvite, openRank } from './blackjack.js';
import { initPoker, enterPoker, openPokerCreate, leavePokerTable } from './poker.js';
import { avatarSpec, characterCanvas, AVATAR_SKINS, AVATAR_HAIRS, AVATAR_SHIRTS, AVATAR_HATS, HAT_LABEL, AVATAR_DEFAULTS } from './avatar3d.js';
import { CELEBRATIONS } from './celebrate.js';
import { initSound, playSfx } from './sound.js';

const AVATARS = ['🂡', '🐯', '🦊', '🐼', '🐵', '🦁', '🐸', '🐙', '🦉', '🐳', '🎩', '👑', '😎', '🤠', '👽', '🤖', '🍀', '⚡', '🔥', '💎'];
let charPick = { ...AVATAR_DEFAULTS };
let celebPick = 'confetti';
// undefined = sem mudança | string data URL = nova foto | null = remover
let pendingPhoto;
let supportPosts = [];
let socket = null;
let typingTimer = null;
const typingTimeouts = {};

// Avatar de uma conversa: em DM usa a foto do outro participante quando existe.
function convAvatar(conv, size = '') {
  if (conv && conv.type === 'dm' && Array.isArray(conv.members)) {
    const other = conv.members.find((m) => m.id !== state.user?.id) || conv.members[0];
    if (other) return userAvatarHtml(other, size);
  }
  return avatarHtml(conv?.avatar || '👥', conv?.color || '#64748b', size);
}

function connectSocket() {
  if (!window.io) return;
  socket = window.io({ auth: { token: getToken() } });
  socket.on('connect_error', () => {});
  socket.on('message:new', (msg) => handleIncoming(msg));
  socket.on('conversation:bump', ({ conversationId, message }) => {
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv) return refreshConversations();
    conv.lastMessage = message;
    if (state.activeConversationId !== conversationId) {
      conv.unread = (conv.unread || 0) + 1;
      if (conv.type !== 'global' || state.activeConversationId !== conversationId) {
        notifyMessage(conv, message);
      }
    }
    sortConversations();
    renderConversations();
  });
  socket.on('conversation:updated', () => refreshConversations());
  socket.on('presence:snapshot', ({ online }) => {
    state.online = new Set(online);
    renderFriends();
  });
  socket.on('presence:update', ({ userId, online }) => {
    if (online) state.online.add(userId);
    else state.online.delete(userId);
    renderFriends();
  });
  socket.on('typing', ({ conversationId, userId, name, typing }) => {
    if (state.activeConversationId !== conversationId) return;
    const el = $('#typing');
    clearTimeout(typingTimeouts[userId]);
    if (typing) {
      el.textContent = `${name} está digitando…`;
      typingTimeouts[userId] = setTimeout(() => { el.textContent = ''; }, 3500);
    } else {
      el.textContent = '';
    }
  });
  initBlackjack({ socket, refreshWallet });
  initPoker({ socket, refreshWallet });
}

function handleIncoming(msg) {
  const conv = state.conversations.find((c) => c.id === msg.conversationId);
  if (state.activeConversationId === msg.conversationId) {
    state.messages[msg.conversationId] = [...(state.messages[msg.conversationId] || []), msg];
    renderMessages();
  }
  if (conv) {
    conv.lastMessage = msg;
  }
  sortConversations();
  renderConversations();
}

function notifyMessage(conv, msg) {
  if (document.hasFocus() && state.activeConversationId === conv.id) return;
  toast(`${conv.avatar} ${conv.name}: ${msg.body.slice(0, 60)}`);
  playSfx('message');
}

async function enterApp() {
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  renderUserbar();
  await Promise.all([refreshConversations(), refreshFriends(), refreshWallet()]);
  connectSocket();
  switchNav('jogar');
}

function showAuth(error = '') {
  $('#auth-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
  $('#auth-error').textContent = error;
}

function renderUserbar() {
  const u = state.user;
  $('#sidebar-user').innerHTML = `
    ${userAvatarHtml(u)}
    <div class="who"><strong>${escapeHtml(u.displayName)}</strong><small>@${escapeHtml(u.nickname)}</small></div>
    <button class="btn ghost" id="logout-btn" title="Sair">⎋</button>`;
  $('#logout-btn').onclick = () => {
    setToken(null);
    localStorage.removeItem('cartas_token');
    location.reload();
  };
}

function switchNav(nav) {
  state.nav = nav;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === nav));
  ['conversas', 'jogar', 'amigos', 'suporte', 'carteira', 'perfil'].forEach((n) => {
    $(`#pane-${n}`).classList.toggle('hidden', n !== nav);
  });
  $('.sidebar').classList.remove('open');
  if (nav === 'perfil') renderProfile();
  if (nav === 'amigos') renderFriends();
  if (nav === 'suporte') renderSupport();
  if (nav === 'carteira') renderWallet();
  if (nav === 'jogar') showGame(currentGame);
}

let currentGame = 'bj';

function showGame(game) {
  currentGame = game;
  $$('.game-tab').forEach((b) => b.classList.toggle('active', b.dataset.game === game));
  $('#game-bj').classList.toggle('hidden', game !== 'bj');
  $('#game-pk').classList.toggle('hidden', game !== 'pk');
  if (game === 'bj') enterJogar();
  else enterPoker();
}

async function refreshConversations() {
  const { conversations } = await api.conversations();
  state.conversations = conversations;
  renderConversations();
}

async function refreshFriends() {
  state.friends = await api.friends();
  renderFriends();
}

async function refreshWallet() {
  const [{ wallet, rate }, { transactions }] = await Promise.all([api.wallet(), api.transactions()]);
  state.wallet = wallet;
  state.rate = rate;
  state.transactions = transactions;
  renderWallet();
  renderUserbar();
}

async function refreshMe() {
  try {
    const { user, wallet } = await api.me();
    state.user = { ...state.user, ...user };
    if (wallet) state.wallet = wallet;
  } catch {
    // mantém o que já temos
  }
}

function renderConversations() {
  const list = $('#convo-list');
  if (!state.conversations.length) {
    list.innerHTML = '<p style="color:var(--muted)">Nenhuma conversa ainda. Adicione amigos e comece por uma.</p>';
  } else {
    list.innerHTML = state.conversations.map((c) => `
      <button class="convo-item ${c.id === state.activeConversationId ? 'active' : ''}" data-conv="${c.id}">
        ${convAvatar(c)}
        <span class="body">
          <strong>${escapeHtml(c.name)}</strong>
          <small>${c.lastMessage ? `${escapeHtml(c.lastMessage.senderName || '')}: ${escapeHtml(c.lastMessage.body)}` : 'Sem mensagens'}</small>
        </span>
        ${c.unread ? `<span class="unread">${c.unread}</span>` : ''}
      </button>`).join('');
    $$('.convo-item', list).forEach((b) => { b.onclick = () => openChat(Number(b.dataset.conv)); });
  }
  const unread = totalUnread();
  $('#nav-badge-conversas').textContent = unread ? String(unread) : '';
  const reqs = totalFriendRequests();
  $('#nav-badge-amigos').textContent = reqs ? String(reqs) : '';
}

function renderFriends() {
  const box = $('#friend-list');
  const { friends } = state.friends;
  box.innerHTML = friends.length
    ? friends.map((f) => `
      <button class="friend-item" data-friend="${f.id}">
        ${userAvatarHtml(f)}
        <span class="grow">
          <strong>${escapeHtml(f.displayName)} <span class="online-dot ${state.online.has(f.id) ? 'on' : ''}"></span></strong>
          <small>@${escapeHtml(f.nickname)}${f.statusText ? ' · ' + escapeHtml(f.statusText) : ''}</small>
        </span>
      </button>`).join('')
    : '<p style="color:var(--muted)">Você ainda não tem amigos. Busque pelo apelido acima.</p>';
  $$('.friend-item', box).forEach((b) => {
    b.onclick = () => openProfileCard(Number(b.dataset.friend));
  });

  const reqBox = $('#friend-requests');
  const { incoming, outgoing } = state.friends;
  let html = '';
  if (incoming.length) {
    html += `<div class="req-block"><h4>Pedidos recebidos</h4>${incoming.map((r) => `
      <div class="req-row">${userAvatarHtml(r, 'sm')}
        <span class="grow">${escapeHtml(r.displayName)} <small>@${escapeHtml(r.nickname)}</small></span>
        <span class="req-actions">
          <button class="btn primary" data-accept="${r.requestId}">Aceitar</button>
          <button class="btn ghost" data-decline="${r.requestId}">Recusar</button>
        </span>
      </div>`).join('')}</div>`;
  }
  if (outgoing.length) {
    html += `<div class="req-block"><h4>Pedidos enviados</h4>${outgoing.map((r) => `
      <div class="req-row">${userAvatarHtml(r, 'sm')}
        <span class="grow">${escapeHtml(r.displayName)} <small>aguardando…</small></span>
        <button class="btn ghost" data-cancel="${r.id}">Cancelar</button>
      </div>`).join('')}</div>`;
  }
  reqBox.innerHTML = html;
  $$('[data-accept]', reqBox).forEach((b) => b.onclick = async () => { await api.acceptFriend(Number(b.dataset.accept)); refreshFriends(); });
  $$('[data-decline]', reqBox).forEach((b) => b.onclick = async () => { await api.declineFriend(Number(b.dataset.decline)); refreshFriends(); });
  $$('[data-cancel]', reqBox).forEach((b) => b.onclick = async () => { await api.removeFriend(Number(b.dataset.cancel)); refreshFriends(); });
  renderConversations();
}

async function openProfileCard(userId) {
  const { user, friend } = await api.getUser(userId);
  const online = state.online.has(user.id);
  const isMe = user.id === state.user.id;
  openModal(`
    <div class="avatar-preview">
      ${userAvatarHtml(user, 'lg')}
      <div>
        <h3 style="margin:0">${escapeHtml(user.displayName)}</h3>
        <div style="color:var(--muted)">@${escapeHtml(user.nickname)} · ${online ? 'online' : 'offline'}</div>
        ${user.statusText ? `<div style="margin-top:4px">“${escapeHtml(user.statusText)}”</div>` : ''}
      </div>
    </div>
    ${user.bio ? `<p>${escapeHtml(user.bio)}</p>` : ''}
    <div class="modal-actions">
      ${isMe ? '' : '<button class="btn" id="pm-dm">Mensagem</button>'}
      ${!isMe && friend.status === 'none' ? '<button class="btn primary" id="pm-add">Adicionar amigo</button>' : ''}
      ${friend.status === 'friends' ? `<button class="btn danger" id="pm-remove">Remover amigo</button>` : ''}
      <button class="btn ghost" id="pm-close">Fechar</button>
    </div>`);
  $('#pm-close').onclick = closeModal;
  if ($('#pm-add')) $('#pm-add').onclick = async () => { await api.addFriend({ userId }); closeModal(); refreshFriends(); toast('Pedido enviado.'); };
  if ($('#pm-remove')) $('#pm-remove').onclick = async () => { await api.removeFriend(userId); closeModal(); refreshFriends(); };
  if ($('#pm-dm')) $('#pm-dm').onclick = async () => {
    const { conversation } = await api.openDm(userId);
    closeModal();
    upsertConversation(conversation);
    await refreshConversations();
    openChat(conversation.id);
  };
}

async function openChat(convId) {
  state.activeConversationId = convId;
  const conv = state.conversations.find((c) => c.id === convId);
  if (conv) conv.unread = 0;
  renderConversations();
  const chat = $('#chat-pane');
  chat.classList.remove('hidden');
  requestAnimationFrame(() => chat.classList.add('open'));
  $('#chat-avatar').innerHTML = conv ? convAvatar(conv) : '';
  $('#chat-name').textContent = conv ? conv.name : '';
  renderChatSub(conv);
  $('#chat-add-member').style.display = conv && conv.type === 'group' ? '' : 'none';
  const { messages } = await api.messages(convId);
  state.messages[convId] = messages;
  renderMessages();
  api.read(convId);
  socket?.emit('conversation:read', { conversationId: convId });
  socket?.emit('conversation:join', { conversationId: convId });
  if (conv) conv.unread = 0;
  renderConversations();
}

function renderChatSub(conv) {
  const sub = $('#chat-sub');
  if (!conv) { sub.textContent = ''; return; }
  if (conv.type === 'dm') {
    const other = conv.members.find((m) => m.id !== state.user.id);
    sub.textContent = other && state.online.has(other.id) ? 'online' : 'offline';
    return;
  }
  if (conv.type === 'global') {
    sub.textContent = `${state.online.size} online · mural de todos`;
    return;
  }
  const onlineMembers = conv.members.filter((m) => state.online.has(m.id)).length;
  sub.textContent = `${conv.members.length} membros · ${onlineMembers} online`;
}

function closeChat() {
  const chat = $('#chat-pane');
  chat.classList.remove('open');
  state.activeConversationId = null;
  setTimeout(() => chat.classList.add('hidden'), 260);
  renderConversations();
}

function renderMessages() {
  const box = $('#messages');
  const list = state.messages[state.activeConversationId] || [];
  const conv = state.conversations.find((c) => c.id === state.activeConversationId);
  box.innerHTML = list.map((m) => {
    if (m.senderId === state.user.id) {
      return `<div class="msg mine">
        <div class="bubble"><div>${escapeHtml(m.body)}</div><div class="time">${formatTime(m.createdAt)}</div></div>
      </div>`;
    }
    const showSender = conv && conv.type !== 'dm';
    const member = conv?.members?.find((mm) => mm.id === m.senderId);
    const senderAvatar = member
      ? userAvatarHtml(member, 'sm')
      : avatarHtml(m.senderAvatar || '👤', m.senderColor || '#64748b', 'sm');
    return `<div class="msg">
      ${senderAvatar}
      <div class="bubble">
        ${showSender ? `<div class="sender">${escapeHtml(m.senderName || '')}</div>` : ''}
        <div>${escapeHtml(m.body)}</div>
        <div class="time">${formatTime(m.createdAt)}</div>
      </div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendCurrent(body) {
  const convId = state.activeConversationId;
  if (!convId || !body.trim()) return;
  if (socket && socket.connected) {
    socket.emit('message:send', { conversationId: convId, body }, (res) => {
      if (!res?.ok) api.sendMessage(convId, body).then((r) => handleIncoming(r.message)).catch((e) => toast(e.message));
    });
  } else {
    try {
      const { message } = await api.sendMessage(convId, body);
      handleIncoming(message);
    } catch (e) {
      toast(e.message);
    }
  }
}

function renderWallet() {
  const { fichas, gemas } = state.wallet;
  $('#wallet-cards').innerHTML = `
    <div class="coin-card fichas">
      <span class="coin-ico" aria-hidden="true">🪙</span>
      <div class="label">Fichas</div>
      <div class="amount">${fichas.toLocaleString('pt-BR')}</div>
      <div class="coin-sub">apostas nas mesas de 21 e poker</div>
    </div>
    <div class="coin-card gemas">
      <span class="coin-ico" aria-hidden="true">💎</span>
      <div class="label">Gemas</div>
      <div class="amount">${gemas.toLocaleString('pt-BR')}</div>
      <div class="coin-sub">troque por fichas quando quiser</div>
    </div>`;
  const { gemasParaFichas, spread } = state.rate;
  $('#rate-note').textContent = `1 💎 = ${gemasParaFichas} 🪙 · 1 🪙 ≈ ${(spread / gemasParaFichas).toFixed(3)} 💎 (conversão nos dois sentidos)`;
  const txs = state.transactions || [];
  $('#tx-list').innerHTML = txs.length
    ? txs.map((t) => `
      <div class="tx-row">
        <span>${t.currency === 'gemas' ? '💎' : '🪙'} ${escapeHtml(t.note || t.kind)}<div class="meta">${formatDateTime(t.createdAt)}</div></span>
        <span class="tx-amount ${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : ''}${t.amount}</span>
      </div>`).join('')
    : '<p style="color:var(--muted)">Sem movimentações ainda.</p>';
  updateConvertPreview();
}

function updateConvertPreview() {
  const from = $('#convert-from').value;
  const to = $('#convert-to').value;
  const amount = Math.max(0, Math.floor(Number($('#convert-amount').value) || 0));
  const { gemasParaFichas, spread } = state.rate;
  let received = 0;
  if (from !== to && amount > 0) {
    received = from === 'gemas'
      ? Math.floor(amount * gemasParaFichas)
      : Math.floor((amount * spread) / gemasParaFichas);
  }
  const label = { fichas: '🪙 Fichas', gemas: '💎 Gemas' };
  $('#convert-preview').textContent = from === to
    ? 'Escolha moedas diferentes.'
    : amount > 0 ? `${amount} ${label[from]} → ${received} ${label[to]}` : '';
}

function drawCharPreview() {
  const zone = $('#char-preview');
  zone.innerHTML = '';
  zone.appendChild(characterCanvas(charPick, 118, { dpr: 2 }));
}

function renderCharCustomizer() {
  const mark = (key, val) => {
    $$(`#pick-${key} > *`).forEach((b) => b.classList.toggle('active', b.dataset.val === val));
  };
  const build = (key, values, fmt) => {
    $(`#pick-${key}`).innerHTML = values.map(fmt).join('');
    $$(`#pick-${key} > *`).forEach((b) => {
      b.onclick = () => { charPick[key] = b.dataset.val; mark(key, b.dataset.val); drawCharPreview(); };
    });
  };
  const swatch = (c) => `<button type="button" class="swatch" data-val="${c}" style="background:${c}" title="${c}"></button>`;
  build('skin', AVATAR_SKINS, swatch);
  build('hair', AVATAR_HAIRS, swatch);
  build('shirt', AVATAR_SHIRTS, swatch);
  build('hat', AVATAR_HATS, (h) => `<button type="button" class="hat-btn" data-val="${h}">${HAT_LABEL[h]}</button>`);
  mark('skin', charPick.skin);
  mark('hair', charPick.hair);
  mark('shirt', charPick.shirt);
  mark('hat', charPick.hat);
}

// Desenha a foto escolhida num canvas 256x256 (recorte quadrado "cover") e
// gera um JPEG enxuto em data URL — mesma imagem que o PATCH /api/me espera.
function handlePhotoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Escolha um arquivo de imagem.');
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const S = 256;
      const canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(S / img.width, S / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.fillStyle = '#0a1410';
      ctx.fillRect(0, 0, S, S);
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      pendingPhoto = canvas.toDataURL('image/jpeg', 0.82);
      renderAvatarPreview();
      toast('Foto pronta! Toque em "Salvar perfil" para valer.');
    };
    img.onerror = () => toast('Não consegui abrir essa imagem.');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function renderAvatarPreview() {
  const u = state.user;
  const form = $('#profile-form');
  const color = form.color.value || u.color;
  const emoji = form.avatar.value || u.avatar;
  const name = form.displayName.value || u.displayName;
  let av;
  if (typeof pendingPhoto === 'string') {
    av = `<span class="avatar lg has-photo" style="background:${color}22;border-color:${color}55"><img class="avatar-img" src="${pendingPhoto}" alt=""></span>`;
  } else {
    const hasPhoto = pendingPhoto === null ? false : !!u.hasPhoto;
    av = userAvatarHtml({ id: u.id, avatar: emoji, color, hasPhoto, photoToken: u.photoToken }, 'lg');
  }
  $('#avatar-preview').innerHTML = `${av}<div><strong>${escapeHtml(name)}</strong><div style="color:var(--muted)">@${escapeHtml(u.nickname)}</div></div>`;
  const hasAnyPhoto = typeof pendingPhoto === 'string' || (pendingPhoto !== null && !!u.hasPhoto);
  $('#btn-remove-photo').classList.toggle('hidden', !hasAnyPhoto);
}

function renderProfile() {
  const u = state.user;
  const form = $('#profile-form');
  pendingPhoto = undefined;
  form.displayName.value = u.displayName;
  form.avatar.value = u.avatar;
  form.color.value = u.color;
  form.statusText.value = u.statusText || '';
  form.bio.value = u.bio || '';
  const email = $('#account-email');
  if (email) email.value = u.email || '';
  const pwWrap = $('#current-password-wrap');
  if (pwWrap) pwWrap.classList.toggle('hidden', !u.hasPassword);
  const pw = $('#account-password');
  if (pw) pw.value = '';
  const cur = $('#account-current');
  if (cur) cur.value = '';
  charPick = avatarSpec(u);
  celebPick = u.celebration || 'confetti';
  renderCharCustomizer();
  drawCharPreview();
  const celeb = $('#celeb-pick');
  if (celeb) {
    celeb.innerHTML = CELEBRATIONS.map((c) => `<button type="button" class="chip ${c.id === celebPick ? 'active' : ''}" data-celeb="${c.id}" title="${escapeHtml(c.label)}">${c.icon}</button>`).join('');
    $$('#celeb-pick .chip').forEach((b) => {
      b.onclick = () => {
        $$('#celeb-pick .chip').forEach((x) => x.classList.toggle('active', x === b));
        celebPick = b.dataset.celeb;
      };
    });
  }
  renderAvatarPreview();
  $('#emoji-row').innerHTML = AVATARS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
  $$('#emoji-row button').forEach((b) => {
    b.onclick = () => { form.avatar.value = b.dataset.emoji; renderAvatarPreview(); };
  });
}

// --- Mural de suporte (público) ---

function normalizeAuthor(a) {
  if (!a) return { id: null, nickname: '', displayName: 'Anônimo', avatar: '👤', color: '#64748b', hasPhoto: false };
  if (a.displayName != null || a.hasPhoto != null) return a;
  return {
    id: a.id,
    nickname: a.nickname,
    displayName: a.display_name || a.nickname || 'Anônimo',
    avatar: a.avatar,
    color: a.color,
    hasPhoto: !!a.avatar_image,
  };
}

function normalizeSupportPost(p) {
  return { id: p.id, body: p.body, createdAt: p.createdAt || p.created_at, author: normalizeAuthor(p.author) };
}

async function renderSupport() {
  const list = $('#support-list');
  list.innerHTML = '<p class="muted">Carregando o mural…</p>';
  try {
    const { posts } = await api.support(100);
    supportPosts = (posts || []).map(normalizeSupportPost);
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    return;
  }
  renderSupportPosts();
}

function renderSupportPosts() {
  const list = $('#support-list');
  if (!supportPosts.length) {
    list.innerHTML = '<div class="support-empty"><span class="support-empty-ico">💡</span><p>Ninguém comentou ainda. Escreva a primeira ideia!</p></div>';
    return;
  }
  list.innerHTML = supportPosts.map((p) => {
    const a = p.author;
    const mine = a.id != null && a.id === state.user.id;
    return `<article class="support-post" data-id="${p.id}">
      ${userAvatarHtml(a, 'md')}
      <div class="support-body">
        <div class="support-head">
          <strong>${escapeHtml(a.displayName || a.nickname || 'Anônimo')}</strong>
          <span class="support-when">${formatDateTime(p.createdAt)}</span>
        </div>
        <p class="support-text">${escapeHtml(p.body)}</p>
      </div>
      ${mine ? `<button class="btn ghost support-del" data-del="${p.id}" title="Apagar" aria-label="Apagar publicação">🗑️</button>` : ''}
    </article>`;
  }).join('');
  $$('.support-del', list).forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.del);
      if (!confirm('Apagar esta publicação?')) return;
      try {
        await api.deleteSupportPost(id);
        supportPosts = supportPosts.filter((p) => p.id !== id);
        renderSupportPosts();
        toast('Publicação apagada.');
      } catch (e) {
        toast(e.message);
      }
    };
  });
}

function updateSupportCount() {
  const input = $('#support-input');
  if (input) $('#support-count').textContent = `${input.value.length}/1000`;
}

function openGroupModal() {
  const friends = state.friends.friends;
  if (!friends.length) return toast('Adicione amigos primeiro.');
  openModal(`
    <h3>Novo grupo</h3>
    <label>Nome do grupo<input id="group-name" maxlength="60" placeholder="Mesa do poker" /></label>
    <div>${friends.map((f) => `
      <label class="member-pick"><input type="checkbox" value="${f.id}" /> ${userAvatarHtml(f, 'sm')} <span>${escapeHtml(f.displayName)}</span></label>`).join('')}</div>
    <div class="modal-actions">
      <button class="btn ghost" id="group-cancel">Cancelar</button>
      <button class="btn primary" id="group-create">Criar</button>
    </div>`);
  $('#group-cancel').onclick = closeModal;
  $('#group-create').onclick = async () => {
    const name = $('#group-name').value.trim();
    const memberIds = $$('.member-pick input:checked').map((i) => Number(i.value));
    if (!memberIds.length) return toast('Escolha ao menos um amigo.');
    const { conversation } = await api.createGroup({ name, memberIds });
    closeModal();
    await refreshConversations();
    toast('Grupo criado!');
    openChat(conversation.id);
  };
}

async function openAddMemberModal() {
  const conv = state.conversations.find((c) => c.id === state.activeConversationId);
  if (!conv) return;
  const memberIds = new Set(conv.members.map((m) => m.id));
  const candidates = state.friends.friends.filter((f) => !memberIds.has(f.id));
  if (!candidates.length) return toast('Todos os seus amigos já estão no grupo.');
  openModal(`
    <h3>Adicionar ao grupo</h3>
    <div>${candidates.map((f) => `
      <label class="member-pick"><input type="checkbox" value="${f.id}" /> ${userAvatarHtml(f, 'sm')} <span>${escapeHtml(f.displayName)}</span></label>`).join('')}</div>
    <div class="modal-actions">
      <button class="btn ghost" id="add-cancel">Cancelar</button>
      <button class="btn primary" id="add-confirm">Adicionar</button>
    </div>`);
  $('#add-cancel').onclick = closeModal;
  $('#add-confirm').onclick = async () => {
    const ids = $$('.member-pick input:checked').map((i) => Number(i.value));
    for (const id of ids) await api.addMember(conv.id, id);
    closeModal();
    const { conversation } = await api.conversation(conv.id);
    upsertConversation(conversation);
    renderConversations();
    toast('Adicionados ao grupo.');
  };
}

async function finishAuth(data) {
  setToken(data.token);
  state.user = data.user;
  state.wallet = data.wallet;
  try {
    const me = await api.me();
    state.user = me.user;
    state.wallet = me.wallet;
  } catch {
    // segue com o que veio do login
  }
  await enterApp();
}

function setAuthMode(mode) {
  $$('#auth-modes .tab').forEach((b) => b.classList.toggle('active', b.dataset.authTab === mode));
  $$('[data-auth-pane]').forEach((el) => el.classList.toggle('hidden', el.dataset.authPane !== mode));
}

function setHaveMode(mode) {
  $$('#have-modes .tab').forEach((b) => b.classList.toggle('active', b.dataset.haveTab === mode));
  $$('[data-have-pane]').forEach((el) => el.classList.toggle('hidden', el.dataset.havePane !== mode));
}

function wireEvents() {
  window.addEventListener('open-chat', (e) => {
    if (typeof e.detail === 'number') openChat(e.detail);
  });

  $$('#auth-modes .tab').forEach((b) => b.onclick = () => setAuthMode(b.dataset.authTab));
  $$('#have-modes .tab').forEach((b) => b.onclick = () => setHaveMode(b.dataset.haveTab));

  $('#enter-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#auth-error').textContent = '';
    try {
      const data = await api.enter({ nickname: f.nickname.value, displayName: f.displayName.value });
      await finishAuth(data);
    } catch (err) { $('#auth-error').textContent = err.message; }
  };

  $('#reserve-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#auth-error').textContent = '';
    try {
      const data = await api.loginReserve({ nickname: f.nickname.value, email: f.email.value });
      await finishAuth(data);
    } catch (err) { $('#auth-error').textContent = err.message; }
  };

  $('#password-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#auth-error').textContent = '';
    try {
      const data = await api.login({ nickname: f.nickname.value, password: f.password.value });
      await finishAuth(data);
    } catch (err) { $('#auth-error').textContent = err.message; }
  };

  $$('.nav-btn').forEach((b) => b.onclick = () => switchNav(b.dataset.nav));
  $('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');

  $('#btn-new-group').onclick = openGroupModal;
  $('#chat-add-member').onclick = openAddMemberModal;
  $('#chat-back').onclick = closeChat;
  $('#bj-create').onclick = openCreateTable;
  $('#bj-leave').onclick = () => leaveTable();
  $('#bj-rank').onclick = openRank;
  $('#bj-invite').onclick = openInvite;
  $('#bj-invite2').onclick = openInvite;
  $('#btn-invite').onclick = openInvite;

  $$('.game-tab').forEach((b) => { b.onclick = () => showGame(b.dataset.game); });
  $('#pk-create').onclick = openPokerCreate;
  $('#pk-leave').onclick = () => leavePokerTable();
  $('#pk-rank').onclick = openRank;
  $('#pk-invite').onclick = openInvite;
  $('#pk-invite2').onclick = openInvite;

  $('#srv-here').textContent = location.origin;
  const lastServer = localStorage.getItem('cartas_server') || '';
  if ($('#lan-url')) {
    $('#lan-url').value = lastServer;
    $('#lan-go').onclick = () => {
      const u = $('#lan-url').value.trim();
      if (!u) return toast('Digite o endereço do servidor.');
      localStorage.setItem('cartas_server', u);
      location.href = u;
    };
  }

  $('#composer').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#composer-input');
    const body = input.value.trim();
    if (!body) return;
    sendCurrent(body);
    input.value = '';
    input.style.height = 'auto';
    socket?.emit('typing', { conversationId: state.activeConversationId, typing: false });
  };

  const input = $('#composer-input');
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    if (!state.activeConversationId) return;
    if (socket?.connected) {
      socket.emit('typing', { conversationId: state.activeConversationId, typing: true });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => socket.emit('typing', { conversationId: state.activeConversationId, typing: false }), 1500);
    }
  };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } };

  $('#friend-search').oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    const box = $('#friend-search-results');
    if (q.length < 1) { box.innerHTML = ''; return; }
    const { users } = await api.searchUsers(q);
    box.innerHTML = users.map((u) => `
      <div class="search-result">
        ${userAvatarHtml(u, 'sm')}
        <span class="grow"><strong>${escapeHtml(u.displayName)}</strong><small>@${escapeHtml(u.nickname)}</small></span>
        <button class="btn primary" data-add="${u.id}">Adicionar</button>
      </div>`).join('') || '<div class="search-result">Ninguém encontrado.</div>';
    $$('[data-add]', box).forEach((b) => b.onclick = async () => {
      try { await api.addFriend({ userId: Number(b.dataset.add) }); toast('Pedido enviado.'); }
      catch (err) { toast(err.message); }
      refreshFriends();
    });
  }, 300);

  $('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = {
      displayName: f.displayName.value,
      avatar: f.avatar.value,
      color: f.color.value,
      statusText: f.statusText.value,
      bio: f.bio.value,
      skin: charPick.skin,
      hair: charPick.hair,
      shirt: charPick.shirt,
      hat: charPick.hat,
      celebration: celebPick,
    };
    // Só envia avatarImage quando a foto mudou (nova foto ou remoção).
    if (pendingPhoto !== undefined) payload.avatarImage = pendingPhoto;
    try {
      const data = await api.updateProfile(payload);
      state.user = {
        ...state.user,
        ...data.user,
        photoToken: pendingPhoto !== undefined ? Date.now() : state.user.photoToken,
      };
      pendingPhoto = undefined;
      toast('Perfil salvo!');
      renderProfile();
      renderUserbar();
    } catch (err) {
      toast(err.message);
    }
  };

  // Preview ao vivo do avatar no perfil
  const pf = $('#profile-form');
  pf.color.oninput = renderAvatarPreview;
  pf.displayName.oninput = renderAvatarPreview;

  $('#btn-choose-photo').onclick = () => $('#avatar-file').click();
  $('#avatar-file').onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    handlePhotoFile(file);
    e.target.value = '';
  };
  $('#btn-remove-photo').onclick = () => {
    pendingPhoto = null;
    renderAvatarPreview();
    toast('A foto será removida ao salvar.');
  };

  $('#email-save').onclick = async () => {
    const value = $('#account-email').value.trim();
    try {
      await api.updateProfile({ email: value || null });
      await refreshMe();
      toast('Email salvo!');
      renderProfile();
    } catch (err) { toast(err.message); }
  };

  $('#password-save').onclick = async () => {
    const newPassword = $('#account-password').value;
    if (!newPassword) return toast('Digite a nova senha.');
    const payload = { newPassword };
    if (state.user.hasPassword) payload.currentPassword = $('#account-current').value;
    try {
      await api.updateProfile(payload);
      await refreshMe();
      toast('Senha salva!');
      renderProfile();
    } catch (err) { toast(err.message); }
  };

  $('#support-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#support-input');
    const body = input.value.trim();
    if (!body) return toast('Escreva algo antes de publicar.');
    const btn = $('#support-submit');
    btn.disabled = true;
    try {
      const { post } = await api.createSupportPost(body);
      supportPosts.unshift(normalizeSupportPost(post));
      input.value = '';
      updateSupportCount();
      renderSupportPosts();
      toast('Publicado!');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
  $('#support-input').oninput = updateSupportCount;

  $('#convert-from').onchange = () => {
    if ($('#convert-from').value === $('#convert-to').value) $('#convert-to').value = $('#convert-from').value === 'gemas' ? 'fichas' : 'gemas';
    updateConvertPreview();
  };
  $('#convert-to').onchange = updateConvertPreview;
  $('#convert-amount').oninput = updateConvertPreview;
  $('#convert-swap').onclick = () => {
    const a = $('#convert-from').value;
    $('#convert-from').value = $('#convert-to').value;
    $('#convert-to').value = a;
    updateConvertPreview();
  };
  $('#convert-btn').onclick = async () => {
    const from = $('#convert-from').value;
    const to = $('#convert-to').value;
    const amount = Math.floor(Number($('#convert-amount').value) || 0);
    if (from === to) return toast('Escolha moedas diferentes.');
    try {
      const data = await api.convert({ from, to, amount });
      state.wallet = data.wallet;
      toast(`Convertido! Você recebeu ${data.received} ${to}.`);
      await refreshWallet();
    } catch (err) { toast(err.message); }
  };
}

async function bootstrap() {
  initSound();
  wireEvents();
  if (getToken()) {
    try {
      const { user, wallet } = await api.me();
      state.user = user; state.wallet = wallet;
      await enterApp();
      return;
    } catch {
      setToken(null);
    }
  }
  showAuth();
}

bootstrap();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
