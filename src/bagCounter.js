import { loadBlueberryFont } from './fonts.js';

// Top-left HUD, under the Main Menu button (homeButton.js): a heart holding the number of bags
// finished this session, inked in the same black line as everything in the room. Clicking it
// opens a card with the total and a fact about what those bags mean.

// ESTIMATES -- rough, typical figures, not the charity's own numbers; swap in real ones when
// there are some. Each bag is one person's kit. The count passed in is always at least 1.
const SHOWERS_PER_SOAP = 30; // a bar of soap lasts about a month of daily showers
const FACTS = [
  (n) => `That's ${n} ${n === 1 ? 'kid' : 'kids'} with everything they need to stay clean and fresh.`,
  (n) => `A bar of soap lasts about a month of daily showers, so that's roughly ${n * SHOWERS_PER_SOAP} warm showers.`,
  (n) => `Every bag has a toothbrush and toothpaste, so that's ${n} more ${n === 1 ? 'smile' : 'smiles'} brushed morning and night.`,
];
const NO_BAGS_FACT = 'Each bag gives one kid everything they need to stay clean for about a month. Fill one to start!';

const STYLE = `
.bag-counter {
  position: fixed; left: 20px; top: 74px; z-index: 15000;
  width: 84px; height: 76px;
  padding: 0; border: none; background: none;
  cursor: pointer; user-select: none;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.25));
  transition: transform 0.12s ease;
}
.bag-counter:hover { transform: scale(1.08); }
.bag-counter:focus-visible { outline: 3px solid #00c6e8; outline-offset: 4px; border-radius: 12px; }
.bag-counter svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.bag-counter-count {
  position: absolute; left: 0; right: 0; top: 13px;
  text-align: center;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-size: 34px; line-height: 1;
  color: #fff;
  -webkit-text-stroke: 5px #000;
  paint-order: stroke fill;
}
.bag-counter.pop { animation: bag-counter-pop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
@keyframes bag-counter-pop {
  0% { transform: scale(1); }
  35% { transform: scale(1.28); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .bag-counter.pop, .bc-card { animation: none; }
}

/* The stats card: same look as the Settings panel. */
.bc-backdrop {
  position: fixed; inset: 0; z-index: 20000;
  background: rgba(20, 8, 30, 0.6);
  display: none; align-items: center; justify-content: center;
}
.bc-backdrop.open { display: flex; }
.bc-card {
  position: relative;
  background: linear-gradient(160deg, #fff4fb, #eaf7ff);
  border: 4px solid #ff2d86;
  border-radius: 24px;
  padding: 22px 28px 26px;
  width: min(380px, calc(100vw - 40px)); box-sizing: border-box;
  box-shadow: 0 20px 60px rgba(40, 10, 30, 0.4);
  text-align: center;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  animation: bc-pop 0.3s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}
@keyframes bc-pop { from { transform: scale(0.8); opacity: 0; } to { transform: none; opacity: 1; } }
.bc-card h2 {
  margin: 4px 0 12px;
  font-size: 36px; font-weight: normal; line-height: 1.1;
  color: #00e3ff;
  -webkit-text-stroke: 4px #af1ef9;
  paint-order: stroke fill;
}
.bc-card p { margin: 0; font-size: 20px; line-height: 1.35; color: #2a1020; }
.bc-close {
  position: absolute; top: 10px; right: 10px;
  border: 2px solid #00c6e8; background: #fff; color: #0090ad; cursor: pointer;
  width: 30px; height: 30px; border-radius: 50%;
  font-family: system-ui, -apple-system, sans-serif; font-size: 14px; font-weight: 700;
}
.bc-close:hover { background: #e6fbff; }
`;

const HEART =
  'M50 86 C18 62 4 45 4 28 C4 13 15 4 28 4 C38 4 46 10 50 19 C54 10 62 4 72 4 C85 4 96 13 96 28 C96 45 82 62 50 86 Z';

export function createBagCounter() {
  loadBlueberryFont();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'bag-counter';
  el.innerHTML = `
    <svg viewBox="0 0 100 90" aria-hidden="true">
      <path d="${HEART}" fill="#ff2d86" stroke="#000" stroke-width="6" stroke-linejoin="round"/>
      <path d="M24 22 C28 15 36 14 40 18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.7"/>
    </svg>
    <div class="bag-counter-count">0</div>`;
  document.body.appendChild(el);
  const countEl = el.querySelector('.bag-counter-count');

  let count = 0;
  function render() {
    countEl.textContent = String(count);
    el.setAttribute('aria-label', `${count} bag${count === 1 ? '' : 's'} completed. Show stats`);
  }
  render();

  const backdrop = document.createElement('div');
  backdrop.className = 'bc-backdrop';
  backdrop.innerHTML = `
    <div class="bc-card" role="dialog" aria-modal="true" aria-labelledby="bc-title" aria-describedby="bc-fact">
      <button type="button" class="bc-close" aria-label="Close">✕</button>
      <h2 id="bc-title"></h2>
      <p id="bc-fact"></p>
    </div>`;
  document.body.appendChild(backdrop);
  const card = backdrop.querySelector('.bc-card');
  let factIndex = 0;

  function openStats() {
    backdrop.querySelector('#bc-title').textContent =
      count === 0 ? 'No bags yet!' : `You filled ${count} bag${count === 1 ? '' : 's'}!`;
    // A different fact each time the card is opened.
    backdrop.querySelector('#bc-fact').textContent = count === 0 ? NO_BAGS_FACT : FACTS[factIndex++ % FACTS.length](count);
    card.style.animation = 'none';
    void card.offsetWidth; // replay the pop-in
    card.style.animation = '';
    backdrop.classList.add('open');
    backdrop.querySelector('.bc-close').focus();
  }
  function closeStats() {
    backdrop.classList.remove('open');
  }
  el.addEventListener('click', openStats);
  backdrop.querySelector('.bc-close').addEventListener('click', closeStats);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeStats();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStats();
  });

  function add() {
    count++;
    render();
    el.classList.remove('pop');
    void el.offsetWidth; // restart the animation on back-to-back bags
    el.classList.add('pop');
  }

  return {
    add,
    get count() {
      return count;
    },
  };
}
