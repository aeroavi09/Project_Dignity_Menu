import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clampToRoom } from './softBodyBag.js';
import { INK, OUTLINE_MATERIAL } from './scene.js';

// A washrag is a chain of particles along X. Items are locked to one depth plane, so the cloth
// only folds in the X/Y plane; its depth is purely visual (extruded along Z).
const PARTICLES = 6;
const RADIUS = 0.014;
const BEND_K = 2.5;
const BEND_DAMPING = 0.05;
const THICKNESS = 0.024;
const SAMPLES = 16;
export const RAG_GROUP = 8;

// Cursor spring mirrors drag.js tuning and safety limits.
const STIFFNESS_PER_KG = 300;
const DAMPING_PER_KG = 15.5;
const MAX_STRETCH = 0.5;
const MAX_SPEED = 4;

// Triangles are wound so their normals face *out* of the ribbon. That was invisible while
// the rag was the only thing drawn from this index — it is MeshStandardMaterial/DoubleSide,
// which shades a back face off the flipped normal and looks fine either way — but the ink
// shell below is BackSide, so a reversed winding would draw the shell's near face over the
// rag and paint it solid black.
function buildRibbonIndex() {
  const index = [];
  for (let j = 0; j < SAMPLES; j++) {
    for (let s = 0; s < 4; s++) {
      const a = j * 4 + s;
      const b = j * 4 + ((s + 1) % 4);
      index.push(a, b + 4, b, a, a + 4, b + 4);
    }
  }
  const last = SAMPLES * 4;
  index.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2);
  return index;
}

/** One cross-section of the ribbon: a rectangle `h` by `d`, `along` metres down the tangent. */
function writeRing(array, o, point, tangent, h, d, along = 0) {
  const nx = -tangent.y * h;
  const ny = tangent.x * h;
  const cx = point.x + tangent.x * along;
  const cy = point.y + tangent.y * along;
  array.set([cx + nx, cy + ny, point.z + d], o);
  array.set([cx + nx, cy + ny, point.z - d], o + 3);
  array.set([cx - nx, cy - ny, point.z - d], o + 6);
  array.set([cx - nx, cy - ny, point.z + d], o + 9);
}

/** Soft washrag. `body` is a read-only proxy (centroid position/velocity) for containment checks. */
export function createSoftRag({ world, scene, item }) {
  const [width, height, depth] = item.size;
  const spacing = width / (PARTICLES - 1);

  function particleRestPosition(i, out) {
    return out.set(
      item.pos[0] - width / 2 + i * spacing,
      item.pos[1] - height / 2 + RADIUS + 0.001,
      item.pos[2]
    );
  }

  const particles = Array.from({ length: PARTICLES }, (_, i) => {
    const p = new CANNON.Body({
      mass: item.mass / PARTICLES,
      shape: new CANNON.Sphere(RADIUS),
      linearDamping: 0.4,
      linearFactor: new CANNON.Vec3(1, 1, 0),
      angularFactor: new CANNON.Vec3(0, 0, 0), // slide with friction instead of rolling like beads
      collisionFilterGroup: RAG_GROUP,
      allowSleep: false,
    });
    world.addBody(p);
    return p;
  });
  particles.forEach((p, i) => particleRestPosition(i, p.position));

  const links = [];
  for (let i = 0; i < PARTICLES - 1; i++) {
    const link = new CANNON.DistanceConstraint(particles[i], particles[i + 1], spacing);
    links.push(link);
    world.addConstraint(link);
  }
  const bends = [];
  for (let i = 0; i < PARTICLES - 2; i++) {
    bends.push(
      new CANNON.Spring(particles[i], particles[i + 2], { restLength: 2 * spacing, stiffness: BEND_K, damping: BEND_DAMPING })
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SAMPLES + 1) * 12), 3));
  geometry.setIndex(buildRibbonIndex());
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.95, side: THREE.DoubleSide })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Ink outline. The rigid items get a scaled copy of their geometry (see scene.js), but the
  // rag's shape is regenerated every frame, so instead of scaling it we re-sweep the same
  // curve with a cross-section `ink` wider on each side. Same clamp as scene.js: the line may
  // not exceed a tenth of the rag's narrowest dimension.
  const ink = Math.min(INK, 0.1 * Math.min(THICKNESS, depth));
  const shellGeometry = new THREE.BufferGeometry();
  shellGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SAMPLES + 1) * 12), 3));
  shellGeometry.setIndex(buildRibbonIndex());
  const shell = new THREE.Mesh(shellGeometry, OUTLINE_MATERIAL);
  // The ribbon is built in world coordinates and `mesh` is never transformed, so parenting the
  // shell to it costs nothing and gets it removed from the scene alongside the rag.
  shell.frustumCulled = false;
  mesh.add(shell);

  const controlPoints = particles.map(() => new THREE.Vector3());
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  const body = { position: new CANNON.Vec3(), velocity: new CANNON.Vec3() };
  let cursor = null;
  const target = new CANNON.Vec3();
  const grabOffset = new CANNON.Vec3();
  const stretch = new CANNON.Vec3();

  function onPostStep() {
    if (cursor) {
      const p = cursor.particle.position;
      target.vsub(p, stretch);
      const len = stretch.length();
      if (len > MAX_STRETCH) stretch.scale(MAX_STRETCH / len, stretch);
      p.vadd(stretch, cursor.anchor.position);
      cursor.spring.applyForce();
    }
    for (const s of bends) s.applyForce();
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

  function release() {
    cursor = null;
  }

  /** Drop the rag flat back on its spawn slot. */
  function reset() {
    cursor = null;
    particles.forEach((p, i) => {
      particleRestPosition(i, p.position);
      p.velocity.setZero();
      p.angularVelocity.setZero();
      p.wakeUp();
    });
  }

  /** Shove the whole rag, used when a sealed bag spits it back out. */
  function push(vx, vy) {
    for (const p of particles) {
      p.velocity.set(vx, vy, 0);
      p.wakeUp();
    }
  }

  /**
   * Fold the rag out flat, centred on (x, y, z). `blend` is absolute progress 0..1: each call
   * moves the particles that fraction of the remaining distance, so driving it from 0 to 1
   * over several frames eases the cloth into place and lands exactly on target at 1.
   */
  function placeAt(x, y, z, blend = 1) {
    cursor = null;
    particles.forEach((p, i) => {
      p.position.x += (x - width / 2 + i * spacing - p.position.x) * blend;
      p.position.y += (y - p.position.y) * blend;
      p.position.z += (z - p.position.z) * blend;
      p.velocity.setZero();
      p.angularVelocity.setZero();
    });
  }

  /** Pin the rag where it lies — used once it has settled inside a bag. */
  function lock() {
    cursor = null;
    for (const p of particles) {
      p.type = CANNON.Body.STATIC;
      p.velocity.setZero();
      p.angularVelocity.setZero();
      p.updateMassProperties();
    }
  }

  /** Take the rag out of the simulation but leave its mesh as-is, frozen in its last shape. */
  function detach() {
    cursor = null;
    world.removeEventListener('postStep', onPostStep);
    for (const link of links) world.removeConstraint(link);
    for (const p of particles) world.removeBody(p);
  }

  function dispose() {
    detach();
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.material.dispose();
    shellGeometry.dispose(); // the outline material is shared scene-wide, so it is not disposed
  }

  function beginDrag(hit) {
    let nearest = particles[0];
    for (const p of particles) {
      if (p.position.distanceSquared(hit) < nearest.position.distanceSquared(hit)) nearest = p;
    }
    grabOffset.set(nearest.position.x - hit.x, nearest.position.y - hit.y, nearest.position.z - hit.z);
    setTarget(hit.x, hit.y, hit.z);
    const anchor = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
    anchor.position.copy(nearest.position);
    cursor = {
      particle: nearest,
      anchor,
      spring: new CANNON.Spring(anchor, nearest, {
        restLength: 0,
        stiffness: item.mass * STIFFNESS_PER_KG,
        damping: item.mass * DAMPING_PER_KG,
      }),
    };
    return { setTarget, release };
  }
  mesh.userData.onGrab = beginDrag;

  function update() {
    body.position.set(0, 0, 0);
    body.velocity.set(0, 0, 0);
    particles.forEach((p, i) => {
      controlPoints[i].copy(p.position);
      body.position.vadd(p.position, body.position);
      body.velocity.vadd(p.velocity, body.velocity);
    });
    body.position.scale(1 / PARTICLES, body.position);
    body.velocity.scale(1 / PARTICLES, body.velocity);

    const pos = geometry.attributes.position.array;
    const shellPos = shellGeometry.attributes.position.array;
    const h = THICKNESS / 2;
    const d = depth / 2;
    for (let j = 0; j <= SAMPLES; j++) {
      const t = j / SAMPLES;
      curve.getPoint(t, point);
      curve.getTangent(t, tangent);
      tangent.z = 0;
      tangent.normalize();
      const o = j * 12;
      writeRing(pos, o, point, tangent, h, d);
      // Widening the cross-section alone would leave the rag's two short edges bare, so the
      // shell's end rings also step `ink` off the ends of the curve.
      const overhang = j === 0 ? -ink : j === SAMPLES ? ink : 0;
      writeRing(shellPos, o, point, tangent, h + ink, d + ink, overhang);
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    // The shell is unlit and never culled, so it needs neither normals nor a bounding sphere.
    shellGeometry.attributes.position.needsUpdate = true;
  }
  update();

  return {
    mesh,
    body,
    update,
    reset,
    push,
    lock,
    placeAt,
    detach,
    dispose,
    get held() {
      return cursor !== null;
    },
  };
}
