import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createTagGenerator } from './tagGenerator.js';
import { createTagPopup } from './tagPopup.js';
import { BAG, bagHalfExtents } from './softBodyBag.js';
import { INK, INK_MATERIAL } from './scene.js';

const TAG_W = 0.08;
const TAG_H = 0.11;
// Matches the collider, which was always 8mm thick even while the card was drawn as a plane.
const TAG_T = 0.008;
// A finished card reads as a label on the bag rather than a loose scrap, so it grows a little
// as it snaps on. The attach position and clearance below are computed at this size.
const TAG_ATTACH_SCALE = 1.25;
const TAG_MASS = 0.01;
const SNAP_DURATION = 0.25;
const SETTLE_SPEED = 0.15;
const SETTLE_TIME = 0.15;

const ARROW_STYLE = `
@keyframes tag-arrow-osc {
  0%, 100% { transform: translate(calc(-50% + 14px), -50%); }
  50% { transform: translate(calc(-50% - 14px), -50%); }
}
.tag-arrow {
  position: fixed;
  font-size: 30px;
  color: #ffcf40;
  text-shadow: 0 0 4px #000, 0 0 8px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 9999;
  display: none;
  animation: tag-arrow-osc 0.9s ease-in-out infinite;
}
`;

/**
 * Gift-tag generator + popup drawing tool + spawned tags that snap onto a completed bag.
 * `bags` is the object returned by createBagSystem (its `.list` entries gain `complete`/`tag` fields).
 */
export function createTagSystem({ world, scene, camera, domElement, drag, pickables, bags }) {
  const looseTags = [];

  const style = document.createElement('style');
  style.textContent = ARROW_STYLE;
  document.head.appendChild(style);
  const arrow = document.createElement('div');
  arrow.className = 'tag-arrow';
  arrow.textContent = '⟵';
  document.body.appendChild(arrow);

  const popup = createTagPopup({ onComplete: (canvas) => spawnTag(canvas) });

  // A tag is the last step of an order, so the maker only opens once some bag holds all nine
  // items and is still waiting for its tag.
  const tagWanted = () => bags.list.some((e) => e.complete && !e.tag);

  const gen = createTagGenerator({
    world,
    scene,
    pickables,
    onGrab: () => {
      if (tagWanted()) popup.open();
    },
  });
  const generatorPos = gen.position;

  function spawnTag(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    // A card with real thickness rather than a plane: it matches the collider (which was always
    // 8mm thick) and gives the ink border something to sit around. Box faces are ordered
    // +x, -x, +y, -y, +z, -z, so only the last two carry the drawing; the four edges are paper.
    const geometry = new THREE.BoxGeometry(TAG_W, TAG_H, TAG_T);
    const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.8 });
    const mesh = new THREE.Mesh(geometry, [edge, edge, edge, edge, face, face]);
    mesh.castShadow = true;

    // Ink border. An inverted hull would key its thickness off the card's 8mm thinnest axis and
    // come out hairline, so the card gets a plain black slab a little larger in its own plane
    // and a little thinner, leaving the drawn faces proud on both sides and the ink showing
    // only as an edge.
    const border = new THREE.Mesh(new THREE.BoxGeometry(TAG_W + 2 * INK, TAG_H + 2 * INK, TAG_T * 0.75), INK_MATERIAL);
    mesh.add(border);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.009, 0.0018, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.4, metalness: 0.6 })
    );
    ring.position.set(0, TAG_H / 2 + 0.006, 0);
    mesh.add(ring);

    const body = new CANNON.Body({
      mass: TAG_MASS,
      shape: new CANNON.Box(new CANNON.Vec3(TAG_W / 2, TAG_H / 2, 0.004)),
      linearDamping: 0.3,
      angularDamping: 0.5,
      // Same depth-plane lock as every other pickable item.
      linearFactor: new CANNON.Vec3(1, 1, 0),
      angularFactor: new CANNON.Vec3(0, 0, 1),
    });
    body.position.set(generatorPos.x, generatorPos.y + 0.15, generatorPos.z);
    world.addBody(body);

    // A plain body-backed pickable: no custom onGrab, so it rides the same drag path as any toiletry.
    mesh.userData.body = body;
    mesh.userData.label = 'Gift Tag';
    scene.add(mesh);
    pickables.push(mesh);

    const t = { mesh, body, settle: 0, state: 'loose' };
    looseTags.push(t);
    return t;
  }

  // Widest point of the pouch, and where on it the tag sits. TAG_V is low enough to be on the
  // bulge rather than the cinched neck: the tag is a flat plane, so it can only sit flush where
  // the film is roughly vertical. Up at the neck it would stick out into open air.
  const TAG_V = 0.42;
  const REACH = (() => {
    let x = 0;
    let z = 0;
    for (let i = 0; i <= 20; i++) {
      const e = bagHalfExtents(i / 20);
      x = Math.max(x, e.x);
      z = Math.max(z, e.z);
    }
    return { x, z };
  })();

  // `center` is the bag's base, on the table top. The window covers the pouch's whole height
  // plus a little below it, so a tag that slides down the film and comes to rest on the table
  // against the bag counts as much as one dropped onto the crown. It used to be anchored on
  // the rim — which is why reshaping the bag taller (0.24m -> 0.36m) silently lifted the whole
  // window above where a dropped tag can actually settle, and tags stopped attaching.
  function findAttachTarget(pos) {
    for (const entry of bags.list) {
      if (!entry.complete || entry.tag) continue;
      const c = entry.bag.center;
      if (
        Math.abs(pos.x - c.x) < REACH.x + 0.06 &&
        Math.abs(pos.z - c.z) < REACH.z + 0.15 &&
        pos.y > c.y - 0.06 &&
        pos.y < c.y + BAG.height + BAG.handleHeight + 0.1
      ) {
        return entry;
      }
    }
    return null;
  }

  /** Z offset that puts the tag just proud of the film over the whole of its own height. */
  function tagFrontZ() {
    const span = (TAG_H * TAG_ATTACH_SCALE) / BAG.height; // the card is bigger once attached
    let z = 0;
    for (let i = 0; i <= 8; i++) {
      z = Math.max(z, bagHalfExtents(TAG_V + (i / 8 - 0.5) * span).z);
    }
    return z + 0.006 + (TAG_T * TAG_ATTACH_SCALE) / 2;
  }

  const projected = new THREE.Vector3();
  const lerpPos = new THREE.Vector3();

  function update(dt) {
    // Arrow: point at the tag generator whenever some completed bag still has no tag.
    const needsTag = tagWanted();
    gen.group.userData.label = needsTag ? 'Tag Maker' : 'Tag Maker (fill a bag first)';
    if (needsTag) {
      const rect = domElement.getBoundingClientRect();
      projected.set(generatorPos.x + 0.18, generatorPos.y + 0.12, generatorPos.z).project(camera);
      arrow.style.left = ((projected.x + 1) / 2) * rect.width + rect.left + 'px';
      arrow.style.top = ((1 - projected.y) / 2) * rect.height + rect.top + 'px';
      arrow.style.display = 'block';
    } else {
      arrow.style.display = 'none';
    }

    for (let i = looseTags.length - 1; i >= 0; i--) {
      const t = looseTags[i];

      if (t.state === 'attaching') {
        t.snapT = Math.min(1, t.snapT + dt / SNAP_DURATION);
        const e = 1 - (1 - t.snapT) ** 3;
        t.mesh.position.lerpVectors(t.fromPos, t.toPos, e);
        t.mesh.quaternion.slerpQuaternions(t.fromQuat, t.toQuat, e);
        t.mesh.scale.setScalar(1 + (TAG_ATTACH_SCALE - 1) * e);
        if (t.snapT >= 1) {
          t.state = 'attached';
          t.entry.tag = t;
        }
        continue;
      }
      if (t.state === 'attached') continue;

      // Loose: follow physics unless currently held.
      t.mesh.position.copy(t.body.position);
      t.mesh.quaternion.copy(t.body.quaternion);
      if (drag.held === t.body) {
        t.settle = 0;
        continue;
      }

      const target = findAttachTarget(t.body.position);
      t.settle = target && t.body.velocity.length() < SETTLE_SPEED ? t.settle + dt : 0;
      if (target && t.settle >= SETTLE_TIME) beginAttach(t, target);
    }
  }

  /** Start a loose tag flying onto a complete bag's front. */
  function beginAttach(t, target) {
    const c = target.bag.center;
    t.fromPos = t.mesh.position.clone();
    t.fromQuat = t.mesh.quaternion.clone();
    t.toPos = lerpPos.set(c.x, c.y + TAG_V * BAG.height, c.z + tagFrontZ()).clone();
    t.toQuat = new THREE.Quaternion();
    t.entry = target;
    t.state = 'attaching';
    t.snapT = 0;
    world.removeBody(t.body);
    pickables.splice(pickables.indexOf(t.mesh), 1);
  }

  /** Make a tag from `canvas` and send it straight onto `entry`, skipping the drag. */
  function attachNew(entry, canvas) {
    const t = spawnTag(canvas);
    t.mesh.position.copy(t.body.position);
    beginAttach(t, entry);
  }

  /** Remove an attached tag for good, once its bag has been carried away. */
  function disposeTag(t) {
    const i = looseTags.indexOf(t);
    if (i !== -1) looseTags.splice(i, 1);
    t.mesh.removeFromParent();
    const [edge, , , , face] = t.mesh.material;
    face.map.dispose();
    face.dispose();
    edge.dispose();
    t.mesh.traverse((o) => o.geometry.dispose());
    // The border shares the scene-wide ink material; only the ring's is the tag's own.
    for (const child of t.mesh.children) if (child.material !== INK_MATERIAL) child.material.dispose();
  }

  return { update, disposeTag, attachNew, generator: gen.group };
}
