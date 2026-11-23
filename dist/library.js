import { listGames } from './games/catalog.js';

// Preserve previously shared game links, including a GitHub Pages project prefix.
const requested = new URLSearchParams(location.search).get('game');
if (requested) {
  const target = new URL('./play.html', location.href);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
} else {
  const games = listGames();
  document.getElementById('gameCount').textContent = String(games.length).padStart(2, '0');
  const list = document.getElementById('gameList');
  for (const game of games) {
    const card = document.createElement('article');
    card.className = 'game-card';
    const image = document.createElement('div');
    image.className = 'game-image';
    image.setAttribute('aria-hidden', 'true');
    if (game.cover) {
      const photo = document.createElement('img');
      photo.src = game.cover;
      photo.alt = '';
      photo.decoding = 'async';
      image.append(photo);
    }
    const tag = document.createElement('span');
    tag.className = 'game-tag';
    tag.textContent = game.genre || 'أركيد';
    image.append(tag);
    const details = document.createElement('div');
    details.className = 'game-details';
    const label = document.createElement('span');
    label.className = 'game-type';
    label.dir = 'ltr';
    label.textContent = 'LASER LAB ORIGINAL';
    const title = document.createElement('h3');
    title.dir = 'auto';
    title.textContent = game.title;
    const description = document.createElement('p');
    description.textContent = game.description;
    const input = document.createElement('span');
    input.className = 'input-types';
    input.textContent = 'ليزر وكاميرا · ماوس ولمس';
    const link = document.createElement('a');
    link.className = 'play-link';
    link.href = './play.html?game=' + encodeURIComponent(game.slug);
    link.textContent = 'ابدأ اللعب';
    link.setAttribute('aria-label', 'ابدأ لعب ' + game.title);
    details.append(label, title, description, input, link);
    card.append(image, details);
    list.append(card);
  }
  if (!games.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'الألعاب هتظهر هنا قريبًا.';
    list.append(empty);
  }
}
