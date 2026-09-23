import { loadBlueberryFont } from './fonts.js';

const STYLE = `
.home-btn {
  position: fixed; left: 20px; top: 20px; z-index: 15000;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 18px;
  border: 3px solid #00c6e8; border-radius: 999px;
  background: #fff;
  color: #0090ad;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px; font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 150, 190, 0.3);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.home-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(0, 150, 190, 0.4); }
.home-btn:active { transform: scale(0.96); }

/* The "leave the game?" card: same look as the Settings panel. */
.home-backdrop {
  position: fixed; inset: 0; z-index: 20000;
  background: rgba(20, 8, 30, 0.6);
  display: none; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
}
.home-backdrop.open { display: flex; }
.home-card {
  background: linear-gradient(160deg, #fff4fb, #eaf7ff);
  border: 4px solid #ff2d86;
  border-radius: 24px;
  padding: 18px 26px 22px;
  width: min(380px, calc(100vw - 40px));
  box-shadow: 0 20px 60px rgba(40, 10, 30, 0.4);
  text-align: center;
  animation: home-pop 0.18s ease-out;
}
@keyframes home-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.home-card h2 {
  margin: 0 0 6px;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-size: 34px; font-weight: normal;
  color: #00e3ff;
  -webkit-text-stroke: 4px #af1ef9;
  paint-order: stroke fill;
}
.home-card p {
  margin: 0 0 18px;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-size: 19px; color: #2a1020;
}
.home-actions { display: flex; gap: 12px; justify-content: center; }
.home-actions button {
  padding: 10px 22px;
  border-radius: 999px;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-size: 19px;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.home-actions button:hover { transform: translateY(-2px); }
.home-actions button:active { transform: scale(0.96); }
.home-stay { border: 3px solid #00c6e8; background: #fff; color: #0090ad; }
.home-leave {
  border: 3px solid #ff2d86; background: #ff2d86; color: #fff;
  box-shadow: 0 4px 14px rgba(255, 45, 134, 0.35);
}
`;

/**
 * Top-left "Main Menu" button, shown during the game (a twin of the Settings button on the right).
 *
 * Going back reloads the page rather than tearing the game down in place: bootGame() builds
 * the renderer, physics world, pointer listeners and HUD buttons once, with no teardown, and a
 * reload is the one way back that is guaranteed to leave nothing behind. Achievements and
 * settings live in localStorage, so they survive it; the packed bags don't, hence the confirm --
 * an in-game card in the Settings panel's style rather than the browser's own dialog.
 */
export function createHomeButton() {
  loadBlueberryFont();

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.className = 'home-btn';
  button.type = 'button';
  button.textContent = 'Main Menu';
  document.body.appendChild(button);

  const backdrop = document.createElement('div');
  backdrop.className = 'home-backdrop';
  backdrop.innerHTML = `
    <div class="home-card" role="alertdialog" aria-modal="true" aria-labelledby="home-title" aria-describedby="home-text">
      <h2 id="home-title">Main Menu?</h2>
      <p id="home-text">Your bags will be cleared.</p>
      <div class="home-actions">
        <button type="button" class="home-stay">Keep Playing</button>
        <button type="button" class="home-leave">Main Menu</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const stay = backdrop.querySelector('.home-stay');
  const leave = backdrop.querySelector('.home-leave');

  function open() {
    backdrop.classList.add('open');
    stay.focus(); // the safe choice is the one Enter picks
  }
  function close() {
    backdrop.classList.remove('open');
  }

  button.addEventListener('click', open);
  stay.addEventListener('click', close);
  leave.addEventListener('click', () => window.location.reload());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return { element: button };
}
