// Starts a Gamey game. In Gamey's preview the page is opened with ?live=1, which
// links it to the app so changes appear while Claude builds.
import { Game } from './core.js';

const q = new URLSearchParams(location.search);
const root = document.getElementById('game');
const game = new Game(root, { live: q.has('live'), paused: q.has('paused') });

// Used by Gamey's test runs: read the game's state and hold keys down.
window.__gamey = {
  game,
  ready: false,
  snapshot: () => game.snapshot(),
  hold: (keys) => { game.forced = new Set((keys || []).map((k) => String(k).toLowerCase())); },
  // Tap keys: pressed this frame and held for a moment, like a real key press.
  tap: (keys) => {
    for (const k of keys || []) {
      const key = String(k).toLowerCase();
      game.pressedNow.add(key);
      game.forced.add(key);
      setTimeout(() => game.forced.delete(key), 150);
    }
  },
  errors: () => game.errors.map((e) => `${e.level === 'warn' ? 'Warning: ' : ''}${e.text}`),
};

game.boot().then(() => { window.__gamey.ready = true; }).catch((err) => {
  game.report(err, 'Starting the game');
  window.__gamey.ready = true;
});
