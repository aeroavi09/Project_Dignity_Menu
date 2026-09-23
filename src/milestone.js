import { loadBlueberryFont } from './fonts.js';

// PLACEHOLDERS -- swap for the real ones. The QR is drawn to look like a QR code but encodes
// nothing; example.org is reserved for examples, so the link cannot land anywhere real.
const DONATE_QR_SEED = 5;
const VOLUNTEER_URL = 'https://example.org/volunteer';

// The cards come up every time the finished-bag count reaches a multiple of this.
export const MILESTONE_BAGS = 5;
// At this count the badge card comes up instead: a free badge, claimed in person.
export const BADGE_BAGS = 15;

const STYLE = `
.ms-backdrop {
  position: fixed; inset: 0; z-index: 20000;
  background: rgba(20, 8, 30, 0.6);
  display: none; justify-content: center;
  flex-wrap: wrap; align-content: center; align-items: stretch; /* equal heights side by side */
  gap: 24px; padding: 20px; box-sizing: border-box;
  overflow-y: auto;
}
.ms-backdrop.open { display: flex; }
.ms-card {
  position: relative;
  background: linear-gradient(160deg, #fff4fb, #eaf7ff);
  border: 4px solid #ff2d86;
  border-radius: 24px;
  padding: 20px 26px 24px;
  width: min(300px, calc(100vw - 40px));
  box-sizing: border-box;
  box-shadow: 0 20px 60px rgba(40, 10, 30, 0.4);
  text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  animation: ms-pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}
.ms-card + .ms-card { animation-delay: 0.08s; }
.ms-congrats {
  flex-basis: 100%;
  margin: 0; text-align: center;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-size: clamp(30px, 6vw, 52px); font-weight: normal; line-height: 1.1;
  color: #00e3ff;
  -webkit-text-stroke: 6px #af1ef9;
  paint-order: stroke fill;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
  animation: ms-pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}
.ms-card.closed { display: none; }
.ms-card h2 { align-self: stretch; }
@keyframes ms-pop { from { transform: scale(0.7) translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ms-card, .ms-congrats { animation: none; } }
.ms-card h2 {
  margin: 4px 0 14px;
  font-size: 34px; font-weight: normal;
  color: #00e3ff;
  -webkit-text-stroke: 4px #af1ef9;
  paint-order: stroke fill;
}
.ms-card p { margin: 12px 0 0; font-size: 18px; color: #2a1020; }
.ms-qr {
  display: block; margin: 0 auto;
  width: 180px; height: 180px;
  border: 3px solid #000; border-radius: 12px;
  background: #fff; image-rendering: pixelated;
}
.ms-link {
  display: inline-block; margin-top: 6px;
  padding: 12px 24px;
  border: 3px solid #ff2d86; border-radius: 999px;
  background: #ff2d86; color: #fff; text-decoration: none;
  font-size: 22px;
  box-shadow: 0 4px 14px rgba(255, 45, 134, 0.35);
  transition: transform 0.12s ease;
}
.ms-link:hover { transform: translateY(-2px); }
.ms-url { font-family: system-ui, -apple-system, sans-serif; font-size: 12px; color: #6a5a66; word-break: break-all; }
.ms-close {
  position: absolute; top: 10px; right: 10px;
  border: 2px solid #00c6e8; background: #fff; color: #0090ad; cursor: pointer;
  width: 30px; height: 30px; border-radius: 50%;
  font-family: system-ui, -apple-system, sans-serif; font-size: 14px; font-weight: 700;
}
.ms-close:hover { background: #e6fbff; }

.ms-badge-card { width: min(400px, calc(100vw - 40px)); }
.ms-badge-card h2 { font-size: 32px; line-height: 1.1; padding: 0 28px; } /* clear of the ✕ */
.ms-badge { width: 150px; height: 170px; margin: 0 auto 6px; display: block; }
.ms-badge-card p { font-size: 20px; line-height: 1.35; }
.ms-badge-card strong { color: #ff2d86; font-weight: normal; }

/* Once earned, the badge stays on screen under the heart counter (bagCounter.js: top 74px,
   76px tall) as a button that reopens the badge card. */
.ms-badge-btn {
  position: fixed; left: 30px; top: 158px; z-index: 15000;
  width: 64px; height: 73px; padding: 0;
  border: none; background: none; cursor: pointer;
  display: none;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.25));
  transition: transform 0.12s ease;
}
.ms-badge-btn.earned { display: block; animation: ms-pop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
.ms-badge-btn:hover { transform: scale(1.08); }
.ms-badge-btn:focus-visible { outline: 3px solid #00c6e8; outline-offset: 4px; border-radius: 12px; }
.ms-badge-btn .ms-badge { width: 100%; height: 100%; margin: 0; }
@media (prefers-reduced-motion: reduce) { .ms-badge-btn.earned { animation: none; } }
`;

// A heart rosette with ribbon tails, inked in the room's black line.
const BADGE_SVG = (n) => `
  <svg class="ms-badge" viewBox="0 0 150 170" role="img" aria-label="Badge: ${n} bags filled">
    <path d="M52 112 L34 166 L54 154 L66 170 L78 118 Z" fill="#00c6e8" stroke="#000" stroke-width="5" stroke-linejoin="round"/>
    <path d="M98 112 L116 166 L96 154 L84 170 L72 118 Z" fill="#af1ef9" stroke="#000" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="75" cy="68" r="62" fill="#ffd76e" stroke="#000" stroke-width="5"/>
    <circle cx="75" cy="68" r="48" fill="#fff4fb" stroke="#000" stroke-width="4"/>
    <path d="M75 100 C52 84 42 72 42 60 C42 50 50 44 58 44 C65 44 71 48 75 55 C79 48 85 44 92 44 C100 44 108 50 108 60 C108 72 98 84 75 100 Z"
      fill="#ff2d86" stroke="#000" stroke-width="4" stroke-linejoin="round"/>
    <text x="75" y="76" text-anchor="middle" font-family="Blueberry, 'Comic Sans MS', cursive" font-size="26"
      fill="#fff" stroke="#000" stroke-width="4" paint-order="stroke">${n}</text>
  </svg>`;

/** A QR-looking grid: the three finder squares, timing rows and seeded noise. Encodes nothing. */
function drawPlaceholderQR(canvas, seed) {
  const N = 25;
  const g = canvas.getContext('2d');
  canvas.width = canvas.height = N + 4; // a two-module quiet zone all round
  g.fillStyle = '#fff';
  g.fillRect(0, 0, N + 4, N + 4);
  g.fillStyle = '#000';
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inFinder = (x, y) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (inFinder(x, y)) continue;
      const timing = (x === 6 || y === 6) && (x + y) % 2 === 0;
      if (timing || rand() < 0.5) g.fillRect(x + 2, y + 2, 1, 1);
    }
  }
  for (const [fx, fy] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
    g.fillRect(fx + 2, fy + 2, 7, 7);
    g.fillStyle = '#fff';
    g.fillRect(fx + 3, fy + 3, 5, 5);
    g.fillStyle = '#000';
    g.fillRect(fx + 4, fy + 4, 3, 3);
  }
}

/**
 * The milestone cards: every MILESTONE_BAGS finished bags (5, 10, 15...), a congratulations line
 * and two cards pop up side by side -- a donation QR code on the left, a volunteer link on the
 * right. Each card closes on its own; clicking outside or Esc closes the lot. `open()` brings
 * the same cards up on demand (the title sign), without the congratulations line.
 *
 * At BADGE_BAGS the badge card comes up instead -- a different pop-up, telling the player to show
 * the screen to Fill a Heart 4 Kids for a free badge -- and the badge appears under the heart
 * counter as a button that brings that card back.
 */
export function createMilestonePopups() {
  loadBlueberryFont();
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'ms-backdrop';
  backdrop.innerHTML = `
    <h1 class="ms-congrats" role="status"></h1>
    <div class="ms-card" role="dialog" aria-labelledby="ms-donate">
      <button type="button" class="ms-close" aria-label="Close">✕</button>
      <h2 id="ms-donate">Donate Here</h2>
      <canvas class="ms-qr" role="img" aria-label="QR code to donate"></canvas>
      <p>Scan to donate</p>
    </div>
    <div class="ms-card" role="dialog" aria-labelledby="ms-volunteer">
      <button type="button" class="ms-close" aria-label="Close">✕</button>
      <h2 id="ms-volunteer">Volunteer Here</h2>
      <a class="ms-link" href="${VOLUNTEER_URL}" target="_blank" rel="noopener noreferrer">Sign up</a>
      <p class="ms-url">${VOLUNTEER_URL}</p>
    </div>`;
  document.body.appendChild(backdrop);

  const badgeBackdrop = document.createElement('div');
  badgeBackdrop.className = 'ms-backdrop';
  badgeBackdrop.innerHTML = `
    <div class="ms-card ms-badge-card" role="dialog" aria-modal="true" aria-labelledby="ms-badge-title">
      <button type="button" class="ms-close" aria-label="Close">✕</button>
      <h2 id="ms-badge-title">Congrats! You earned a badge!</h2>
      ${BADGE_SVG(BADGE_BAGS)}
      <p>You filled <strong>${BADGE_BAGS} bags</strong>! Show this screen to our friends at
        <strong>Fill a Heart 4 Kids (FAH4K)</strong> to claim your free badge.</p>
    </div>`;
  document.body.appendChild(badgeBackdrop);
  const badgeCard = badgeBackdrop.querySelector('.ms-card');
  const closeBadge = () => badgeBackdrop.classList.remove('open');
  function openBadge() {
    badgeCard.style.animation = 'none';
    void badgeCard.offsetWidth; // replay the pop-in
    badgeCard.style.animation = '';
    badgeBackdrop.classList.add('open');
  }

  const badgeButton = document.createElement('button');
  badgeButton.type = 'button';
  badgeButton.className = 'ms-badge-btn';
  badgeButton.setAttribute('aria-label', 'Your badge: show it to claim');
  badgeButton.innerHTML = BADGE_SVG(BADGE_BAGS);
  badgeButton.addEventListener('click', openBadge);
  document.body.appendChild(badgeButton);
  badgeBackdrop.querySelector('.ms-close').addEventListener('click', closeBadge);
  badgeBackdrop.addEventListener('click', (e) => {
    if (e.target === badgeBackdrop) closeBadge();
  });

  drawPlaceholderQR(backdrop.querySelector('.ms-qr'), DONATE_QR_SEED);

  const cards = [...backdrop.querySelectorAll('.ms-card')];
  const congrats = backdrop.querySelector('.ms-congrats');

  function close() {
    backdrop.classList.remove('open');
  }
  function closeCard(card) {
    card.classList.add('closed');
    if (cards.every((c) => c.classList.contains('closed'))) close();
  }
  cards.forEach((card) => card.querySelector('.ms-close').addEventListener('click', () => closeCard(card)));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      closeBadge();
    }
  });

  /** Show the cards, with a congratulations line above them when `message` is given. */
  function show(message) {
    congrats.textContent = message ?? '';
    congrats.hidden = !message;
    for (const el of [congrats, ...cards]) {
      el.classList.remove('closed');
      // Replay the pop-in, which only runs when the element first appears.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
    backdrop.classList.add('open');
  }

  /** Call with the finished-bag count after each bag; opens the cards on every multiple of the milestone. */
  function check(count) {
    if (count === BADGE_BAGS) {
      badgeButton.classList.add('earned'); // stays on screen from here on
      openBadge();
      return;
    }
    if (count <= 0 || count % MILESTONE_BAGS !== 0) return;
    show(`Congrats! You filled ${count} bags!`);
  }

  return { check, open: () => show() };
}
