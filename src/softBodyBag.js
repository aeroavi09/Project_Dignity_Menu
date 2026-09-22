import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ROOM, SHELF, TABLE } from './layout.js';
import { INK } from './scene.js';

// Cellophane treat bag: a rounded pouch gathered into a cinched neck. `height` is the pouch
// alone -- the ruffled crown is drawn above it, out to TOP_V -- so the usable volume still
// holds one of every item kind, which is what completes a bag.
// `depth` has a hard floor: items are Z-locked and can only spin in the X/Y plane
// (angularFactor 0,0,1), so an item's Z extent is fixed no matter how the player turns it.
// The toothbrush set is 209mm along Z, so a bag shallower than that plus wall clearance is
// one the set physically cannot enter -- it just straddles the front and back walls. Depth
// is also the dimension the fixed front-on camera shows least, so this is the cheap one to
// give away. Check layout.js's longest item before shrinking it.
export const BAG = { width: 0.3, depth: 0.24, height: 0.36, handleHeight: 0.1 };

// Particles collide with statics/items (group 1) but not with each other or the generator.
export const PARTICLE_GROUP = 2;
export const GENERATOR_GROUP = 4;

// 8 corner particles, index = x | y<<1 | z<<2 (y=1 is the rim, z=1 faces the camera), plus a handle.
const HANDLE = 8;
const PARTICLE_COUNT = 9;
const PARTICLE_MASS = 0.02;
const PARTICLE_RADIUS = 0.014;
const TOTAL_MASS = PARTICLE_MASS * PARTICLE_COUNT;

// Cursor spring mirrors drag.js tuning (per kg of the whole bag) and its safety limits.
const STIFFNESS_PER_KG = 300;
const DAMPING_PER_KG = 15.5;
const MAX_STRETCH = 0.5;
const MAX_SPEED = 4;

// Soft enough that the bag visibly gives when it swings or lands. Edges hold the silhouette;
// the diagonals are what resist shear, so they are the ones slackened most -- a stiff diagonal
// is exactly what made the bag move like a crate.
const EDGE_K = 15;
const FACE_DIAG_K = 4.5;
const BODY_DIAG_K = 2;
const HANDLE_K = 25;
const SPRING_DAMPING = 0.2;

// The mesh chases the corner particles through its own spring-damper instead of tracking them
// exactly, so the walls wobble, overshoot slightly and settle. Underdamped on purpose
// (zeta ~= 0.55): the particle solver alone is too tidy to read as cloth.
// A carried bag is drawn a little smaller, scaled about the point the cursor holds it by, so
// it reads as held rather than shoved at the camera. Purely visual: the particles, the springs
// and the collider are all full size, so nothing about pickup or packing changes.
const LIFT_SCALE = 0.8;
const LIFT_RATE = 7; // per second, toward the target scale

const SKIN_K = 240;
const SKIN_DAMP = 17;
const SKIN_MAX_LAG = 0.06;

const SNAP_DURATION = 0.35;
const WALL_T = 0.03;
// 10 quads per face = 40 samples around the circumference, enough to resolve 7 ruffles in the
// crown. Below about 6 the ruffles alias into noise and the bag reads faceted again.
const SEG = 10;
const RIM_BACK = [2, 3];
const RIM_FRONT = [6, 7];

const REST = Array.from({ length: PARTICLE_COUNT }, (_, n) =>
  n === HANDLE
    ? new THREE.Vector3(0, BAG.height + BAG.handleHeight, 0)
    : new THREE.Vector3(((n & 1) - 0.5) * BAG.width, ((n >> 1) & 1) * BAG.height, (((n >> 2) & 1) - 0.5) * BAG.depth)
);

const SPRING_LAYOUT = (() => {
  const list = [];
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) {
      const diff = a ^ b;
      const bits = (diff & 1) + ((diff >> 1) & 1) + ((diff >> 2) & 1);
      if (diff === 5 && a & 2) continue; // no top-face diagonals, so the mouth can pinch and flop
      list.push([a, b, bits === 1 ? EDGE_K : bits === 2 ? FACE_DIAG_K : BODY_DIAG_K]);
    }
  }
  for (const c of [...RIM_BACK, ...RIM_FRONT]) list.push([HANDLE, c, HANDLE_K]);
  return list;
})();

// Cellophane: barely tinted, very smooth so it catches a sharp specular streak, and see-through
// enough that the contents stay readable -- which is a gameplay requirement, not just a look.
const BAG_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xeaf4ff,
  roughness: 0.08,
  metalness: 0.15,
  transparent: true,
  opacity: 0.34,
  side: THREE.DoubleSide,
  depthWrite: false,
});
// Ink outline: the bag's own edges drawn as lines, the way you would pen a box -- the four
// vertical seams plus the rings round the base and the mouth. Not a filled silhouette.
//
// Each edge becomes a ribbon turned to face the camera, because a GL line is capped at one
// pixel on most hardware and would never read as a pen stroke. DoubleSide is deliberate here
// rather than a papered-over winding bug: which way a billboarded quad faces depends on which
// side of it the camera is, so there is no fixed correct winding.
const BAG_INK = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
// Samples along each edge. The seams curve once the bag shrivels, so they need more than the
// two points a straight box edge would.
const EDGE_SAMPLES = 16;
// Cross-section corners, in order round the perimeter.
const EDGE_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
// Nudge toward the camera so the film does not z-fight the line lying on it.
const INK_LIFT = 0.003;

const UP = new THREE.Vector3(0, 1, 0);

// Silhouette shaping. The 8 particles describe a box and deform() maps every vertex through
// trilinear interpolation of it, so a vertex left at its raw (u,v,w) always lands on a flat
// wall -- which is why the bag read as a crate. Reshaping the stored uvw is enough to fix it:
// the coordinates may sit outside [0,1] (trilinear interpolation simply extrapolates there),
// and the shaped mesh still follows the particles as they stretch and flop. The physics is
// untouched; this is purely what you see.
// `t` morphs the profile: 0 is the plain box the bag is carried and packed in, 1 is the
// cinched pouch it shrivels into once the order is finished. Everything below computes the
// pouch, and t blends the result back toward the untouched unit cube.
function shapeBag(u, v, w, swell = 1, t = 1, out = []) {
  const pouchV = Math.min(v / NECK_V, 1);
  // The pouch: a full, round sack of film sagging under the contents. No flat base and no
  // straight walls -- both of those are what kept reading as a box.
  const pouch = POUCH_BASE + POUCH_SWELL * Math.sin(Math.PI * pouchV ** 0.85);
  // The cinch. Nothing narrows until well up the bag, then the film gathers hard into the neck.
  const gather = smoothstep((v - NECK_V * GATHER_START) / (NECK_V * (1 - GATHER_START)));
  let scale = pouch * (1 - 0.74 * gather);

  // Angle around the bag, used for both the ruffle and the round cross-section.
  let du = (u - 0.5) * 2;
  let dw = (w - 0.5) * 2;
  let vOut = v;

  if (v > NECK_V) {
    // The crown: loose film flaring out above the tie, gathered into vertical ruffles whose
    // tips sit at slightly different heights -- an even rim would look machined.
    const c = (v - NECK_V) / (TOP_V - NECK_V);
    const theta = Math.atan2(dw, du);
    scale = NECK_SCALE + 0.3 * c ** 0.7;
    scale *= 1 + 0.16 * c * Math.sin(RUFFLES * theta);
    vOut = v + 0.035 * c * Math.sin(RUFFLES * theta + 1.1);
  }

  // Round the cross-section almost fully to a circle. A cellophane bag has no corners at all,
  // so unlike a paper bag there are no creases worth preserving.
  const round = v > NECK_V ? 1 : 0.82 + 0.18 * Math.sin(Math.PI * pouchV);
  const cu = du * Math.sqrt(Math.max(0, 1 - (dw * dw) / 2));
  const cw = dw * Math.sqrt(Math.max(0, 1 - (du * du) / 2));
  du += (cu - du) * round;
  dw += (cw - dw) * round;

  scale *= swell;
  const px = 0.5 + du * 0.5 * scale;
  const pz = 0.5 + dw * 0.5 * scale;
  if (t >= 1) {
    out[0] = px;
    out[1] = vOut;
    out[2] = pz;
    return out;
  }
  // The box: straight walls and a flat rim. The crown lives above v=1, so clamping v folds it
  // down onto the rim and it simply vanishes rather than needing its own geometry.
  const bv = Math.min(v, 1);
  out[0] = u + (px - u) * t;
  out[1] = bv + (vOut - bv) * t;
  out[2] = w + (pz - w) * t;
  return out;
}

/**
 * Half-extents of the pouch, in metres, at height fraction `v` of BAG.height.
 *
 * The film bulges well past BAG.width/BAG.depth low down and cinches to a fraction of them
 * at the neck, so anything positioning itself against the outside of a bag (the gift tag)
 * has to ask the profile rather than assume the box. Reshaping the bag then moves those
 * things with it instead of leaving them hanging in the air.
 */
export function bagHalfExtents(v) {
  return {
    x: (shapeBag(1, v, 0.5)[0] - 0.5) * BAG.width,
    z: (shapeBag(0.5, v, 1)[2] - 0.5) * BAG.depth,
  };
}

// Heights in units of BAG.height: the neck sits high so the pouch keeps its capacity, and the
// crown is drawn above the pouch entirely (v > 1), where trilinear mapping extrapolates.
const NECK_V = 0.86;
const TOP_V = 1.08;
const NECK_SCALE = 0.26;
const RUFFLES = 7;

// The twelve edges of the bag, each a straight run in (u,v,w) that the shaping bends into
// whatever the bag currently is: four vertical seams, then the base and mouth rings.
const EDGES = (() => {
  const list = EDGE_CORNERS.map(([u, w]) => [u, 0, w, u, TOP_V, w]);
  for (const v of [0, TOP_V]) {
    for (let c = 0; c < 4; c++) {
      const [u0, w0] = EDGE_CORNERS[c];
      const [u1, w1] = EDGE_CORNERS[(c + 1) % 4];
      list.push([u0, v, w0, u1, v, w1]);
    }
  }
  return list;
})();
// Plus the two outer profiles. On the box these land on a corner seam and simply double it,
// but once the bag rounds off, its widest point is the middle of a face, not a corner -- so
// without these the finished pouch has no ink at all along the edge you actually see.
const PROFILE_STRIPS = 2;
const EDGE_STRIPS = EDGES.length + PROFILE_STRIPS;
const EDGE_POINTS = EDGE_STRIPS * (EDGE_SAMPLES + 1);
// Samples around a ring when hunting for the widest point. The profile rides the middle of a
// face on a round bag and a hard corner on a square one, so it is searched for, not assumed.
const SILHOUETTE_SAMPLES = 12;

// How fat the pouch is, as a multiple of BAG.width/BAG.depth: BASE at the foot and the neck,
// swelling to BASE + SWELL at the belly. GATHER_START is how far up the film stays full before
// it cinches.
//
// These are not free: the finished bag has nine items standing inside it, and the corner of a
// tall bottle sits further from the axis than its width alone suggests. Both numbers were
// raised together because neither works alone -- a fatter bag that still cinches at 58% leaves
// the body wash poking 36mm through the film, and a late cinch on a narrow bag is no better.
// bags.js packs the contents to match; re-check the clearance if you retune these.
const POUCH_BASE = 1.15;
const POUCH_SWELL = 0.3;
const GATHER_START = 0.72;
const smoothstep = (t) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

// Bag film whose vertices are stored as (u,v,w) around the unit cube and trilinearly
// mapped onto the 8 corner particles each frame. vFrom/vTo carve out a height band, which is
// how the rim cuff is built from the same code as the body.
function buildShell({ vFrom = 0, vTo = 1, swell = 1, floor = true } = {}) {
  const faces = floor ? [(a, b) => [a, 0, b]] : [];
  faces.push(
    (a, b) => [a, b, 0],
    (a, b) => [a, b, 1],
    (a, b) => [0, b, a],
    (a, b) => [1, b, a]
  );
  // Both poses are baked once; `uvw` is the working copy the deform reads, rewritten by
  // setShrivel as the bag changes shape. Cross-fading two arrays costs a lerp per vertex,
  // where regenerating the profile would mean re-running shapeBag on every vertex per frame.
  const box = [];
  const pouch = [];
  const index = [];
  for (const face of faces) {
    const base = box.length / 3;
    for (let b = 0; b <= SEG; b++) {
      for (let a = 0; a <= SEG; a++) {
        const [fu, fv, fw] = face(a / SEG, b / SEG);
        const v = vFrom + (vTo - vFrom) * fv;
        box.push(...shapeBag(fu, v, fw, swell, 0));
        pouch.push(...shapeBag(fu, v, fw, swell, 1));
      }
    }
    for (let b = 0; b < SEG; b++) {
      for (let a = 0; a < SEG; a++) {
        const q = base + b * (SEG + 1) + a;
        index.push(q, q + SEG + 1, q + 1, q + 1, q + SEG + 1, q + SEG + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(box.length), 3));
  geometry.setIndex(index);
  return {
    geometry,
    box: Float32Array.from(box),
    pouch: Float32Array.from(pouch),
    uvw: Float32Array.from(box),
  };
}

export function clampToRoom(p) {
  p.x = Math.min(Math.max(p.x, ROOM.minX + 0.05), ROOM.maxX - 0.05);
  p.y = Math.min(Math.max(p.y, 0.01), ROOM.height);
  p.z = Math.min(Math.max(p.z, ROOM.backZ + 0.03), ROOM.frontZ - 0.03);
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * One bag: soft mass-spring body while loose/dragged, snaps into a single static body on the table.
 * origin = bottom-centre of the spawn pose. canPlace(x) vetoes a snap (e.g. overlapping another bag).
 */
export function createBag({ world, scene, camera, origin, canPlace, onSnapStart }) {
  const shell = buildShell({ vTo: TOP_V });
  const shells = [shell];
  const geometry = shell.geometry;
  const mesh = new THREE.Mesh(geometry, BAG_MATERIAL);
  scene.add(mesh);

  // One ribbon strip per edge, rebuilt each deform so the ink follows the bag as it flexes
  // and as it morphs from box to pouch.
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EDGE_POINTS * 6), 3));
  edgeGeometry.setIndex(
    Array.from({ length: EDGE_STRIPS }, (_, e) =>
      Array.from({ length: EDGE_SAMPLES }, (__, i) => {
        const a = (e * (EDGE_SAMPLES + 1) + i) * 2;
        return [a, a + 1, a + 3, a, a + 3, a + 2];
      }).flat()
    ).flat()
  );
  const edgeMesh = new THREE.Mesh(edgeGeometry, BAG_INK);
  // The film is built in world coordinates and `mesh` is never transformed, so parenting costs
  // nothing and the ink follows the bag in and out of the scene.
  edgeMesh.frustumCulled = false;
  mesh.add(edgeMesh);

  const mapped = new THREE.Vector3();
  const shapeScratch = [0, 0, 0];
  const edgePts = Array.from({ length: EDGE_SAMPLES + 1 }, () => new THREE.Vector3());
  const edgeDir = new THREE.Vector3();
  const edgeToCam = new THREE.Vector3();
  const edgeSide = new THREE.Vector3();
  const cameraPos = new THREE.Vector3();
  const inkProbe = new THREE.Vector3();
  const inkScreen = new THREE.Vector3();

  const particles = REST.map((rest) => {
    const body = new CANNON.Body({
      mass: PARTICLE_MASS,
      shape: new CANNON.Sphere(PARTICLE_RADIUS),
      linearDamping: 0.6,
      angularDamping: 0.9,
      collisionFilterGroup: PARTICLE_GROUP,
      collisionFilterMask: 1,
      allowSleep: false,
    });
    body.position.set(origin.x + rest.x, origin.y + PARTICLE_RADIUS + 0.001 + rest.y, origin.z + rest.z);
    world.addBody(body);
    return body;
  });

  const springs = SPRING_LAYOUT.map(
    ([a, b, k]) =>
      new CANNON.Spring(particles[a], particles[b], {
        restLength: REST[a].distanceTo(REST[b]),
        stiffness: k,
        damping: SPRING_DAMPING,
      })
  );

  let state = 'soft';
  let cursor = null;
  let lift = 1;
  let liftAtSnap = 1;
  const target = new CANNON.Vec3();
  const grabOffset = new CANNON.Vec3();
  const stretch = new CANNON.Vec3();
  const pts = REST.map(() => new THREE.Vector3());
  const from = REST.map(() => new THREE.Vector3());
  const snapOrigin = new THREE.Vector3();
  const center = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const skin = Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3());
  const skinVel = Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3());
  let snapT = 0;

  function onPostStep() {
    if (cursor) {
      const h = particles[HANDLE].position;
      target.vsub(h, stretch);
      const len = stretch.length();
      if (len > MAX_STRETCH) stretch.scale(MAX_STRETCH / len, stretch);
      h.vadd(stretch, cursor.anchor.position);
      cursor.spring.applyForce();
    }
    for (const s of springs) s.applyForce();
    for (const p of particles) {
      const speed = p.velocity.length();
      if (speed > MAX_SPEED) p.velocity.scale(MAX_SPEED / speed, p.velocity);
    }
  }
  world.addEventListener('postStep', onPostStep);

  function setTarget(x, y, z) {
    target.set(x + grabOffset.x, y + grabOffset.y, z + grabOffset.z);
    clampToRoom(target);
  }

  function beginDrag(point) {
    if (state !== 'soft') return null;
    const h = particles[HANDLE].position;
    grabOffset.set(h.x - point.x, h.y - point.y, h.z - point.z);
    setTarget(point.x, point.y, point.z);
    const anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
    anchor.position.copy(h);
    cursor = {
      anchor,
      spring: new CANNON.Spring(anchor, particles[HANDLE], {
        restLength: 0,
        stiffness: TOTAL_MASS * STIFFNESS_PER_KG,
        damping: TOTAL_MASS * DAMPING_PER_KG,
      }),
    };
    return { setTarget, release };
  }

  function release() {
    if (!cursor) return;
    cursor = null;

    const c = tmp.set(0, 0, 0);
    for (let n = 0; n < 8; n++) c.add(particles[n].position);
    c.multiplyScalar(1 / 8);
    const overTable =
      Math.abs(c.x - TABLE.centerX) <= TABLE.width / 2 &&
      Math.abs(c.z - TABLE.centerZ) <= TABLE.depth / 2 &&
      c.y >= TABLE.topY - 0.02;
    if (!overTable) return;

    const mx = TABLE.width / 2 - BAG.width / 2 - WALL_T;
    const mz = TABLE.depth / 2 - BAG.depth / 2 - WALL_T;
    const x = clamp(c.x, TABLE.centerX - mx, TABLE.centerX + mx);
    // Centre the bag on the items' depth plane so every item can reach its mouth.
    const z = clamp(SHELF.centerZ, TABLE.centerZ - mz, TABLE.centerZ + mz);
    if (!canPlace(x, z)) return;

    state = 'snapping';
    liftAtSnap = lift;
    onSnapStart?.();
    world.removeEventListener('postStep', onPostStep);
    particles.forEach((p, n) => {
      from[n].copy(p.position);
      world.removeBody(p);
    });
    snapOrigin.set(x, TABLE.topY + PARTICLE_RADIUS, z);
    center.set(x, TABLE.topY, z);
    snapT = 0;
  }

  function finishPlacement() {
    state = 'placed';
    const hx = BAG.width / 2;
    const hy = BAG.height / 2;
    const hz = BAG.depth / 2;
    const t = WALL_T / 2;
    // Walls grow outward from the visible surface so fast-moving items can't tunnel into the bag.
    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    const frontBack = new CANNON.Box(new CANNON.Vec3(hx + WALL_T, hy, t));
    const sides = new CANNON.Box(new CANNON.Vec3(t, hy, hz));
    body.addShape(frontBack, new CANNON.Vec3(0, hy, hz + t - 0.005));
    body.addShape(frontBack, new CANNON.Vec3(0, hy, -(hz + t - 0.005)));
    body.addShape(sides, new CANNON.Vec3(hx + t - 0.005, hy, 0));
    body.addShape(sides, new CANNON.Vec3(-(hx + t - 0.005), hy, 0));
    body.position.set(center.x, TABLE.topY, center.z);
    world.addBody(body);
  }


  // 0 = the box it is carried and packed in, 1 = the finished pouch.
  let shrivel = 0;

  function setShrivel(t) {
    shrivel = t;
    for (const shell of shells) {
      const { uvw, box, pouch } = shell;
      for (let i = 0; i < uvw.length; i++) uvw[i] = box[i] + (pouch[i] - box[i]) * t;
    }
    // A placed bag has stopped stepping its particles, so nothing else will redraw it.
    deform();
  }

  function deform() {
    for (const shell of shells) deformShell(shell);
    updateEdges();
  }

  /** One stored (u,v,w) through the 8 particles: this is what gives the film its shape. */
  function mapUVW(u, v, w, out) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let c = 0; c < 8; c++) {
      const wt = (c & 1 ? u : 1 - u) * ((c >> 1) & 1 ? v : 1 - v) * ((c >> 2) & 1 ? w : 1 - w);
      x += wt * skin[c].x;
      y += wt * skin[c].y;
      z += wt * skin[c].z;
    }
    y -= (1 - v) * PARTICLE_RADIUS;
    if (lift !== 1) {
      const pivot = skin[HANDLE];
      x = pivot.x + (x - pivot.x) * lift;
      y = pivot.y + (y - pivot.y) * lift;
      z = pivot.z + (z - pivot.z) * lift;
    }
    return out.set(x, y, z);
  }

  function deformShell({ geometry, uvw }) {
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < uvw.length; i += 3) {
      mapUVW(uvw[i], uvw[i + 1], uvw[i + 2], mapped);
      pos[i] = mapped.x;
      pos[i + 1] = mapped.y;
      pos[i + 2] = mapped.z;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  /** The current shape's surface point at (u,v,w), honouring how far the bag has shrivelled. */
  function surfacePoint(u, v, w, out) {
    shapeBag(u, v, w, 1, shrivel, shapeScratch);
    return mapUVW(shapeScratch[0], shapeScratch[1], shapeScratch[2], out);
  }

  /**
   * Redraw the inked edges. Each edge is sampled along its length, then every point is given a
   * width across the line: perpendicular to both the edge's own direction and the direction to
   * the camera, which is what turns a 3D curve into a stroke of even weight from where you are
   * sitting. Using a fixed sideways axis instead would make an edge running toward the camera
   * -- the base ring's sides do exactly that -- collapse to nothing.
   */
  /** The point on ring `v` that lands furthest out on screen: the bag's widest point there. */
  function silhouettePoint(side, v, out) {
    let best = -Infinity;
    for (let k = 0; k <= SILHOUETTE_SAMPLES; k++) {
      surfacePoint(side, v, k / SILHOUETTE_SAMPLES, inkProbe);
      const screenX = inkScreen.copy(inkProbe).project(camera).x;
      const score = side ? screenX : -screenX;
      if (score > best) {
        best = score;
        out.copy(inkProbe);
      }
    }
    return out;
  }

  /** Turn the points in `edgePts` into one ribbon of even weight, facing the camera. */
  function writeStrip(strip) {
    const pos = edgeGeometry.attributes.position.array;
    let o = strip * (EDGE_SAMPLES + 1) * 6;
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      const at = edgePts[i];
      edgeDir.subVectors(edgePts[Math.min(EDGE_SAMPLES, i + 1)], edgePts[Math.max(0, i - 1)]);
      edgeToCam.subVectors(cameraPos, at).normalize();
      edgeSide.crossVectors(edgeDir, edgeToCam);
      // Degenerate only if the edge points straight at the camera, where any width will do.
      if (edgeSide.lengthSq() < 1e-12) edgeSide.set(1, 0, 0);
      // Half-width: INK is the pen's width, and this stroke is centred on the edge, so the
      // line comes out the same weight as the band the solid items carry.
      edgeSide.setLength(INK / 2);
      const lx = at.x + edgeToCam.x * INK_LIFT;
      const ly = at.y + edgeToCam.y * INK_LIFT;
      const lz = at.z + edgeToCam.z * INK_LIFT;
      pos[o] = lx + edgeSide.x;
      pos[o + 1] = ly + edgeSide.y;
      pos[o + 2] = lz + edgeSide.z;
      pos[o + 3] = lx - edgeSide.x;
      pos[o + 4] = ly - edgeSide.y;
      pos[o + 5] = lz - edgeSide.z;
      o += 6;
    }
  }

  function updateEdges() {
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    EDGES.forEach(([u0, v0, w0, u1, v1, w1], e) => {
      for (let i = 0; i <= EDGE_SAMPLES; i++) {
        const t = i / EDGE_SAMPLES;
        surfacePoint(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, w0 + (w1 - w0) * t, edgePts[i]);
      }
      writeStrip(e);
    });
    for (let side = 0; side < PROFILE_STRIPS; side++) {
      for (let i = 0; i <= EDGE_SAMPLES; i++) {
        silhouettePoint(side, (i / EDGE_SAMPLES) * TOP_V, edgePts[i]);
      }
      writeStrip(EDGES.length + side);
    }
    edgeGeometry.attributes.position.needsUpdate = true;
  }

  // Spring-damper the skin toward the particles, clamped so a fast throw can't tear the mesh
  // away from the body it is meant to wrap.
  function relaxSkin(dt) {
    const step = Math.min(dt, 1 / 60);
    for (let n = 0; n < PARTICLE_COUNT; n++) {
      const v = skinVel[n];
      tmp.subVectors(pts[n], skin[n]);
      v.addScaledVector(tmp, SKIN_K * step).addScaledVector(v, -SKIN_DAMP * step);
      skin[n].addScaledVector(v, step);
      tmp.subVectors(skin[n], pts[n]);
      const lag = tmp.length();
      if (lag > SKIN_MAX_LAG) skin[n].copy(pts[n]).addScaledVector(tmp, SKIN_MAX_LAG / lag);
    }
  }

  function syncSkin() {
    for (let n = 0; n < PARTICLE_COUNT; n++) {
      skin[n].copy(pts[n]);
      skinVel[n].set(0, 0, 0);
    }
  }

  function update(dt) {
    if (state === 'placed') return;
    if (state === 'soft') {
      particles.forEach((p, n) => pts[n].copy(p.position));
      lift += ((cursor ? LIFT_SCALE : 1) - lift) * Math.min(1, LIFT_RATE * dt);
      if (dt > 0) relaxSkin(dt);
      else syncSkin();
      deform();
      return;
    }
    snapT = Math.min(1, snapT + dt / SNAP_DURATION);
    const e = 1 - (1 - snapT) ** 3;
    lift = 1 - (1 - liftAtSnap) * (1 - e);
    for (let n = 0; n < PARTICLE_COUNT; n++) {
      pts[n].lerpVectors(from[n], tmp.addVectors(REST[n], snapOrigin), e);
    }
    syncSkin();
    deform();
    if (snapT === 1) finishPlacement();
  }

  update(0);

  return {
    mesh,
    center,
    beginDrag,
    update,
    setShrivel,
    get shrivel() {
      return shrivel;
    },
    get state() {
      return state;
    },
  };
}
