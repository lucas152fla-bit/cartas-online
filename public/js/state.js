export const state = {
  user: null,
  wallet: { fichas: 0, gemas: 0 },
  rate: { gemasParaFichas: 10, spread: 0.9 },
  conversations: [],
  friends: { friends: [], incoming: [], outgoing: [] },
  online: new Set(),
  activeConversationId: null,
  messages: {},
  nav: 'conversas',
};

export function sortConversations() {
  state.conversations.sort((a, b) => {
    const am = a.lastMessage ? a.lastMessage.id : 0;
    const bm = b.lastMessage ? b.lastMessage.id : 0;
    return bm - am;
  });
}

export function upsertConversation(conv) {
  const idx = state.conversations.findIndex((c) => c.id === conv.id);
  if (idx === -1) state.conversations.push(conv);
  else state.conversations[idx] = { ...state.conversations[idx], ...conv };
  sortConversations();
}

export function totalUnread() {
  return state.conversations.reduce((n, c) => n + (c.unread || 0), 0);
}

export function totalFriendRequests() {
  return state.friends.incoming.length;
}
