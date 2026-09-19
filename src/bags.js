import * as THREE from 'three';
import { BAG, createBag } from './softBodyBag.js';
import { createBagGenerator } from './bagGenerator.js';
import { createWorldLabel } from './hoverLabel.js';

const SETTLE_SPEED = 0.2;
const SETTLE_TIME = 0.2;
// Items share one depth plane, so a full bag piles up; count items poking a little out of the mouth.
const MOUTH_TOLERANCE = 0.08;
const MIN_BAG_GAP = BAG.width + 0.07;
// A bag holding one of every item is sealed: its contents are locked in, and anything
// else lowered into it is spat back out rather than counted.
const EJECT_UP = 1.3; // m/s
const EJECT_SIDE = 0.9; // m/s

const CHECK_CSS = `
  background: #22a447;
  border-color: #fff;
  border-width: 2px;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  padding: 4px;
  font-size: 20px;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
`;

/** Bag generator + all spawned bags, containment tracking and per-bag completion checkmarks. */
export function createBagSystem({ world, scene, camera, domElement, drag, pickables, items }) {
  const bags = [];
  const required = new Set(items.map((i) => i.label));
  const checkPos = new THREE.Vector3();

  function canPlace(x) {
    return bags.every(({ bag }) => bag.state === 'soft' || Math.abs(bag.center.x - x) >= MIN_BAG_GAP);
  }

  function spawnBag(origin) {
    const bag = createBag({
      world,
      scene,
      origin,
      canPlace,
      onSnapStart: () => pickables.splice(pickables.indexOf(bag.mesh), 1),
    });
    bag.mesh.userData.label = 'Plastic Bag';
    bag.mesh.userData.onGrab = (point) => bag.beginDrag(point);
    pickables.push(bag.mesh);
    bags.push({
      bag,
      contained: new Set(),
      settle: new Map(),
      checkmark: createWorldLabel(camera, domElement, '✓', CHECK_CSS),
      complete: false,
      sealed: false,
      tag: null, // set by tags.js once a gift tag has snapped onto this bag
    });
    return bag;
  }

  createBagGenerator({
    world,
    scene,
    pickables,
    onGrab: (point, origin) => spawnBag(origin).beginDrag(point),
  });

  function isInside(body, c, margin = 0) {
    const p = body.position;
    return (
      Math.abs(p.x - c.x) < BAG.width / 2 + margin &&
      Math.abs(p.z - c.z) < BAG.depth / 2 + margin &&
      p.y > c.y - margin &&
      p.y < c.y + BAG.height + MOUTH_TOLERANCE + margin
    );
  }

  function trackContents(entry, dt) {
    const c = entry.bag.center;
    for (const item of items) {
      if (!isInside(item.body, c) || drag.held === item.body || item.isHeld?.()) {
        // Still reversible: an incomplete bag lets you lift a mistake back out.
        entry.contained.delete(item);
        entry.settle.delete(item);
        continue;
      }
      if (entry.contained.has(item)) continue;
      const t = item.body.velocity.length() < SETTLE_SPEED ? (entry.settle.get(item) ?? 0) + dt : 0;
      entry.settle.set(item, t);
      if (t >= SETTLE_TIME) entry.contained.add(item);
    }
    const labels = new Set([...entry.contained].map((i) => i.label));
    return [...required].every((l) => labels.has(l));
  }

  /** Sealed bags reject latecomers: pop anything that isn't part of the set back out. */
  function ejectIntruders(entry) {
    const c = entry.bag.center;
    for (const item of items) {
      if (entry.contained.has(item) || drag.held === item.body || item.isHeld?.()) continue;
      if (!isInside(item.body, c)) continue;
      item.push(item.body.position.x >= c.x ? EJECT_SIDE : -EJECT_SIDE, EJECT_UP);
    }
  }

  function update(dt) {
    for (const entry of bags) {
      entry.bag.update(dt);
      if (entry.bag.state !== 'placed') continue;
      if (entry.sealed) {
        ejectIntruders(entry);
      } else if (trackContents(entry, dt)) {
        // Completing the set is the commit point: only now are the contents pinned
        // in place and made un-grabbable, so everything up to here stays fixable.
        entry.complete = true;
        entry.sealed = true;
        for (const item of entry.contained) item.lock();
      }
      const c = entry.bag.center;
      entry.checkmark.update(checkPos.set(c.x, c.y + BAG.height + BAG.handleHeight + 0.08, c.z), entry.complete);
    }
  }

  /**
   * The placed bag whose volume currently holds `body`, or null. `margin` widens the
   * box so a throw that clips the rim on its way in still counts as "at the bag".
   */
  function bagAt(body, margin = 0) {
    return (
      bags.find((entry) => entry.bag.state === 'placed' && isInside(body, entry.bag.center, margin)) ??
      null
    );
  }

  /** True once an item has settled inside any bag — restocking leaves those alone. */
  function holds(item) {
    return bags.some((entry) => entry.contained.has(item));
  }

  /** Drop a removed item from every bag's bookkeeping. */
  function forget(item) {
    for (const entry of bags) {
      entry.contained.delete(item);
      entry.settle.delete(item);
    }
  }

  return {
    update,
    holds,
    forget,
    bagAt,
    get list() {
      return bags;
    },
  };
}
