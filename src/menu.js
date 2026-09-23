import * as THREE from 'three';
import { loadBlueberryFont } from './fonts.js';
import { getSettings } from './settings.js';
import { createInkRenderer } from './inkPass.js';

// ===== 3D MENU =====
// A self-contained 3D recreation of the "Fill a ♥ 4 kids" donation wall, shown before the
// game boots. startMenu() builds its own renderer, scene and HTML overlay, and resolves once
// Play has been pressed and every GPU resource it made has been released. Nothing in here
// touches the game: delete this file and the two lines that use it in main.js to remove it.

const COL = {
  wall: 0xf4efe9,
  ceiling: 0xfffdfa,
  floor: 0xdcd8d2,
  pink: 0xf07c8f,
  lavender: 0x8f86b8,
  indigo: 0x4b2fbf,
  yellow: 0xf2c43a,
  orange: 0xf08a2c,
  magenta: 0xd6337a,
  hotPink: 0xff2d86,
  lens: 0xfff3d6,
  led: 0x9b3cff,
  teal: 0x2fd4a0,
  brick: 0x8a4b38,
  frame: 0x35353a,
  metal: 0xc9ccd1,
  dark: 0x1b1b1e,
  tableTop: 0xf3f2ef,
  note: 0xf6e37a,
};

// Wall occupies x -4.5..4.5, y 0..3.6, at z = 0. Everything else is placed in front of it.
const WALL_W = 9;
const WALL_H = 3.6;
const TABLE_Y = 0.75;
const TABLE_D = 0.6;
const RAIL_Y = 3.18;
const RAIL_Z = 0.5;
// Track-light heads along the rail. Shared with the balloons, which keep clear of them.
const SPOT_XS = [-3.3, -2.2, -1.1, 0, 1.1, 2.2, 3.3];

const FONT_STACK = '"Patrick Hand", "Short Stack", "Comic Sans MS", "Segoe Print", cursive';
const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap';

// The wall paint uses the project's own face. The filename has a space in it, and the site is
// served from a subpath on Pages, so both encoding and BASE_URL matter here.
const WALL_FONT = '"Cinnamon Cake", "Patrick Hand", "Comic Sans MS", cursive';
const WALL_FONT_URL = `${import.meta.env.BASE_URL}fonts/${encodeURIComponent('cinnamon cake.ttf')}`;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const WALL_PX_PER_M = 341;

/**
 * The wall and its paint in a single texture. Earlier this was three transparent planes
 * floating in front of the wall, but the wall receives the balloons' shadows and the planes
 * did not, so every shadow edge that crossed one showed its rectangle as a hard seam. Baking
 * the lettering into the wall map removes the extra geometry, the seam and the depth conflict
 * in one go -- the text is now literally the same surface as the wall.
 */
function wallTexture() {
  const S = WALL_PX_PER_M;
  const w = Math.round(WALL_W * S);
  const h = Math.round(WALL_H * S);
  const canvas = makeCanvas(w, h);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fbf7f2';
  g.fillRect(0, 0, w, h);

  const px = (x) => (x + WALL_W / 2) * S;
  const py = (y) => (WALL_H - y) * S;
  g.fillStyle = '#141414';
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  g.font = `${0.34 * S}px ${WALL_FONT}`;
  g.fillText('Fill a', px(-0.62), py(2.26));
  g.fillText('4 kids™', px(0.9), py(2.26));

  g.font = `${0.17 * S}px ${WALL_FONT}`;
  g.fillText('provides homeless, at-risk, and foster children food, critical necessities,', px(0.08), py(1.9));
  g.fillText('life skills & educational support to empower & Build Brighter Futures 4 Kids™!', px(0.08), py(1.72));

  const tex = canvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

function speckleTexture() {
  const canvas = makeCanvas(256, 256);
  const g = canvas.getContext('2d');
  const rand = mulberry(7);
  g.fillStyle = '#1d0a15';
  g.fillRect(0, 0, 256, 256);
  const dots = ['#d6337a', '#ff2d86', '#f07c8f', '#8d1347', '#3a0f24', '#ffffff'];
  for (let i = 0; i < 1100; i++) {
    g.fillStyle = dots[Math.floor(rand() * dots.length)];
    g.globalAlpha = 0.55 + rand() * 0.45;
    g.beginPath();
    g.arc(rand() * 256, rand() * 256, 1 + rand() * 4.5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = canvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function noteTexture(label) {
  const canvas = makeCanvas(128, 128);
  const g = canvas.getContext('2d');
  g.fillStyle = '#f6e37a';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 3;
  g.strokeRect(2, 2, 124, 124);
  g.fillStyle = '#1b1b1b';
  g.font = `72px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 64, 70);
  return canvasTexture(canvas);
}

/** The small white "weekly urgent needs" card, drawn rather than modelled. */
function signTexture() {
  const canvas = makeCanvas(320, 240);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 320, 240);
  g.strokeStyle = '#d9d9d9';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 317, 237);
  g.fillStyle = '#ff2d86';
  g.fillRect(8, 40, 304, 34);
  g.fillStyle = '#ffffff';
  g.font = `bold 22px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('WEEKLY URGENT NEEDS', 160, 58);
  // Tiny generic cartoon kids: head + body, no likeness to anything in particular.
  const kids = [
    { x: 40, skin: '#e8b48a', shirt: '#4bb3e0' },
    { x: 280, skin: '#c98652', shirt: '#f2c43a' },
  ];
  for (const kid of kids) {
    g.fillStyle = kid.skin;
    g.beginPath();
    g.arc(kid.x, 24, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = kid.shirt;
    g.beginPath();
    g.moveTo(kid.x - 15, 60);
    g.quadraticCurveTo(kid.x, 32, kid.x + 15, 60);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#7a7a7a';
  g.font = `16px ${FONT_STACK}`;
  g.textAlign = 'left';
  for (let i = 0; i < 6; i++) {
    g.fillRect(24, 96 + i * 22, 180 + ((i * 37) % 80), 6);
  }
  return canvasTexture(canvas);
}

/** Original heart: two bezier lobes into a point, extruded and bevelled. */
function heartGeometry(height) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.52);
  s.bezierCurveTo(0.44, -0.16, 0.64, 0.24, 0.45, 0.49);
  s.bezierCurveTo(0.34, 0.65, 0.12, 0.63, 0, 0.41);
  s.bezierCurveTo(-0.12, 0.63, -0.34, 0.65, -0.45, 0.49);
  s.bezierCurveTo(-0.64, 0.24, -0.44, -0.16, 0, -0.52);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 22,
  });
  geo.center();
  geo.computeBoundingBox();
  const h = geo.boundingBox.max.y - geo.boundingBox.min.y;
  geo.scale(height / h, height / h, height / h);
  return geo;
}

/**
 * Lathed profile for a flexible tub: tapered body, thick rolled rim, hollow inside.
 * Returned in unit radius so one geometry can be scaled into every tub on the table.
 */
function tubGeometry(height) {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.7, 0.0),
    new THREE.Vector2(0.74, height * 0.06),
    new THREE.Vector2(0.94, height * 0.82),
    new THREE.Vector2(1.0, height * 0.94),
    new THREE.Vector2(1.04, height),
    new THREE.Vector2(0.99, height * 1.02),
    new THREE.Vector2(0.93, height * 0.95),
    new THREE.Vector2(0.88, height * 0.8),
    new THREE.Vector2(0.66, height * 0.05),
    new THREE.Vector2(0.0, height * 0.05),
  ];
  return new THREE.LatheGeometry(pts, 44);
}

function disposeObject(root) {
  const seen = new Set();
  const geos = new Set();
  root.traverse((obj) => {
    if (obj.geometry && !geos.has(obj.geometry)) {
      geos.add(obj.geometry);
      obj.geometry.dispose();
    }
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const value of Object.values(mat)) {
        if (value && value.isTexture) value.dispose();
      }
      mat.dispose();
    }
  });
}

export function startMenu() {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'menu-root';
    document.body.appendChild(root);

    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = FONT_LINK;
    document.head.appendChild(fontLink);

    const style = document.createElement('style');
    style.textContent = MENU_CSS;
    document.head.appendChild(style);

    // Both faces have to be resident before the wall text and labels are rasterised to
    // canvas -- but never block on a network that isn't answering, since the fallback stack
    // is a rounded hand too.
    let wallFace = null;
    const pending = [loadBlueberryFont()];
    if (document.fonts) {
      wallFace = new FontFace('Cinnamon Cake', `url("${WALL_FONT_URL}")`);
      pending.push(wallFace.load().then((f) => document.fonts.add(f)).catch(() => null));
      pending.push(document.fonts.load(`80px "Patrick Hand"`).catch(() => null));
    }
    const fontReady = Promise.race([
      Promise.all(pending),
      new Promise((r) => setTimeout(r, 2000)),
    ]);

    fontReady.then(() => build(root, style, fontLink, wallFace, resolve));
  });
}

function build(root, style, fontLink, wallFace, resolve) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f1ea);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 60);
  const camBase = new THREE.Vector3(0, 1.5, 4.5);
  const camTarget = new THREE.Vector3(0, 1.85, 0);
  camBase.z = camDistance(camera.aspect);
  camera.position.copy(camBase);
  camera.lookAt(camTarget);

  const balloons = [];
  const balloonMeshes = [];
  const bins = [];
  const spots = [];
  const extras = { ledRing: null, ledLight: null };

  buildRoom(scene);
  buildLighting(scene, spots, extras);
  buildBalloons(scene, balloons, balloonMeshes, extras);
  buildWallText(scene);
  buildTables(scene);
  buildBins(scene, bins);
  buildForeground(scene);
  const confetti = createConfetti(scene);
  // Every object in the room gets a pen outline, matching the game's inked look. Confetti is
  // left out: a line round a 3cm fleck would leave nothing but the line.
  const ink = createInkRenderer(renderer, scene, camera, { exclude: [confetti.mesh] });

  // --- interaction state -------------------------------------------------
  const pointer = new THREE.Vector2(0, 0);
  const ndc = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  const touchOnly = window.matchMedia('(hover: none)').matches;
  let hovered = null;

  const hitTargets = [...balloonMeshes, ...bins.map((b) => b.hit), ...spots.map((s) => s.head)];

  function onPointerMove(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    if (closing) return;
    const found = pick();
    const next = found ? found.target : null;
    if (next === hovered) return;
    if (hovered) hovered.hoverTarget = 0;
    hovered = next;
    if (hovered) hovered.hoverTarget = 1;
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
  }

  function pick() {
    ndc.set(pointer.x, pointer.y);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const kind = hit.object.userData.kind;
    for (const hit of hits) {
      const kind = hit.object.userData.kind;
      if (kind === 'balloon') {
        const group = hit.object.userData.group;
        const b = balloons.find((b) => b.group === group && b.index === hit.instanceId);
        // A popped balloon is shrunk to nothing but can still catch a ray; look past it.
        if (b.popped) continue;
        return { kind, target: b };
      }
      if (kind === 'bin') return { kind, target: bins[hit.object.userData.index] };
      if (kind === 'spot') return { kind, target: spots[hit.object.userData.index] };
      return null;
    }
    return null;
  }

  function popBalloon(b) {
    b.popped = true;
    b.popT = 0;
    b.hoverTarget = 0;
    if (hovered === b) hovered = null;
    renderer.domElement.style.cursor = 'default';
    confetti.burst(b.worldPos, b.color);
    playPop();
  }

  function onPointerDown() {
    if (closing) return;
    const found = pick();
    if (!found) return;
    if (found.kind === 'balloon') popBalloon(found.target);
    if (found.kind === 'bin') found.target.vel += 1.35;
    if (found.kind === 'spot') toggleSpot(found.target);
  }

  function toggleSpot(spot) {
    spot.on = !spot.on;
    if (spot.light) spot.light.intensity = spot.on ? spot.baseIntensity : 0;
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camBase.z = camDistance(camera.aspect);
    camera.position.z = camBase.z;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    ink.setSize();
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);

  // --- overlay -----------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.innerHTML = `
    <div class="menu-card" role="dialog" aria-label="Main menu">
      <h1 class="menu-title">Toiletries 4 Dignity</h1>
      <p class="menu-sub">Pack a bag. Fill a heart.</p>
      <button type="button" class="menu-play">Play</button>
    </div>`;
  root.appendChild(overlay);
  const playBtn = overlay.querySelector('.menu-play');
  playBtn.addEventListener('click', onPlay);

  // --- loop --------------------------------------------------------------
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let raf = 0;
  let last = performance.now();
  let clock = 0;
  let closing = false;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;

    // Reduced motion: hold the camera still and drop the idle bob/sway/parallax, but keep
    // click feedback (hover scale, the balloon-bounce spring) since that's a direct response
    // to the player's own action rather than ambient movement.
    const reduceMotion = getSettings().reduceMotion;

    // Camera parallax: eases toward the cursor, or drifts on its own where there is none.
    const px = touchOnly ? Math.sin(clock * 0.21) : pointer.x;
    const py = touchOnly ? Math.sin(clock * 0.16) * 0.7 : pointer.y;
    const parallaxX = reduceMotion ? camBase.x : camBase.x + px * 0.3;
    const parallaxY = reduceMotion ? camBase.y : camBase.y + py * 0.15;
    camera.position.x += (parallaxX - camera.position.x) * Math.min(1, dt * 2.4);
    camera.position.y += (parallaxY - camera.position.y) * Math.min(1, dt * 2.4);
    camera.lookAt(camTarget);

    for (const b of balloons) {
      b.hover += (b.hoverTarget - b.hover) * Math.min(1, dt * 9);
      // Critically-ish damped spring: a click kicks `vel`, this settles it.
      b.vel += -58 * b.offset * dt - 7.2 * b.vel * dt;
      b.offset += b.vel * dt;
      const bob = reduceMotion ? 0 : Math.sin(clock * 0.85 + b.phase) * 0.02;
      const sway = reduceMotion ? 0 : Math.sin(clock * 0.62 + b.sway) * 0.052;
      let s = b.r * (1 + b.hover * 0.05);
      if (b.popped) {
        // Gone for a while, then it blows back up so the garland is never left bare.
        b.popT += dt;
        const grow = Math.min(1, Math.max(0, (b.popT - REGROW_DELAY) / REGROW_TIME));
        if (grow >= 1) b.popped = false;
        s *= Math.max(1e-4, easeOutBack(grow));
      }
      dummy.position.set(b.x, b.y + bob + b.offset, b.z);
      b.worldPos.copy(dummy.position);
      dummy.rotation.set(0, 0, sway);
      dummy.scale.set(s, s * 1.08, s);
      dummy.updateMatrix();
      b.mesh.setMatrixAt(b.index, dummy.matrix);
      dummy.position.y -= s * 1.08;
      dummy.scale.set(s * 0.19, s * 0.19, s * 0.19);
      dummy.updateMatrix();
      b.knotMesh.setMatrixAt(b.knotIndex, dummy.matrix);
      if (b.hover > 0.001 || b.hoverDirty) {
        tint.copy(b.color).lerp(WHITE, b.hover * 0.28);
        b.mesh.setColorAt(b.index, tint);
        b.mesh.instanceColor.needsUpdate = true;
        b.hoverDirty = b.hover > 0.001;
      }
    }
    for (const mesh of balloonMeshes) mesh.instanceMatrix.needsUpdate = true;
    extras.knots.instanceMatrix.needsUpdate = true;
    confetti.update(dt);

    for (const bin of bins) {
      bin.hover += (bin.hoverTarget - bin.hover) * Math.min(1, dt * 9);
      bin.vel += -72 * bin.offset * dt - 8.5 * bin.vel * dt;
      bin.offset += bin.vel * dt;
      const s = 1 + bin.hover * 0.05;
      bin.group.position.y = bin.baseY + Math.max(0, bin.offset);
      bin.group.scale.setScalar(s);
    }

    for (const spot of spots) {
      spot.hover += (spot.hoverTarget - spot.hover) * Math.min(1, dt * 9);
      spot.head.scale.setScalar(1 + spot.hover * 0.05);
      const lit = spot.on ? 2.6 : 0.05;
      spot.lens.material.emissiveIntensity = lit + spot.hover * 0.8;
    }

    // Slow 4 s breath on the violet ceiling ring.
    const pulse = 0.5 + 0.5 * Math.sin((clock / 4) * Math.PI * 2);
    extras.ledRing.material.emissiveIntensity = 1.1 + pulse * 0.9;
    extras.ledLight.intensity = 0.8 + pulse * 0.6;

    ink.render();
    raf = requestAnimationFrame(frame);
  }

  // Draw one frame synchronously so the room is on screen even before rAF ticks.
  ink.render();
  raf = requestAnimationFrame(frame);

  function onPlay() {
    if (closing) return;
    closing = true;
    playBtn.disabled = true;
    renderer.domElement.style.cursor = 'default';
    root.classList.add('menu-out');
    setTimeout(teardown, 620);
  }

  function teardown() {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('resize', onResize);
    playBtn.removeEventListener('click', onPlay);
    disposeObject(scene);
    scene.clear();
    ink.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    root.remove();
    style.remove();
    fontLink.remove();
    if (wallFace) document.fonts.delete(wallFace);
    resolve();
  }
}

const WHITE = new THREE.Color(0xffffff);

// ----- popping balloons -----
const REGROW_DELAY = 8; // s a popped balloon stays gone
const REGROW_TIME = 0.7; // s to blow back up

function easeOutBack(t) {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

const CONFETTI_MAX = 480;
const CONFETTI_PER_POP = 70;
const CONFETTI_GRAVITY = 2.4; // m/s², lighter than real: paper drifts
const CONFETTI_DRAG = 2.6; // 1/s
const CONFETTI_REST = 4; // s a piece lies where it landed before shrinking away
const CONFETTI_FADE = 0.8; // s
const CONFETTI_COLORS = [COL.pink, COL.lavender, COL.indigo, COL.yellow, COL.orange, COL.magenta, COL.teal, 0xffffff];

/** Where a falling piece comes to rest: one of the three table tops, or the floor. */
function groundAt(x, z) {
  const onTable = Math.abs(z - 0.35) <= TABLE_D / 2 && [-2.4, 0, 2.4].some((cx) => Math.abs(x - cx) <= 1.2);
  return (onTable ? TABLE_Y + 0.015 : 0) + 0.002;
}

/**
 * A fixed pool of paper flecks drawn as one InstancedMesh. A burst claims the oldest free
 * slots; each piece is blown outward, flutters down under light gravity and heavy air drag,
 * lies flat where it lands, then shrinks away.
 */
function createConfetti(scene) {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.03, 0.018),
    new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }),
    CONFETTI_MAX
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // the pieces move far from wherever the bounds were computed
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const pieces = Array.from({ length: CONFETTI_MAX }, () => ({
    alive: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    rot: new THREE.Euler(),
    spin: new THREE.Vector3(),
    flutter: 0,
    landed: -1, // seconds since landing, -1 while airborne
  }));
  let next = 0;

  for (let i = 0; i < CONFETTI_MAX; i++) {
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(0xffffff));
  }

  function burst(origin, balloonColor) {
    for (let n = 0; n < CONFETTI_PER_POP; n++) {
      const i = next;
      next = (next + 1) % CONFETTI_MAX;
      const p = pieces[i];
      p.alive = true;
      p.landed = -1;
      // Scatter from the balloon's skin, not its centre, and blow outward, a little upward.
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      p.pos.copy(origin).addScaledVector(dir, 0.08);
      p.vel.copy(dir).multiplyScalar(1.2 + Math.random() * 1.6);
      p.vel.y += 0.8;
      p.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      p.spin.set(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8);
      p.flutter = Math.random() * 6.28;
      // About a third of the flecks match the balloon, the rest are the party mix.
      if (Math.random() < 0.35) color.copy(balloonColor);
      else color.set(CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    for (let i = 0; i < CONFETTI_MAX; i++) {
      const p = pieces[i];
      if (!p.alive) continue;
      let scale = 1;
      if (p.landed < 0) {
        p.vel.y -= CONFETTI_GRAVITY * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - CONFETTI_DRAG * dt));
        p.flutter += dt * 7;
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x += Math.sin(p.flutter) * 0.12 * dt; // side-to-side drift as it falls
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        const floor = groundAt(p.pos.x, p.pos.z);
        if (p.pos.y <= floor) {
          p.pos.y = floor;
          p.landed = 0;
          p.rot.set(-Math.PI / 2, 0, p.rot.z); // settle flat
        }
      } else {
        p.landed += dt;
        const fade = (p.landed - CONFETTI_REST) / CONFETTI_FADE;
        if (fade >= 1) p.alive = false;
        scale = p.alive ? 1 - Math.max(0, fade) : 0;
      }
      dummy.position.copy(p.pos);
      dummy.rotation.copy(p.rot);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { burst, update, mesh };
}

let popAudio = null;

/** A short synthesized pop: a burst of noise with a fast decay. Honors the SFX setting. */
function playPop() {
  if (!getSettings().sfx) return;
  try {
    popAudio ??= new AudioContext();
    const ctx = popAudio;
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  } catch {
    // No audio available; the pop is still visible.
  }
}

// Meters of wall that must stay in frame. On a narrow window the camera backs off rather
// than cropping the garland and the bins out of the shot; the clamp stops it retreating so
// far that the room turns into a doll's house.
const MIN_VISIBLE_W = 5.2;

function camDistance(aspect) {
  const halfV = THREE.MathUtils.degToRad(25);
  return THREE.MathUtils.clamp(MIN_VISIBLE_W / 2 / (Math.tan(halfV) * aspect), 4.5, 6.2);
}

// --- scene construction ---------------------------------------------------

function buildRoom(scene) {
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_W, WALL_H),
    new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.96, metalness: 0 })
  );
  wall.position.set(0, WALL_H / 2, 0);
  wall.receiveShadow = true;
  scene.add(wall);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_W, 12),
    new THREE.MeshStandardMaterial({ color: COL.ceiling, roughness: 0.95 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, WALL_H, 5.8);
  scene.add(ceiling);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_W, 12),
    new THREE.MeshStandardMaterial({ color: COL.floor, roughness: 0.98 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 5.8);
  floor.receiveShadow = true;
  scene.add(floor);

  // Conduit pipe, 15 cm under the ceiling and 20 cm proud of the wall.
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, WALL_W, 12),
    new THREE.MeshStandardMaterial({ color: 0xf2f0ed, roughness: 0.7 })
  );
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, WALL_H - 0.15, 0.2);
  scene.add(pipe);

  scene.add(buildWindow(-3.55, true));
  scene.add(buildWindow(3.55, false));
  scene.add(outlet(-2.75, 1.45));
  scene.add(outlet(3.05, 0.28));
}

function buildWindow(x, brick) {
  const group = new THREE.Group();
  group.position.set(x, 1.6, 0.012);
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 2),
    new THREE.MeshStandardMaterial({
      color: brick ? COL.brick : 0x9fb0bd,
      roughness: 1,
    })
  );
  group.add(outside);
  const frameMat = new THREE.MeshStandardMaterial({ color: COL.frame, roughness: 0.6 });
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.08, 0.05), frameMat);
  vertical.position.set(-0.26, 0, 0.02);
  group.add(vertical);
  const vertical2 = vertical.clone();
  vertical2.position.x = 0.26;
  group.add(vertical2);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.05), frameMat);
    bar.position.set(0, -1 + i * (2 / 3), 0.02);
    group.add(bar);
  }
  return group;
}

function outlet(x, y) {
  const group = new THREE.Group();
  group.position.set(x, y, 0.008);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.12, 0.012),
    new THREE.MeshStandardMaterial({ color: 0xfbfaf8, roughness: 0.55 })
  );
  group.add(plate);
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x8e8b86, roughness: 0.8 });
  for (const sy of [0.028, -0.028]) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.004), slotMat);
    slot.position.set(0, sy, 0.008);
    group.add(slot);
  }
  return group;
}

function buildLighting(scene, spots, extras) {
  // Ground colour is what lights the ceiling, since its normal faces down -- keeping it near
  // white is what stops the top of the frame reading as a grey band.
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0xeae4da, 2.7));
  const fill = new THREE.DirectionalLight(0xffffff, 1.05);
  fill.position.set(0.5, 2.4, 5);
  scene.add(fill);

  const railMat = new THREE.MeshStandardMaterial({
    color: 0xf4f4f2,
    roughness: 0.5,
    metalness: 0.1,
  });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(8, 0.05, 0.05), railMat);
  rail.position.set(0, RAIL_Y, RAIL_Z);
  scene.add(rail);

  // Low metalness on purpose: there is no environment map in this scene, and a near-metal
  // standard material with nothing to reflect renders black.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xdfe2e6,
    roughness: 0.45,
    metalness: 0.18,
  });
  const xs = SPOT_XS;
  const litIdx = new Set([1, 2, 4, 5]); // heads 2, 3, 5 and 6 are on
  const headGeo = new THREE.CylinderGeometry(0.06, 0.068, 0.15, 18);
  const lensGeo = new THREE.CircleGeometry(0.056, 18);
  const yokeGeo = new THREE.TorusGeometry(0.075, 0.009, 6, 16, Math.PI);
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8);

  xs.forEach((x, i) => {
    const group = new THREE.Group();
    group.position.set(x, RAIL_Y, RAIL_Z);

    const stem = new THREE.Mesh(stemGeo, headMat);
    stem.position.y = -0.06;
    group.add(stem);

    const yoke = new THREE.Mesh(yokeGeo, headMat);
    yoke.position.y = -0.13;
    yoke.rotation.z = Math.PI;
    group.add(yoke);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, -0.15, 0);
    // The cylinder's +Y end is its nose: this tips it down and a little toward the room, so
    // the lens is visible from a camera that sits below the rail looking up.
    head.rotation.x = THREE.MathUtils.degToRad(160);
    head.userData.kind = 'spot';
    head.userData.index = i;
    group.add(head);

    const on = litIdx.has(i);
    const lens = new THREE.Mesh(
      lensGeo,
      new THREE.MeshStandardMaterial({
        color: COL.lens,
        emissive: new THREE.Color(COL.lens),
        emissiveIntensity: on ? 2.6 : 0.05,
        roughness: 0.4,
      })
    );
    lens.position.set(0, 0.077, 0);
    lens.rotation.x = -Math.PI / 2;
    head.add(lens);

    let light = null;
    if (on) {
      light = new THREE.SpotLight(0xfff0cc, 3.6, 4.4, THREE.MathUtils.degToRad(26), 0.7, 1.7);
      light.position.set(x, RAIL_Y - 0.16, RAIL_Z);
      // Each lamp keeps its own pool. Converging them on the wall centre merged the four
      // cones into one blob that washed out the painted text.
      light.target.position.set(x, 2.45, 0);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 0.3;
      light.shadow.camera.far = 6;
      light.shadow.bias = -0.0015;
      light.shadow.radius = 4;
      scene.add(light);
      scene.add(light.target);
    }

    scene.add(group);
    spots.push({
      head,
      lens,
      light,
      on,
      baseIntensity: 3.6,
      hover: 0,
      hoverTarget: 0,
    });
  });

  // Flush violet ring above the balloons.
  const ledGroup = new THREE.Group();
  ledGroup.position.set(0.05, WALL_H - 0.03, 0.95);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.045, 28),
    new THREE.MeshStandardMaterial({ color: 0xf6f5f3, roughness: 0.6 })
  );
  ledGroup.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.29, 0.035, 10, 40),
    new THREE.MeshStandardMaterial({
      color: COL.led,
      emissive: new THREE.Color(COL.led),
      emissiveIntensity: 1.6,
      roughness: 0.35,
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.028;
  ledGroup.add(ring);
  scene.add(ledGroup);
  const ledLight = new THREE.PointLight(COL.led, 1.6, 3, 2);
  ledLight.position.set(0.05, WALL_H - 0.2, 0.95);
  scene.add(ledLight);
  extras.ledRing = ring;
  extras.ledLight = ledLight;

  scene.add(cornerLight(-3.3, 2.1, COL.teal, 2.1));
  scene.add(cornerLight(3.3, 2.3, 0xffffff, 2.6));
}

function cornerLight(x, z, color, intensity) {
  const group = new THREE.Group();
  group.position.set(x, WALL_H - 0.02, z);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24),
    new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.5,
      roughness: 0.4,
    })
  );
  group.add(body);
  const light = new THREE.PointLight(color, intensity, 4.5, 2);
  light.position.y = -0.2;
  group.add(light);
  return group;
}

// Garland spine: dips through the middle and finishes higher on the right than the left.
function spineY(t) {
  return 3.02 - 0.16 * Math.sin(Math.PI * t) + 0.16 * t;
}

// `count` is how many of each colour the layout asks for; placeBalloons() drops any with no
// free spot, so these are tuned to land 36 on the wall: 7 pink, 9 lavender, 6 indigo, 6 yellow,
// 4 orange, 4 magenta. Changing any count reshuffles the random layout for every later group.
const BALLOON_ROLES = [
  { color: COL.pink, count: 14, rough: 0.85, metal: 0, rMin: 0.19, rMax: 0.26, spans: [[0, 0.2], [0.78, 1]], spread: 0.26 },
  { color: COL.lavender, count: 16, rough: 0.35, metal: 0.25, rMin: 0.14, rMax: 0.18, spans: [[0.06, 0.94]], spread: 0.24 },
  { color: COL.indigo, count: 14, rough: 0.18, metal: 0.05, rMin: 0.15, rMax: 0.2, spans: [[0.36, 0.68]], spread: 0.21, bias: -0.13 },
  { color: COL.yellow, count: 10, rough: 0.8, metal: 0, rMin: 0.13, rMax: 0.17, spans: [[0.18, 0.38], [0.58, 0.8]], spread: 0.22 },
  { color: COL.orange, count: 5, rough: 0.6, metal: 0.05, rMin: 0.08, rMax: 0.105, spans: [[0.25, 0.75]], spread: 0.26 },
  { color: COL.magenta, count: 5, rough: 0.6, metal: 0.05, rMin: 0.08, rMax: 0.105, spans: [[0.2, 0.85]], spread: 0.26 },
];

// The band the garland hangs in. Balloons stay under the rail and its lamps, never *look* as if
// they cross the rail (see balloonFitsBand), and keep clear of the painted text: above the heading (top ~2.45m) where it runs, x -0.90..1.41 plus
// a margin for perspective, and elsewhere above the two small lines (top ~2.0m).
const BALLOON_CEILING = RAIL_Y - 0.025 - 0.01; // underside of the rail, less a hair of air
const BALLOON_FLOOR = 2.52;
const BALLOON_FLOOR_SIDES = 2.1;
const HEADING_X = [-1.05, 1.56];
const BALLOON_Z = [0.03, 0.9]; // off the wall .. how far into the room the garland may reach
// The menu camera at its lowest (1.5m less the 0.15 parallax dip) and nearest (camDistance's
// floor). Seen from down here, anything in front of the rail projects higher than it really is.
const EYE_Y = 1.35;
const EYE_Z_MIN = 4.5;
const BALLOON_X = [-3.05, 3.05];
// A balloon at its fullest: drawn 1.08x taller than wide, bobbing up to 2cm, and swelling up to
// ~10% as it overshoots blowing back up after a pop (5% on hover).
const BALLOON_HALF_H = 1.08;
const BALLOON_MAX_SWELL = 1.1;
const BALLOON_BOB = 0.02;
// Space kept between two balloons, allowing for their bobs being out of step.
const BALLOON_GAP = 2 * BALLOON_BOB + 0.015;
// Each lamp, stem to lens, as a keep-out column reaching 25cm below the rail (the tilted head's
// lowest point is ~24cm down), wide enough to take in the head's bounding-box corners.
const LAMP_R = 0.115;
const LAMP_BOTTOM = RAIL_Y - 0.25;

function balloonFitsBand(x, y, z, r) {
  const halfH = r * BALLOON_HALF_H * BALLOON_MAX_SWELL + BALLOON_BOB;
  const halfW = r * BALLOON_MAX_SWELL;
  const overHeading = x + halfW > HEADING_X[0] && x - halfW < HEADING_X[1];
  const floor = overHeading ? BALLOON_FLOOR : BALLOON_FLOOR_SIDES;
  if (y + halfH > BALLOON_CEILING || y - halfH < floor) return false;
  if (x - halfW < BALLOON_X[0] || x + halfW > BALLOON_X[1]) return false;
  if (z - halfW < BALLOON_Z[0] || z + halfW > BALLOON_Z[1]) return false;
  // A balloon forward of the rail must still read as under it: carry the sight line over its
  // top back to the rail's depth and it has to pass beneath the rail there.
  const front = z + halfW;
  if (front > RAIL_Z) {
    const topSeenAtRail = EYE_Y + (y + halfH - EYE_Y) * ((EYE_Z_MIN - RAIL_Z) / (EYE_Z_MIN - front));
    if (topSeenAtRail > BALLOON_CEILING) return false;
  }
  if (y + halfH <= LAMP_BOTTOM) return true;
  return SPOT_XS.every((lx) => Math.hypot(x - lx, z - RAIL_Z) >= halfW + LAMP_R);
}

/** Balloons are 1.08x taller than wide, so with y squashed by that factor each is a sphere. */
function balloonsClear(a, x, y, z, r) {
  const d = Math.hypot(a.x - x, (a.y - y) / BALLOON_HALF_H, a.z - z);
  return d >= (a.r + r) * BALLOON_MAX_SWELL + BALLOON_GAP;
}

/**
 * Hang every balloon clear of the rail, the lamps and every other balloon. Each is placed in
 * turn, biggest first, at the free spot nearest where the garland's layout wanted it; one that
 * finds no free spot anywhere near its place is left out. Nudging a random layout apart kept
 * jamming against the lamps and the band, so this places rather than repairs: nothing can
 * overlap, and the garland keeps its shape -- clusters of colour where the layout put them.
 */
function placeBalloons(wanted) {
  const placed = [];
  for (const b of [...wanted].sort((p, q) => q.r - p.r)) {
    let best = null;
    let bestScore = Infinity;
    for (let dx = -1; dx <= 1; dx += 0.025) {
      const x = b.x + dx;
      for (let y = BALLOON_FLOOR_SIDES; y <= BALLOON_CEILING; y += 0.025) {
        for (let z = BALLOON_Z[0]; z <= BALLOON_Z[1]; z += 0.04) {
          const score = dx * dx + 0.5 * (y - b.y) ** 2 + 0.2 * (z - b.z) ** 2;
          if (score >= bestScore) continue;
          if (!balloonFitsBand(x, y, z, b.r)) continue;
          if (!placed.every((a) => balloonsClear(a, x, y, z, b.r))) continue;
          best = { x, y, z };
          bestScore = score;
        }
      }
    }
    if (best) placed.push(Object.assign(b, best));
  }
  return placed;
}

function buildBalloons(scene, balloons, balloonMeshes, extras) {
  const rand = mulberry(20260922);
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const knotGeo = new THREE.ConeGeometry(0.5, 0.9, 8);

  // Where the garland's layout would like each balloon, before it is fitted into the band.
  const wanted = [];
  BALLOON_ROLES.forEach((role, groupIndex) => {
    const base = new THREE.Color(role.color);
    for (let i = 0; i < role.count; i++) {
      const span = role.spans[Math.floor(rand() * role.spans.length)];
      const t = span[0] + rand() * (span[1] - span[0]);
      const r = role.rMin + rand() * (role.rMax - role.rMin);
      let y = spineY(t) + (rand() * 2 - 1) * role.spread + (role.bias || 0);
      if (role.color === COL.pink && t > 0.78) y += rand() * 0.6 - 0.3;
      // Pushed saturation: ACES rolls colour off toward white as exposure climbs, so the
      // garland needs deeper base tints to stay candy-bright rather than pastel.
      const color = base.clone().offsetHSL(0, 0.12 + (rand() - 0.5) * 0.03, (rand() - 0.5) * 0.05);
      const z = 0.16 + rand() * 0.2 + r * 0.5;
      wanted.push({
        group: groupIndex,
        x: -3 + t * 5.95,
        y,
        z,
        r,
        color,
        phase: rand() * Math.PI * 2,
        sway: rand() * Math.PI * 2,
      });
    }
  });
  const hung = placeBalloons(wanted);

  const knots = new THREE.InstancedMesh(knotGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), hung.length);
  knots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(knots);
  extras.knots = knots;

  let knotIndex = 0;
  BALLOON_ROLES.forEach((role, groupIndex) => {
    const members = hung.filter((b) => b.group === groupIndex);
    if (!members.length) return;
    const mesh = new THREE.InstancedMesh(
      sphere,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: role.rough, metalness: role.metal }),
      members.length
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.userData.kind = 'balloon';
    mesh.userData.group = groupIndex;
    scene.add(mesh);
    balloonMeshes.push(mesh);

    members.forEach((b, i) => {
      mesh.setColorAt(i, b.color);
      knots.setColorAt(knotIndex, b.color);
      balloons.push({
        ...b,
        mesh,
        knotMesh: knots,
        knotIndex: knotIndex++,
        index: i,
        offset: 0,
        vel: 0,
        hover: 0,
        hoverTarget: 0,
        hoverDirty: false,
        popped: false,
        popT: 0,
        worldPos: new THREE.Vector3(),
      });
    });
    mesh.instanceColor.needsUpdate = true;
  });
  knots.instanceColor.needsUpdate = true;

  // Seed every instance with its resting transform. Without this the instance matrices stay
  // zeroed until the first animated frame, which both hides the garland on the very first
  // render and makes InstancedMesh cache a collapsed bounding sphere that swallows all picks.
  const seed = new THREE.Object3D();
  for (const b of balloons) {
    seed.position.set(b.x, b.y, b.z);
    seed.rotation.set(0, 0, 0);
    seed.scale.set(b.r, b.r * 1.08, b.r);
    seed.updateMatrix();
    b.mesh.setMatrixAt(b.index, seed.matrix);
    seed.position.y -= b.r * 1.08;
    seed.scale.setScalar(b.r * 0.19);
    seed.updateMatrix();
    knots.setMatrixAt(b.knotIndex, seed.matrix);
  }
  for (const mesh of balloonMeshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  knots.instanceMatrix.needsUpdate = true;
  knots.computeBoundingSphere();
}

function buildWallText(scene) {
  const heart = new THREE.Mesh(
    heartGeometry(0.3),
    new THREE.MeshStandardMaterial({ map: speckleTexture(), roughness: 0.55, metalness: 0.1 })
  );
  heart.position.set(0.02, 2.25, 0.03);
  heart.castShadow = true;
  scene.add(heart);
}

function buildTables(scene) {
  const topMat = new THREE.MeshStandardMaterial({ color: COL.tableTop, roughness: 0.55 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.6 });
  const legMat = new THREE.MeshStandardMaterial({ color: COL.dark, roughness: 0.5, metalness: 0.5 });
  const topGeo = new THREE.BoxGeometry(2.4, 0.03, TABLE_D);
  const edgeGeo = new THREE.BoxGeometry(2.4, 0.045, 0.02);
  const legGeo = new THREE.BoxGeometry(0.035, TABLE_Y, 0.035);
  const barGeo = new THREE.BoxGeometry(0.025, 0.025, TABLE_D - 0.16);

  for (const cx of [-2.4, 0, 2.4]) {
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(cx, TABLE_Y, 0.35);
    top.castShadow = true;
    top.receiveShadow = true;
    scene.add(top);

    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set(cx, TABLE_Y - 0.008, 0.35 + TABLE_D / 2);
    scene.add(edge);

    for (const dx of [-1.08, 1.08]) {
      for (const dz of [-0.2, 0.2]) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(cx + dx, TABLE_Y / 2, 0.35 + dz);
        scene.add(leg);
      }
      const bar = new THREE.Mesh(barGeo, legMat);
      bar.position.set(cx + dx, 0.18, 0.35);
      scene.add(bar);
    }
  }
}

// --- toiletries ----------------------------------------------------------
// Real proportions and colours borrowed from the game's own item table, so the bins on the
// menu wall hold the same goods the player is about to pack. Built from primitives here
// rather than imported from scene.js, to keep the menu removable in one step.

const ITEM_COLORS = {
  shampoo: [0xff5fae],
  bodyWash: [0x1f6bff],
  conditioner: [0xa855f7],
  wipes: [0x2ec4a6],
  soap: [0xfafaf5, 0xffc247],
  toothbrushSet: [0xe53935, 0x43a047, 0xfb8c00, 0x00acc1],
  washrag: [0xf28b82, 0xfdd663],
  deodorant: [0x3949ab, 0x00897b, 0xef6c00],
  lipBalm: [0xe85d75, 0xf2a65a, 0x26c281],
};

const BOTTLE = { shampoo: [0.033, 0.2], bodyWash: [0.035, 0.21], conditioner: [0.032, 0.19] };

/** Overall height of each built item, used to sit it a fixed distance proud of a bin rim. */
const ITEM_H = {
  shampoo: 0.228,
  bodyWash: 0.238,
  conditioner: 0.218,
  wipes: 0.087,
  soap: 0.0385,
  washrag: 0.03,
  deodorant: 0.126,
  lipBalm: 0.069,
  toothbrushSet: 0.031,
};

const geoCache = new Map();
const matCache = new Map();

function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

function plastic(color, roughness = 0.42) {
  const key = `${color}:${roughness}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 }));
  }
  return matCache.get(key);
}

/** One toiletry, origin at the centre of its base so callers can just drop it on a surface. */
function toiletryMesh(kind, color) {
  const group = new THREE.Group();
  const cap = plastic(0xf2f2f2, 0.6);
  const add = (g, m, x, y, z) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  if (BOTTLE[kind]) {
    const [r, h] = BOTTLE[kind];
    add(geo(`btl${kind}`, () => new THREE.CylinderGeometry(r, r * 0.94, h, 16)), plastic(color), 0, h / 2, 0);
    add(geo(`cap${kind}`, () => new THREE.CylinderGeometry(r * 0.52, r * 0.58, 0.028, 12)), cap, 0, h + 0.014, 0);
    return group;
  }

  switch (kind) {
    case 'wipes':
      add(geo('wipesBody', () => new THREE.CylinderGeometry(0.055, 0.055, 0.075, 18)), plastic(color), 0, 0.0375, 0);
      add(geo('wipesLid', () => new THREE.CylinderGeometry(0.056, 0.056, 0.012, 18)), cap, 0, 0.081, 0);
      break;
    case 'soap':
      add(geo('soap', () => new THREE.BoxGeometry(0.099, 0.0385, 0.066)), plastic(color, 0.65), 0, 0.019, 0);
      break;
    case 'washrag':
      add(
        geo('washrag', () => new THREE.BoxGeometry(0.15, 0.03, 0.15)),
        (() => {
          const key = `rag${color}`;
          if (!matCache.has(key)) {
            matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
          }
          return matCache.get(key);
        })(),
        0,
        0.015,
        0
      );
      break;
    case 'deodorant':
      add(geo('deoBody', () => new THREE.BoxGeometry(0.0525, 0.09, 0.0315)), plastic(color), 0, 0.045, 0);
      add(geo('deoCap', () => new THREE.BoxGeometry(0.0545, 0.036, 0.0335)), cap, 0, 0.108, 0);
      break;
    case 'lipBalm':
      add(geo('balmBody', () => new THREE.CylinderGeometry(0.0105, 0.0105, 0.048, 12)), plastic(color), 0, 0.024, 0);
      add(geo('balmCap', () => new THREE.CylinderGeometry(0.0108, 0.0108, 0.021, 12)), cap, 0, 0.0585, 0);
      break;
    case 'toothbrushSet':
      // Brush and paste sit side by side, matching the welded set the game spawns.
      add(geo('brush', () => new THREE.BoxGeometry(0.02, 0.031, 0.209)), plastic(color), -0.0198, 0.0155, 0);
      add(geo('paste', () => new THREE.BoxGeometry(0.033, 0.0275, 0.16)), plastic(0xf5f5f5, 0.5), 0.0143, 0.0138, 0.013);
      add(geo('stripe', () => new THREE.BoxGeometry(0.0335, 0.007, 0.16)), plastic(color, 0.5), 0.0143, 0.0245, 0.013);
      break;
  }
  return group;
}

/** Which goods each container holds, left to right. */
const BIN_ITEMS = [
  'shampoo',
  'bodyWash',
  'conditioner',
  'wipes',
  'soap',
  'lipBalm',
  'deodorant',
  'toothbrushSet',
  'washrag',
];

// Left to right: four large oval tubs, three slanted-front bins, two large oval tubs.
const BIN_LAYOUT = [
  { x: -2.05, type: 'tub', w: 0.54, h: 0.38, note: '1' },
  { x: -1.45, type: 'tub', w: 0.54, h: 0.38, note: '1' },
  { x: -0.85, type: 'tub', w: 0.54, h: 0.38, note: '2' },
  { x: -0.25, type: 'tub', w: 0.54, h: 0.38, note: '1' },
  { x: 0.28, type: 'slant', w: 0.4, h: 0.3, note: '1' },
  { x: 0.74, type: 'slant', w: 0.4, h: 0.3, note: '1' },
  { x: 1.2, type: 'slant', w: 0.4, h: 0.3, note: '1' },
  { x: 1.73, type: 'tub', w: 0.54, h: 0.38, note: '1' },
  { x: 2.33, type: 'tub', w: 0.54, h: 0.38, note: '1' },
];

function buildBins(scene, bins) {
  const rand = mulberry(4242);
  const tubMat = new THREE.MeshStandardMaterial({
    color: COL.hotPink,
    roughness: 0.3,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xc41f65, roughness: 0.45 });
  const unitTub = tubGeometry(1);
  const handleGeo = new THREE.TorusGeometry(0.06, 0.014, 6, 16);

  BIN_LAYOUT.forEach((spec, i) => {
    const group = new THREE.Group();
    group.position.set(spec.x, TABLE_Y, 0.4);
    let hit;

    if (spec.type === 'tub') {
      const tub = new THREE.Mesh(unitTub, tubMat);
      tub.scale.set(spec.w / 2, spec.h, (spec.w / 2) * 0.76);
      tub.castShadow = true;
      tub.receiveShadow = true;
      group.add(tub);
      hit = tub;
      for (const sx of [-1, 1]) {
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.scale.set(1, 0.55, 1);
        handle.position.set(sx * spec.w * 0.47, spec.h * 0.8, 0);
        handle.rotation.y = Math.PI / 2;
        group.add(handle);
      }
    } else {
      hit = buildSlantBin(group, spec, tubMat, handleMat);
    }

    hit.userData.kind = 'bin';
    hit.userData.index = i;

    // A tub's front is its lathed wall, which has already pinched inward by this height; a
    // slanted bin's is a flat plate. Both notes have to land just proud of that surface.
    const faceZ = spec.type === 'tub' ? (spec.w / 2) * 0.76 * 0.88 + 0.008 : 0.186;
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.1),
      new THREE.MeshStandardMaterial({ map: noteTexture(spec.note), roughness: 0.9 })
    );
    note.position.set(0, spec.h * 0.45, faceZ);
    group.add(note);

    // Each container holds one kind of donation, standing tall enough to clear the rim.
    const kind = BIN_ITEMS[i];
    const palette = ITEM_COLORS[kind];
    const flat = kind === 'soap' || kind === 'washrag' || kind === 'toothbrushSet';
    // A slanted bin is read over its low front lip, not its back edge, so it gets its own
    // reference height. Everything then sits a fixed amount proud of that line.
    const rimY = spec.type === 'tub' ? spec.h : spec.h * 0.55 + 0.07;
    // Nothing may start above the line the bin's front hides: an item whose bottom shows reads
    // as floating over an empty bin. Tall bottles already reach well below it; short items
    // (soap, lip balm, a flat stack of rags) used to sit a few cm above the rim in mid-air.
    // The camera looks slightly down into the bins, so the line sits a little under the rim.
    const hiddenY = spec.type === 'tub' ? spec.h - 0.035 : spec.h * 0.55;
    const baseY = Math.min(rimY + (flat ? 0.05 : 0.1) - ITEM_H[kind], hiddenY - 0.02);
    // Flat goods pile from below that line, so each of the two piles gets as many layers as it
    // takes to stand ~6cm above the bin's visible front edge; thin rags need more than soap.
    const PILE_SHOW = 0.06;
    const frontY = spec.type === 'tub' ? spec.h : spec.h * 0.55;
    const count = flat ? 2 * Math.ceil((frontY + PILE_SHOW - baseY) / ITEM_H[kind]) : 5;
    for (let s = 0; s < count; s++) {
      const item = toiletryMesh(kind, palette[Math.floor(rand() * palette.length)]);
      if (flat) {
        // Flat goods go in two neat piles, each layer squarely on the one below. Scattered at
        // random, an upper bar rarely landed on anything and read as hovering.
        const pile = s % 2;
        const layer = Math.floor(s / 2);
        item.position.set(
          (pile - 0.5) * spec.w * 0.3 + (rand() - 0.5) * 0.02,
          baseY + layer * ITEM_H[kind],
          (rand() - 0.5) * 0.03
        );
        item.rotation.y = (rand() - 0.5) * 0.35;
      } else {
        item.position.set((rand() - 0.5) * spec.w * 0.52, baseY, (rand() - 0.5) * spec.w * 0.3);
        item.rotation.y = rand() * Math.PI * 2;
        item.rotation.z = (rand() - 0.5) * 0.28;
      }
      group.add(item);
    }

    scene.add(group);
    bins.push({ group, hit, baseY: TABLE_Y, offset: 0, vel: 0, hover: 0, hoverTarget: 0 });
  });

  for (const x of [-2.3, 0.1, 2.35]) scene.add(signCard(x));
}

/** Slanted-front bin: five plates, so the top stays open without any CSG. */
function buildSlantBin(group, spec, mat, handleMat) {
  const d = 0.34;
  const hFront = spec.h * 0.55;
  const hBack = spec.h;
  const t = 0.016;

  const bottom = new THREE.Mesh(new THREE.BoxGeometry(spec.w, t, d), mat);
  bottom.position.set(0, t / 2, 0);
  bottom.castShadow = true;
  group.add(bottom);

  const back = new THREE.Mesh(new THREE.BoxGeometry(spec.w, hBack, t), mat);
  back.position.set(0, hBack / 2, -d / 2);
  back.castShadow = true;
  group.add(back);

  const front = new THREE.Mesh(new THREE.BoxGeometry(spec.w, hFront, t), mat);
  front.position.set(0, hFront / 2, d / 2);
  front.castShadow = true;
  group.add(front);

  const side = new THREE.Shape();
  side.moveTo(-d / 2, 0);
  side.lineTo(d / 2, 0);
  side.lineTo(d / 2, hFront);
  side.lineTo(-d / 2, hBack);
  side.lineTo(-d / 2, 0);
  const sideGeo = new THREE.ExtrudeGeometry(side, { depth: t, bevelEnabled: false });
  sideGeo.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(sideGeo, mat);
    plate.position.set((sx * (spec.w - t)) / 2, 0, 0);
    group.add(plate);
  }

  const rim = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.02, 0.018, t + 0.01), handleMat);
  rim.position.set(0, hFront, d / 2);
  group.add(rim);

  return front;
}

function signCard(x) {
  const group = new THREE.Group();
  group.position.set(x, TABLE_Y, 0.14);
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.23),
    new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9 })
  );
  card.position.set(0, 0.145, 0);
  card.rotation.x = -0.12;
  group.add(card);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.05, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7 })
  );
  stand.position.set(0, 0.02, 0.02);
  group.add(stand);
  return group;
}

/**
 * A packed cellophane treat bag: straight body, contents standing on its floor, then a neck
 * gathered into a ruffled crown with a tie. The film writes no depth so the goods inside stay
 * visible through both of its walls.
 */
function goodieBag(contents, film, rand) {
  const group = new THREE.Group();
  const w = 0.2;
  const d = 0.16;
  const h = 0.24;

  const body = new THREE.Mesh(geo('bagBody', () => new THREE.BoxGeometry(w, h, d)), film);
  body.position.y = h / 2;
  group.add(body);

  const neck = new THREE.Mesh(
    geo('bagNeck', () => new THREE.CylinderGeometry(0.03, w * 0.42, 0.07, 12, 1, true)),
    film
  );
  neck.position.y = h + 0.032;
  group.add(neck);

  const crown = new THREE.Mesh(
    geo('bagCrown', () => new THREE.CylinderGeometry(0.058, 0.028, 0.055, 12, 1, true)),
    film
  );
  crown.position.y = h + 0.092;
  group.add(crown);

  const tie = new THREE.Mesh(
    geo('bagTie', () => new THREE.TorusGeometry(0.026, 0.008, 6, 14)),
    plastic(COL.hotPink, 0.45)
  );
  tie.position.y = h + 0.064;
  tie.rotation.x = Math.PI / 2;
  group.add(tie);

  contents.forEach((kind, i) => {
    const palette = ITEM_COLORS[kind];
    const item = toiletryMesh(kind, palette[Math.floor(rand() * palette.length)]);
    const x = (i - 1) * 0.052 + (rand() - 0.5) * 0.02;
    const z = (rand() - 0.5) * 0.04;
    if (kind === 'toothbrushSet') {
      // Tipped onto its end: the set is 21 cm long, which only fits the bag upright.
      item.rotation.set(-Math.PI / 2, rand() * Math.PI * 2, 0);
      item.position.set(x, 0.117, z);
    } else {
      item.rotation.y = rand() * Math.PI * 2;
      item.position.set(x, 0.012, z);
    }
    group.add(item);
  });

  return group;
}

function buildForeground(scene) {
  const rand = mulberry(99);
  const clearMat = new THREE.MeshStandardMaterial({
    color: 0xe8f0f2,
    transparent: true,
    opacity: 0.42,
    roughness: 0.15,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false, // so the packed goods read through both walls of the film
  });
  // Four finished goodie bags at the far left of the table -- the worked example of what the
  // player is about to make, so each one is packed with real items rather than filler.
  const BAG_CONTENTS = [
    ['bodyWash', 'soap', 'lipBalm'],
    ['shampoo', 'wipes', 'deodorant'],
    ['conditioner', 'soap', 'toothbrushSet'],
    ['bodyWash', 'washrag', 'lipBalm'],
  ];
  BAG_CONTENTS.forEach((contents, i) => {
    const bag = goodieBag(contents, clearMat, rand);
    bag.position.set(-3.34 + i * 0.29, TABLE_Y, 0.38 + (rand() - 0.5) * 0.06);
    bag.rotation.y = (rand() - 0.5) * 0.8;
    scene.add(bag);
  });

  // Stack of clear storage bins with purple lids, far left, on the floor.
  const binGeo = new THREE.BoxGeometry(0.62, 0.3, 0.44);
  const lidGeo = new THREE.BoxGeometry(0.66, 0.045, 0.48);
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x6b4bbd, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const bin = new THREE.Mesh(binGeo, clearMat);
    bin.position.set(-3.65, 0.16 + i * 0.35, 1.05);
    scene.add(bin);
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.set(-3.65, 0.33 + i * 0.35, 1.05);
    scene.add(lid);
  }
}

const MENU_CSS = `
#menu-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  opacity: 1;
  transition: opacity 0.6s ease;
}
#menu-root.menu-out { opacity: 0; }
#menu-root canvas { display: block; width: 100%; height: 100%; }
.menu-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 5vh;
  pointer-events: none;
}
.menu-card {
  pointer-events: auto;
  text-align: center;
  max-width: min(92vw, 480px);
}
.menu-title {
  margin: 0;
  font-family: 'Blueberry', 'Comic Sans MS', cursive;
  font-weight: normal;
  font-size: clamp(38px, 7vw, 72px);
  color: #00e3ff;
  -webkit-text-stroke: 6px #af1ef9;
  paint-order: stroke fill;
  letter-spacing: 0.5px;
}
.menu-sub {
  margin: 6px 0 20px;
  font-family: 'Patrick Hand', 'Comic Sans MS', system-ui, sans-serif;
  font-size: clamp(15px, 2vw, 20px);
  color: #fff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.55), 0 0 3px rgba(0, 0, 0, 0.4);
}
.menu-play {
  font: inherit;
  font-family: 'Patrick Hand', 'Comic Sans MS', system-ui, sans-serif;
  font-size: clamp(20px, 2.6vw, 27px);
  padding: 12px 50px;
  border: 4px solid #00c6e8;
  border-radius: 999px;
  background: #fff;
  color: #0090ad;
  cursor: pointer;
  box-shadow: 0 10px 30px rgba(0, 150, 190, 0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.menu-play:hover { box-shadow: 0 14px 36px rgba(0, 150, 190, 0.5); transform: translateY(-2px); }
.menu-play:active { transform: translateY(0); }
.menu-play:focus-visible { outline: 4px solid #2a1020; outline-offset: 4px; }
.menu-play[disabled] { opacity: 0.6; cursor: default; }
`;
// ===== END 3D MENU =====
