import * as THREE from 'three';
import { loadBlueberryFont } from './fonts.js';

// First-visit tutorial: Mia walks the player through the kit in a click-through speech
// bubble, spotlighting each object in the room with an arrow from the bubble. Same pattern as
// the other overlays (achievements, settings): an injected stylesheet, fixed DOM, and world
// positions projected onto the canvas each frame (see createWorldLabel in hoverLabel.js).

const STORAGE_KEY = 'toiletry-shelf:tutorial-seen';

// `target` names an entry in the `targets` map runTutorial() is given; steps without one
// dim the room with no spotlight.
const STEPS = [
  { text: 'Click on each picture to fill a Project Dignity WeCare Kit.' },
  // The room has no washer, dryer or bath towel to point at, so this one is text only.
  { text: "Kids who are homeless don't have washers, dryers or bath towels" },
  { text: "We can't forget the soap! Eddie needs soap to wash his clothes.", target: 'soap' },
  { text: 'Guess what eddie uses this wash cloth for? To dry himself off after he showers.', target: 'washcloth' },
  // The wash cloth is what the kit packs in place of a towel, so it's what this points at.
  {
    text: 'Wet bath towels are too big to put in a backpack and they can get school supplies wet and moldy',
    target: 'washcloth',
  },
  { text: "Write on the card, 'Have a sweet day, from First name', and add some drawings", target: 'card' },
];

export function hasSeenTutorial() {
  // Private browsing and blocked site data both make this throw, not just return null.
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Can't remember it -- the tutorial just plays again next visit.
  }
}

const STYLE = `
.tut-root {
  position: fixed; inset: 0; z-index: 21000;
  cursor: pointer;
  font-family: system-ui, -apple-system, sans-serif;
}
.tut-root.dim { background: rgba(20, 8, 30, 0.55); }
.tut-spot {
  position: fixed; border-radius: 50%;
  border: 4px solid #00e3ff;
  box-shadow: 0 0 0 200vmax rgba(20, 8, 30, 0.55), 0 0 18px 6px rgba(0, 227, 255, 0.85),
    inset 0 0 14px rgba(0, 227, 255, 0.6);
  pointer-events: none;
  display: none;
}
.tut-arrow { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.tut-panel {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; align-items: flex-end; gap: 14px;
  width: min(640px, calc(100vw - 32px));
}
.tut-face {
  flex: none; width: 96px; height: 96px; border-radius: 50%;
  border: 4px solid #ff2d86; outline: 3px solid #000;
  background: #fff4fb center / cover no-repeat;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Blueberry', 'Comic Sans MS', cursive; font-size: 26px; color: #ff2d86;
  box-shadow: 0 8px 22px rgba(40, 10, 30, 0.35);
}
.tut-bubble {
  position: relative; flex: 1;
  background: #fff; border: 3px solid #000; border-radius: 22px;
  padding: 14px 18px 10px;
  box-shadow: 0 10px 30px rgba(40, 10, 30, 0.35);
}
.tut-bubble::before {
  content: ''; position: absolute; left: -15px; bottom: 26px;
  border: 13px solid transparent; border-right-color: #000; border-left: 0;
}
.tut-bubble::after {
  content: ''; position: absolute; left: -10px; bottom: 28px;
  border: 11px solid transparent; border-right-color: #fff; border-left: 0;
}
.tut-name {
  font-family: 'Blueberry', 'Comic Sans MS', cursive; font-size: 18px;
  color: #00e3ff; -webkit-text-stroke: 3px #af1ef9; paint-order: stroke fill;
}
.tut-text {
  margin: 4px 0 8px;
  font-family: 'Blueberry', 'Comic Sans MS', cursive; font-size: 22px; line-height: 1.25;
  color: #2a1020;
}
.tut-hint { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #0090ad; }
.tut-skip {
  position: fixed; left: 50%; top: 20px; transform: translateX(-50%); z-index: 21001;
  padding: 9px 18px;
  border: 3px solid #00c6e8; border-radius: 999px;
  background: #fff; color: #0090ad;
  font-family: system-ui, -apple-system, sans-serif; font-size: 14px; font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 150, 190, 0.3);
}
.tut-skip:hover { box-shadow: 0 8px 22px rgba(0, 150, 190, 0.4); }
`;

const SVG = 'http://www.w3.org/2000/svg';
const SPOT_PAD = 16; // px of breathing room around the object
const MIN_SPOT = 44; // px, so a lip balm still gets a ring you can see

/**
 * Play the tutorial and resolve once it has been finished or skipped (and marked as seen).
 * `targets` maps a step's target name to a function returning the objects to spotlight now --
 * looked up each frame, so it follows items as they are moved, restocked or bagged.
 * `portrait` is a promise of Mia's picture; a placeholder shows until it arrives.
 */
export function runTutorial({ camera, domElement, portrait, targets }) {
  return new Promise((resolve) => {
    loadBlueberryFont();
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'tut-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Tutorial');
    const spot = document.createElement('div');
    spot.className = 'tut-spot';
    const arrow = document.createElementNS(SVG, 'svg');
    arrow.setAttribute('class', 'tut-arrow');
    arrow.innerHTML = `
      <path class="ink" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round"/>
      <path class="line" fill="none" stroke="#00e3ff" stroke-width="5" stroke-linecap="round"/>
      <polygon class="head" fill="#00e3ff" stroke="#000" stroke-width="3" stroke-linejoin="round"/>`;
    const panel = document.createElement('div');
    panel.className = 'tut-panel';
    panel.innerHTML = `
      <div class="tut-face" aria-hidden="true">Mia</div>
      <div class="tut-bubble" aria-live="polite">
        <div class="tut-name">Mia</div>
        <p class="tut-text"></p>
        <div class="tut-hint"><span class="tut-count"></span><span>Click to continue &#9656;</span></div>
      </div>`;
    root.append(spot, arrow, panel);

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tut-skip';
    skip.textContent = 'Skip Tutorial';
    document.body.append(root, skip);

    const face = panel.querySelector('.tut-face');
    const bubble = panel.querySelector('.tut-bubble');
    const text = panel.querySelector('.tut-text');
    const count = panel.querySelector('.tut-count');
    const [inkPath, linePath, head] = arrow.children;
    portrait?.then((url) => {
      face.textContent = '';
      face.style.backgroundImage = `url(${url})`;
    });

    let step = 0;
    let raf = 0;
    let done = false;

    function show() {
      text.textContent = STEPS[step].text;
      count.textContent = `${step + 1} / ${STEPS.length}`;
    }

    function next() {
      if (step < STEPS.length - 1) {
        step++;
        show();
      } else {
        finish();
      }
    }

    function finish() {
      if (done) return;
      done = true;
      markSeen();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      root.remove();
      skip.remove();
      style.remove();
      resolve();
    }

    function onKey(e) {
      if (e.key === 'Escape') finish();
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    }

    root.addEventListener('click', next);
    skip.addEventListener('click', finish);
    window.addEventListener('keydown', onKey);

    const box = new THREE.Box3();
    const part = new THREE.Box3();
    const corner = new THREE.Vector3();

    /** Screen-space bounds of some world objects, or null if none are in front of the camera. */
    function screenBounds(objects) {
      box.makeEmpty();
      for (const o of objects) box.union(part.setFromObject(o));
      if (box.isEmpty()) return null;
      const rect = domElement.getBoundingClientRect();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        corner.project(camera);
        if (corner.z > 1) return null;
        const x = ((corner.x + 1) / 2) * rect.width + rect.left;
        const y = ((1 - corner.y) / 2) * rect.height + rect.top;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return { minX, minY, maxX, maxY };
    }

    function place() {
      const key = STEPS[step].target;
      const objects = key ? targets[key]?.() ?? [] : [];
      const b = objects.length ? screenBounds(objects) : null;
      root.classList.toggle('dim', !b);
      spot.style.display = b ? 'block' : 'none';
      arrow.style.display = b ? 'block' : 'none';
      if (b) {
        // An ellipse through the corners of the object's box, so the whole thing sits inside.
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const rx = Math.max(MIN_SPOT / 2, ((b.maxX - b.minX) / 2) * Math.SQRT2 + SPOT_PAD);
        const ry = Math.max(MIN_SPOT / 2, ((b.maxY - b.minY) / 2) * Math.SQRT2 + SPOT_PAD);
        Object.assign(spot.style, {
          left: `${cx - rx}px`,
          top: `${cy - ry}px`,
          width: `${2 * rx}px`,
          height: `${2 * ry}px`,
        });
        drawArrow(cx, cy, rx, ry);
      }
      raf = requestAnimationFrame(place);
    }

    function drawArrow(cx, cy, rx, ry) {
      const r = bubble.getBoundingClientRect();
      const sx = Math.min(Math.max(cx, r.left + 40), r.right - 40);
      const sy = r.top - 8;
      // Stop just outside the spotlight ring, on the side facing the bubble.
      const dx = sx - cx;
      const dy = sy - cy;
      const onRing = 1 / Math.hypot(dx / rx, dy / ry);
      const len = Math.hypot(dx, dy);
      const ex = cx + dx * onRing + (dx / len) * 10;
      const ey = cy + dy * onRing + (dy / len) * 10;
      // Bow the line a little so it reads as a hand-drawn arrow rather than a ruler.
      const mx = (sx + ex) / 2 - (ey - sy) * 0.18;
      const my = (sy + ey) / 2 + (ex - sx) * 0.18;
      const d = `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
      inkPath.setAttribute('d', d);
      linePath.setAttribute('d', d);
      const tx = ex - mx;
      const ty = ey - my;
      const tl = Math.hypot(tx, ty) || 1;
      const ux = tx / tl;
      const uy = ty / tl;
      const size = 18;
      head.setAttribute(
        'points',
        [
          [ex + ux * 6, ey + uy * 6],
          [ex - ux * size - uy * size * 0.6, ey - uy * size + ux * size * 0.6],
          [ex - ux * size + uy * size * 0.6, ey - uy * size - ux * size * 0.6],
        ]
          .map((p) => p.join(','))
          .join(' ')
      );
    }

    show();
    place();
  });
}
