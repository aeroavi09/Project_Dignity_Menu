const STORAGE_KEY = 'toiletry-shelf:achievements';
const TOAST_MS = 4500;

/** Add an entry here and it shows up on the page automatically, locked until unlocked. */
export const ACHIEVEMENTS = [
  {
    id: 'bottle-flip',
    icon: '🍾',
    title: 'Bottle Flip',
    description: 'Threw a bottle, spun it a full turn, and stuck the landing.',
    hint: 'Some bottles were meant to fly.',
  },
  {
    id: 'nothing-but-net',
    icon: '🏀',
    title: 'Nothing but Net',
    description: 'Threw an item clean into a bag without it touching a thing on the way in.',
    hint: 'Why walk it over when you could throw it?',
  },
];

const STYLE = `
.ach-btn {
  position: fixed; left: 20px; bottom: 72px; z-index: 15000;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 16px 9px 13px;
  border: none; border-radius: 999px;
  background: #4a3b6b; color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px; font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  transition: transform 0.12s ease, background 0.12s ease;
}
.ach-btn:hover { background: #5b4a80; }
.ach-btn:active { transform: scale(0.96); }
.ach-btn-count {
  background: rgba(255, 255, 255, 0.22); border-radius: 999px;
  padding: 1px 7px; font-size: 12px; font-variant-numeric: tabular-nums;
}

.ach-backdrop {
  position: fixed; inset: 0; z-index: 20000;
  background: rgba(0, 0, 0, 0.55);
  display: none; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
}
.ach-backdrop.open { display: flex; }
.ach-panel {
  background: #fffaf0; border-radius: 16px; padding: 20px 22px;
  width: min(440px, calc(100vw - 40px));
  max-height: min(560px, calc(100vh - 80px)); overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.ach-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 14px; }
.ach-head h2 { font-size: 18px; color: #5a4632; margin: 0; flex: 1; }
.ach-progress { font-size: 13px; color: #8a7a63; font-variant-numeric: tabular-nums; }
.ach-close {
  border: none; background: #e7ddc9; color: #5a4632; cursor: pointer;
  width: 28px; height: 28px; border-radius: 50%; font-size: 15px; font-weight: 700;
}
.ach-close:hover { background: #d8cbb2; }
.ach-row {
  display: flex; gap: 13px; align-items: flex-start;
  padding: 12px; border-radius: 11px; background: #f3ead8; margin-bottom: 9px;
}
.ach-row.locked { opacity: 0.62; }
.ach-icon {
  width: 42px; height: 42px; flex: none; border-radius: 11px;
  display: flex; align-items: center; justify-content: center; font-size: 22px;
  background: #fff;
}
.ach-row.locked .ach-icon { filter: grayscale(1); color: #a89878; }
.ach-text h3 { margin: 0 0 3px; font-size: 14.5px; color: #4a3b2a; }
.ach-text p { margin: 0; font-size: 13px; line-height: 1.4; color: #7a6a52; }

.ach-toast {
  position: fixed; right: 20px; bottom: 20px; z-index: 25000;
  display: flex; align-items: center; gap: 12px;
  padding: 13px 20px 13px 14px; border-radius: 13px;
  background: #2c2340; color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
  transform: translateY(140%); opacity: 0;
  transition: transform 0.42s cubic-bezier(0.2, 1.3, 0.4, 1), opacity 0.3s ease;
}
.ach-toast.show { transform: translateY(0); opacity: 1; }
.ach-toast-icon { font-size: 26px; line-height: 1; }
.ach-toast-kicker {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em;
  text-transform: uppercase; color: #ffd76e;
}
.ach-toast-title { font-size: 15.5px; font-weight: 700; margin-top: 1px; }

@media (prefers-reduced-motion: reduce) {
  .ach-toast { transition: opacity 0.3s ease; transform: none; }
}
`;

function loadUnlocked() {
  // Private browsing and blocked site data both make this throw, not just return null.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveUnlocked(unlocked) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...unlocked]));
  } catch {
    // Progress is a nicety — a browser that refuses storage still plays fine.
  }
}

/** Achievement store, the unlock toast, and the achievements page behind the 🏆 button. */
export function createAchievements() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const unlocked = loadUnlocked();

  const button = document.createElement('button');
  button.className = 'ach-btn';
  button.type = 'button';
  document.body.appendChild(button);

  const backdrop = document.createElement('div');
  backdrop.className = 'ach-backdrop';
  const panel = document.createElement('div');
  panel.className = 'ach-panel';
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  function refreshButton() {
    button.innerHTML =
      `<span>🏆 Achievements</span>` +
      `<span class="ach-btn-count">${unlocked.size}/${ACHIEVEMENTS.length}</span>`;
  }

  function renderPanel() {
    const rows = ACHIEVEMENTS.map((a) => {
      const got = unlocked.has(a.id);
      return `
        <div class="ach-row ${got ? '' : 'locked'}">
          <div class="ach-icon">${got ? a.icon : '🔒'}</div>
          <div class="ach-text">
            <h3>${a.title}</h3>
            <p>${got ? a.description : a.hint}</p>
          </div>
        </div>`;
    }).join('');
    panel.innerHTML = `
      <div class="ach-head">
        <h2>Achievements</h2>
        <span class="ach-progress">${unlocked.size} of ${ACHIEVEMENTS.length}</span>
        <button class="ach-close" type="button" aria-label="Close">✕</button>
      </div>${rows}`;
    panel.querySelector('.ach-close').addEventListener('click', close);
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

  function showToast(a) {
    const toast = document.createElement('div');
    toast.className = 'ach-toast';
    toast.innerHTML = `
      <div class="ach-toast-icon">${a.icon}</div>
      <div>
        <div class="ach-toast-kicker">Achievement Unlocked</div>
        <div class="ach-toast-title">${a.title}</div>
      </div>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 500);
    }, TOAST_MS);
  }

  /** Returns true only the first time an id is unlocked. */
  function unlock(id) {
    if (unlocked.has(id)) return false;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return false;
    unlocked.add(id);
    saveUnlocked(unlocked);
    refreshButton();
    if (backdrop.classList.contains('open')) renderPanel();
    showToast(a);
    return true;
  }

  refreshButton();

  return {
    unlock,
    open,
    close,
    isUnlocked: (id) => unlocked.has(id),
  };
}
