export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, ms = 3200) {
  const host = $('#toast-host');
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .3s';
    setTimeout(() => node.remove(), 320);
  }, ms);
}

export function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function avatarHtml(avatar, color, size = '') {
  const bg = color || '#64748b';
  return `<span class="avatar ${size}" style="background:${bg}22;border-color:${bg}55"><span class="avatar-emoji">${escapeHtml(avatar)}</span></span>`;
}

// Renderiza o avatar de um usuário. Se ele tiver foto (hasPhoto), mostra a foto
// enviada em /api/avatar/<id>; caso contrário, cai no emoji (campo `avatar`).
// Aceita o objeto do usuário: { id, avatar, color, hasPhoto, photoToken? }.
export function userAvatarHtml(user, size = '') {
  const u = user && typeof user === 'object' ? user : { avatar: user };
  const avatar = u.avatar || '👤';
  const bg = u.color || '#64748b';
  const style = `background:${bg}22;border-color:${bg}55`;
  if (u.hasPhoto && u.id != null) {
    const src = `/api/avatar/${encodeURIComponent(u.id)}${u.photoToken ? `?v=${encodeURIComponent(u.photoToken)}` : ''}`;
    // Se a imagem falhar (404), volta para o emoji removendo a classe has-photo.
    return `<span class="avatar ${size} has-photo" style="${style}">`
      + `<img class="avatar-img" src="${src}" alt="" loading="lazy" onerror="this.closest('.avatar').classList.remove('has-photo')">`
      + `<span class="avatar-emoji">${escapeHtml(avatar)}</span></span>`;
  }
  return `<span class="avatar ${size}" style="${style}"><span class="avatar-emoji">${escapeHtml(avatar)}</span></span>`;
}

export function openModal(html, cls = '') {
  const host = $('#modal-host');
  const modal = $('#modal');
  modal.className = cls ? `modal ${cls}` : 'modal';
  modal.innerHTML = html;
  host.classList.remove('hidden');
  host.onclick = (e) => { if (e.target === host) closeModal(); };
}

export function closeModal() {
  $('#modal-host').classList.add('hidden');
  $('#modal').innerHTML = '';
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
