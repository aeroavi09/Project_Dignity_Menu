import { loadBlueberryFont } from './fonts.js';

// Top-left HUD, under the Main Menu button (homeButton.js): a heart holding the number of bags
// finished this session, inked in the same black line as everything in the room.
const STYLE = `
.bag-counter {
  position: fixed; left: 20px; top: 74px; z-index: 15000;
  width: 84px; height: 76px;
  pointer-events: none; user-select: none;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.25));
}
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
  .bag-counter.pop { animation: none; }
}
`;

const HEART =
  'M50 86 C18 62 4 45 4 28 C4 13 15 4 28 4 C38 4 46 10 50 19 C54 10 62 4 72 4 C85 4 96 13 96 28 C96 45 82 62 50 86 Z';

export function createBagCounter() {
  loadBlueberryFont();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'bag-counter';
  el.setAttribute('role', 'status');
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
    el.setAttribute('aria-label', `${count} bag${count === 1 ? '' : 's'} completed`);
  }
  render();

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
