import { loadBlueberryFont } from './fonts.js';

const STORAGE_KEY = 'toiletry-shelf:settings';
const MUSIC_SRC = `${import.meta.env.BASE_URL}audio/backgroundmusic.mp3`;

const DEFAULTS = { music: true, sfx: true, subtitles: false, reduceMotion: false };

function load() {
  // Private browsing and blocked site data both make this throw, not just return null.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are a nicety -- a browser that refuses storage still plays fine.
  }
}

const settings = load();
const listeners = new Set();

/** Live settings object. Other modules (menu.js's parallax, bubbles.js's transition) read
 * this directly each frame rather than caching a copy, since it can change at any time. */
export function getSettings() {
  return settings;
}

export function onSettingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setSetting(key, value) {
  settings[key] = value;
  save();
  for (const cb of listeners) cb(settings);
}

// --- background music ---------------------------------------------------
const music = new Audio(MUSIC_SRC);
music.loop = true;
music.volume = 0.45;

function tryPlayMusic() {
  if (!settings.music) return;
  music.play().catch(() => {
    // Autoplay blocked until a user gesture -- unlockOnce below retries on the first one.
  });
}
tryPlayMusic();

// Browsers refuse to play audio with sound until the page has seen some user gesture --
// no autoplay-on-load is possible, from any site, full stop. This catches the very first
// gesture of *any* kind (click, tap, key press) anywhere on the page, not just on the
// settings button, so music starts the instant the player touches the page at all.
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
function unlockOnce() {
  tryPlayMusic();
  if (!music.paused) {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlockOnce, true);
  }
}
for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlockOnce, true);

onSettingsChange((s) => {
  if (s.music) tryPlayMusic();
  else music.pause();
});

const TOGGLES = [
  { section: 'Audio', key: 'music', label: 'Background Music' },
  { section: 'Audio', key: 'sfx', label: 'Sound Effects' },
  { section: 'Accessibility', key: 'subtitles', label: 'Subtitles', badge: 'Coming soon' },
  { section: 'Accessibility', key: 'reduceMotion', label: 'Reduce Motion' },
];

const STYLE = `
.set-btn {
  position: fixed; right: 20px; top: 20px; z-index: 15000;
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
.set-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(0, 150, 190, 0.4); }
.set-btn:active { transform: scale(0.96); }

.set-backdrop {
  position: fixed; inset: 0; z-index: 20000;
  background: rgba(20, 8, 30, 0.6);
  display: none; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
}
.set-backdrop.open { display: flex; }
.set-panel {
  background: linear-gradient(160deg, #fff4fb, #eaf7ff);
  border: 4px solid #ff2d86;
  border-radius: 24px;
  padding: 0 22px 22px;
  width: min(420px, calc(100vw - 40px));
  max-height: min(600px, calc(100vh - 60px));
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(40, 10, 30, 0.4);
}
.set-head {
  position: sticky; top: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0 6px;
  background: linear-gradient(160deg, #fff4fb, #eaf7ff);
}
.set-head h2 {
  margin: 0;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-size: 34px; font-weight: normal;
  color: #00e3ff;
  -webkit-text-stroke: 4px #af1ef9;
  paint-order: stroke fill;
}
.set-close {
  border: 2px solid #00c6e8; background: #fff; color: #0090ad; cursor: pointer;
  width: 30px; height: 30px; border-radius: 50%; font-size: 14px; font-weight: 700;
  flex: none;
  transition: background 0.15s ease;
}
.set-close:hover { background: #e6fbff; }
.set-section h3 {
  margin: 10px 0 8px;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-weight: normal;
  font-size: 19px; letter-spacing: 0.03em;
  color: #00c6e8;
}
.set-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 12px; border-radius: 14px;
  background: rgba(255, 255, 255, 0.75);
  margin-bottom: 8px;
}
.set-row-label {
  display: flex; align-items: center; gap: 9px;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-weight: normal;
  font-size: 19px; color: #2a1020;
}
.set-badge {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 10px; font-weight: 800; letter-spacing: 0.04em;
  background: #ffd76e; color: #5a4200; padding: 2px 7px; border-radius: 999px;
}
.set-toggle {
  position: relative; flex: none; width: 52px; height: 30px; border-radius: 999px;
  border: 2px solid #00c6e8; cursor: pointer; background: #fff;
  transition: background 0.18s ease;
}
.set-toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 22px; height: 22px; border-radius: 50%; background: #00c6e8;
  transition: transform 0.18s ease, background 0.18s ease;
}
.set-toggle.on { background: #00c6e8; }
.set-toggle.on::after { background: #fff; transform: translateX(22px); }
`;

/** The Settings button, its playful modal, and the shared music player it controls. */
export function createSettingsUI() {
  loadBlueberryFont();

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.className = 'set-btn';
  button.type = 'button';
  button.innerHTML = '<span>Settings</span>';
  document.body.appendChild(button);

  const backdrop = document.createElement('div');
  backdrop.className = 'set-backdrop';
  const panel = document.createElement('div');
  panel.className = 'set-panel';
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  function renderPanel() {
    const sections = [...new Set(TOGGLES.map((t) => t.section))];
    panel.innerHTML =
      `<div class="set-head"><h2>Settings</h2><button class="set-close" type="button" aria-label="Close">✕</button></div>` +
      sections
        .map(
          (section) =>
            `<div class="set-section"><h3>${section}</h3>` +
            TOGGLES.filter((t) => t.section === section)
              .map((t) => {
                const on = settings[t.key];
                return `
                  <div class="set-row">
                    <span class="set-row-label">${t.label}${t.badge ? ` <span class="set-badge">${t.badge}</span>` : ''}</span>
                    <button class="set-toggle ${on ? 'on' : ''}" type="button" data-key="${t.key}" aria-pressed="${on}"></button>
                  </div>`;
              })
              .join('') +
            `</div>`
        )
        .join('');

    panel.querySelector('.set-close').addEventListener('click', close);
    panel.querySelectorAll('.set-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const next = !settings[key];
        setSetting(key, next);
        btn.classList.toggle('on', next);
        btn.setAttribute('aria-pressed', String(next));
      });
    });
  }

  function open() {
    renderPanel();
    backdrop.classList.add('open');
  }
  function close() {
    backdrop.classList.remove('open');
  }

  button.addEventListener('click', open);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return { open, close };
}
