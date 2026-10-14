let token = localStorage.getItem('cartas_token') || null;

export const getToken = () => token;
export const setToken = (value) => {
  token = value;
  if (value) localStorage.setItem('cartas_token', value);
  else localStorage.removeItem('cartas_token');
};

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const patch = (p, b) => request('PATCH', p, b);
const del = (p) => request('DELETE', p);

export const api = {
  guest: () => post('/api/guest'),
  enter: (b) => post('/api/enter', b),
  register: (b) => post('/api/register', b),
  login: (b) => post('/api/login', b),
  loginReserve: (b) => post('/api/login-reserve', b),
  me: () => get('/api/me'),
  updateProfile: (b) => patch('/api/me', b),
  support: (limit = 100) => get(`/api/support?limit=${encodeURIComponent(limit)}`),
  createSupportPost: (body) => post('/api/support', { body }),
  deleteSupportPost: (id) => del(`/api/support/${id}`),
  searchUsers: (q) => get(`/api/users/search?q=${encodeURIComponent(q)}`),
  getUser: (id) => get(`/api/users/${id}`),
  friends: () => get('/api/friends'),
  addFriend: (b) => post('/api/friends/request', b),
  acceptFriend: (id) => post(`/api/friends/${id}/accept`),
  declineFriend: (id) => post(`/api/friends/${id}/decline`),
  removeFriend: (id) => del(`/api/friends/${id}`),
  conversations: () => get('/api/conversations'),
  openDm: (userId) => post('/api/conversations/dm', { userId }),
  createGroup: (b) => post('/api/conversations/group', b),
  conversation: (id) => get(`/api/conversations/${id}`),
  messages: (id, before = 0) => get(`/api/conversations/${id}/messages?before=${before}`),
  sendMessage: (id, body) => post(`/api/conversations/${id}/messages`, { body }),
  read: (id) => post(`/api/conversations/${id}/read`),
  addMember: (id, userId) => post(`/api/conversations/${id}/members`, { userId }),
  wallet: () => get('/api/wallet'),
  transactions: () => get('/api/wallet/transactions'),
  convert: (b) => post('/api/wallet/convert', b),
  global: () => get('/api/global'),
  tables: () => get('/api/tables'),
  createTable: (b) => post('/api/tables', b),
  pokerTables: () => get('/api/poker/tables'),
  createPokerTable: (b) => post('/api/poker/tables', b),
  rank: (game) => get(`/api/rank${game ? `?game=${encodeURIComponent(game)}` : ''}`),
};
