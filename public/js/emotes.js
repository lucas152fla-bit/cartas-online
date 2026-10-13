export const EMOTES = [
  { id: 'dedo', icon: '🖕', label: 'Tomar no c*', bubble: 'Vai tomar no c*, seu mão de vaca! 🖕' },
  { id: 'bunda', icon: '🍑', label: 'Ó o tamanho', bubble: 'Olha o tamanho dessa bunda! 🍑' },
  { id: 'punheta', icon: '✊', label: 'Bora bater', bubble: 'Tô batendo uma pensando na sua jogada 😏' },
  { id: 'chifre', icon: '🐂', label: 'Passando o chifre', bubble: 'Tô passando o chifre em você, otário! 🐂' },
  { id: 'beijo', icon: '😘', label: 'Manda um beijo', bubble: 'Manda um beijo pra mim, gostoso 😘' },
  { id: 'gemido', icon: '😩', label: 'Aiii', bubble: 'Aiii que delícia de all-in! 😩' },
  { id: 'vomito', icon: '🤮', label: 'Que nojo', bubble: 'Aff que mão horrível, deu ânsia 🤮' },
  { id: 'chorao', icon: '😭', label: 'Chora mais', bubble: 'Ai ai, chora não bebê 😭' },
  { id: 'gargalhada', icon: '🤣', label: 'Rindo de você', bubble: 'KKKKKK tomando raia de novo, otário!' },
  { id: 'banana', icon: '🍌', label: 'Toma banana', bubble: 'Toma essa banana, seu palhaço 🍌' },
];

const BY_ID = new Map(EMOTES.map((e) => [e.id, e]));

export function emoteById(id) {
  return BY_ID.get(id) || null;
}
