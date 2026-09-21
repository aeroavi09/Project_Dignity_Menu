import * as THREE from 'three';
import { ROOM } from './layout.js';

const CAMERA_TARGET = new THREE.Vector3(0, 0.95, 0);
const CAMERA_HEIGHT = 1.35;
// Meters of scene width that must always fit on screen. The shelf and table together span
// x=-1.55..1.55, so this is that 3.1 m plus a margin -- tightening it trims the empty room at
// the sides. Don't go below ~3.4 or items flicked sideways leave the frame.
const MIN_VISIBLE_WIDTH = 3.9;
const FOV = 45;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false; // no shadows anywhere: flat, poster-like lighting
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // Fixed, locked perspective camera. No orbit controls: gameplay reads as 2.5D.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;
    camera.aspect = aspect;
    // Pull the camera straight back on narrow screens so the whole room stays visible;
    // the viewing angle never changes.
    const halfV = THREE.MathUtils.degToRad(FOV / 2);
    const distForWidth = MIN_VISIBLE_WIDTH / 2 / (Math.tan(halfV) * aspect);
    // On a widescreen this floor, not MIN_VISIBLE_WIDTH, is what sets the framing. It also
    // keeps the shelf top (y=1.9) inside the view: at 2.75 the top edge lands at y~2.09.
    const dist = Math.max(2.75, distForWidth);
    camera.position.set(0, CAMERA_HEIGHT, dist);
    camera.lookAt(CAMERA_TARGET);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  // Lights
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a2c6f, 0.85));
  const sun = new THREE.DirectionalLight(0xfff6e8, 2.0);
  sun.position.set(1.5, 3.5, 3);
  scene.add(sun);

  // Fill and rim. With shadows off these do all the shaping: a cool fill from the opposite
  // side keeps the round bottles from flattening, and the rim skims their left edges so they
  // separate from the white wall instead of dissolving into it.
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(-2.5, 1.6, 2.2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-1.8, 2.2, -1.5);
  scene.add(rim);

  // Room: floor and back wall
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b3fa0, roughness: 0.85 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 1.5;
  floor.receiveShadow = true;
  scene.add(floor);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 6),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      // The hemisphere light gives a vertical surface a 50/50 sky/ground blend, so the
      // purple floor would tint the wall grey. A flat emissive lift puts it back at true
      // white without brightening anything else in the room.
      emissive: 0xffffff,
      emissiveIntensity: 0.45,
    })
  );
  wall.position.set(0, 3, ROOM.backZ);
  wall.receiveShadow = true;
  scene.add(wall);

  const baseboard = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.08, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
  );
  baseboard.position.set(0, 0.04, ROOM.backZ + 0.01);
  scene.add(baseboard);

  return { renderer, scene, camera };
}

export function addStaticMeshes(scene, parts) {
  const materials = new Map();
  for (const part of parts) {
    if (!materials.has(part.color)) {
      materials.set(part.color, new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.42 }));
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...part.size), materials.get(part.color));
    mesh.position.set(...part.pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------------------
// Item visuals. Each is a Group centered on the physics body's origin and kept
// inside the physics shape's bounds so what you see is what collides.
// ---------------------------------------------------------------------------
function mat(color, roughness = 0.32) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function shade(color, amount) {
  return new THREE.Color(color).lerp(new THREE.Color(amount > 0 ? 0xffffff : 0x000000), Math.abs(amount));
}

function add(group, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/**
 * A toothpaste-tube barrel.
 *
 * The shape that reads as "toothpaste" isn't a cylinder — it's a cross-section that
 * morphs along the length: circular at the cap end, progressively flattening and
 * squaring off into the crimped tail. Each ring is a superellipse
 * |x/a|^n + |y/b|^n = 1, where n=2 gives the circle at the cap and n grows toward a
 * rounded rectangle at the crimp while the vertical half-extent collapses.
 *
 * Built directly along +Z (the axis items lie on), so it needs no rotation.
 * `uFrom`/`uTo` emit a sub-range of the same profile, which is how the brand stripe
 * hugs the barrel exactly.
 */
function tubeBarrelGeometry(radius, length, { uFrom = 0, uTo = 1, swell = 1, open = false } = {}) {
  const RINGS = 32;
  const RADIAL = 32;
  const positions = [];
  const indices = [];

  // 1 = fully crimped at the tail, easing to 0 (round) by two thirds along.
  function flatness(u) {
    const t = Math.min(1, u / 0.66);
    return 1 - t * t * (3 - 2 * t);
  }

  for (let i = 0; i <= RINGS; i++) {
    const u = uFrom + ((uTo - uFrom) * i) / RINGS;
    const f = flatness(u);
    const a = radius * (1 + 0.2 * f) * swell;
    const b = radius * (1 - 0.9 * f) * swell;
    const e = 2 / (2 + 7 * f); // superellipse exponent: circle -> rounded rectangle
    const z = -length / 2 + u * length;
    for (let j = 0; j < RADIAL; j++) {
      const th = (j / RADIAL) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      positions.push(a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(sn) * Math.abs(sn) ** e, z);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const k = (j + 1) % RADIAL;
      const A = i * RADIAL + j;
      const B = i * RADIAL + k;
      const C = (i + 1) * RADIAL + k;
      const D = (i + 1) * RADIAL + j;
      indices.push(A, B, C, A, C, D);
    }
  }

  if (!open) {
    // Fan-close both ends so nothing shows through the tube.
    for (const [ring, flip] of [[0, true], [RINGS, false]]) {
      const base = positions.length / 3;
      const z = -length / 2 + (flip ? uFrom : uTo) * length;
      positions.push(0, 0, z);
      for (let j = 0; j < RADIAL; j++) {
        const k = (j + 1) % RADIAL;
        const A = ring * RADIAL + j;
        const B = ring * RADIAL + k;
        indices.push(base, flip ? A : B, flip ? B : A);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const builders = {
  // Bottles: body + narrower cap, total height = physics cylinder height.
  bottle(g, it) {
    const bodyH = it.height * 0.8;
    const capH = it.height - bodyH;
    add(g, new THREE.CylinderGeometry(it.radius, it.radius, bodyH, 24), mat(it.color, 0.35), 0, -it.height / 2 + bodyH / 2);
    add(g, new THREE.CylinderGeometry(it.radius * 0.5, it.radius * 0.6, capH, 20), mat(0xffffff, 0.3), 0, it.height / 2 - capH / 2);
    // label band, slightly inset in height, same radius + hair to avoid z-fighting
    add(g, new THREE.CylinderGeometry(it.radius * 1.004, it.radius * 1.004, bodyH * 0.35, 24, 1, true), mat(shade(it.color, 0.55), 0.6), 0, -it.height / 2 + bodyH * 0.45);
  },
  wipes(g, it) {
    const bodyH = it.height * 0.78;
    const lidH = it.height - bodyH;
    add(g, new THREE.CylinderGeometry(it.radius * 0.97, it.radius * 0.97, bodyH, 28), mat(it.color, 0.4), 0, -it.height / 2 + bodyH / 2);
    add(g, new THREE.CylinderGeometry(it.radius, it.radius, lidH, 28), mat(0xffffff, 0.35), 0, it.height / 2 - lidH / 2);
  },
  soap(g, it) {
    const [x, y, z] = it.size;
    add(g, new THREE.BoxGeometry(x, y, z), mat(it.color, 0.7));
    add(g, new THREE.BoxGeometry(x * 0.35, y * 1.001, z * 1.001), mat(0x6fa8dc, 0.6));
  },
  // Toothbrush + toothpaste tube lying side by side. Nothing visually joins them —
  // they are one rigid compound body, so they move together regardless. Part
  // sizes/offsets come straight from that collider so visual and physics stay in step.
  toothbrushSet(g, it) {
    const [brush, paste] = it.parts;

    // Every dimension below is a fraction of the part's collider size, so resizing the
    // set in layout.js scales the whole thing instead of leaving fixed-size details behind.
    const [bw, bh, blen] = brush.size;
    const [bx, by, bz] = brush.offset;
    const r = bw * 0.44;
    const handleY = by - bh / 2 + r;
    const handle = add(g, new THREE.CapsuleGeometry(r, blen - 2 * r, 6, 12), mat(it.color, 0.35), bx, handleY, bz);
    handle.rotation.x = Math.PI / 2;
    const bristleH = by + bh / 2 - (handleY + r);
    add(
      g,
      new THREE.BoxGeometry(bw * 0.78, bristleH, blen * 0.184),
      mat(0xffffff, 0.8),
      bx,
      handleY + r + bristleH / 2,
      bz + blen / 2 - blen * 0.158
    );

    // Toothpaste tube laid along Z, cap facing the camera like the brush head.
    const [pw, ph, plen] = paste.size;
    const [px, py, pz] = paste.offset;
    const rTube = pw / 2.4; // pw covers the crimp, which flares wider than the round end
    const capL = plen * 0.097;
    const neckL = plen * 0.041;
    const shoulderL = plen * 0.09;
    const barrelL = plen - capL - neckL - shoulderL;
    const white = mat(0xf4f4f1, 0.4);
    let z = pz - plen / 2;

    add(g, tubeBarrelGeometry(rTube, barrelL, {}), white, px, py, z + barrelL / 2);
    // Brand stripe over the round half, a hair proud of the barrel so it doesn't z-fight.
    add(
      g,
      tubeBarrelGeometry(rTube, barrelL, { uFrom: 0.42, uTo: 0.88, swell: 1.012, open: true }),
      mat(shade(it.color, 0.5), 0.55),
      px,
      py,
      z + barrelL / 2
    );
    // Crimped seam: the flat ridge pinched across the tail.
    add(g, new THREE.BoxGeometry(pw, ph * 0.18, plen * 0.041), mat(shade(it.color, 0.7), 0.6), px, py, z + plen * 0.014);
    z += barrelL;

    // Shoulder, neck and cap stay round — that end of a tube never flattens.
    for (const [geo, material, len] of [
      [new THREE.CylinderGeometry(rTube * 0.42, rTube, shoulderL, 24), white, shoulderL],
      [new THREE.CylinderGeometry(rTube * 0.4, rTube * 0.4, neckL, 18), white, neckL],
      [new THREE.CylinderGeometry(rTube * 0.52, rTube * 0.52, capL, 18), mat(shade(it.color, 0.75), 0.4), capL],
    ]) {
      add(g, geo, material, px, py, z + len / 2).rotation.x = Math.PI / 2;
      z += len;
    }
  },
  deodorant(g, it) {
    const [x, y, z] = it.size;
    const capH = y * 0.28;
    add(g, new THREE.BoxGeometry(x, y - capH, z), mat(it.color, 0.4), 0, -capH / 2);
    add(g, new THREE.BoxGeometry(x, capH, z), mat(shade(it.color, 0.45), 0.35), 0, y / 2 - capH / 2);
  },
  lipBalm(g, it) {
    const capH = it.height * 0.4;
    add(g, new THREE.CylinderGeometry(it.radius, it.radius, it.height - capH, 16), mat(it.color, 0.4), 0, -capH / 2);
    add(g, new THREE.CylinderGeometry(it.radius, it.radius, capH, 16), mat(0xf5f5f5, 0.35), 0, (it.height - capH) / 2);
  },
};

const builderFor = {
  shampoo: 'bottle',
  bodyWash: 'bottle',
  conditioner: 'bottle',
  wipes: 'wipes',
  soap: 'soap',
  toothbrushSet: 'toothbrushSet',
  deodorant: 'deodorant',
  lipBalm: 'lipBalm',
};

export function createItemMesh(item) {
  const group = new THREE.Group();
  builders[builderFor[item.kind]](group, item);
  return group;
}
