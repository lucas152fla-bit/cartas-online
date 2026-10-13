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
  return `<span class="avatar ${size}" style="background:${color}22;border-color:${color}55">${escapeHtml(avatar)}</span>`;
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
