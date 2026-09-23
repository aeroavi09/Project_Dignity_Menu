import * as THREE from 'three';
import { BAG, bagHalfExtents, createBag } from './softBodyBag.js';
import { createBagGenerator } from './bagGenerator.js';
import { createWorldLabel } from './hoverLabel.js';
import { TABLE } from './layout.js';

const SETTLE_SPEED = 0.2;
const SETTLE_TIME = 0.2;
// Items share one depth plane, so a full bag piles up; count items poking a little out of the mouth.
const MOUTH_TOLERANCE = 0.08;
// The pouch bulges well past BAG.width at its belly, so spacing bags by the nominal width
// lets two of them visually overlap even though their colliders clear. Measure the widest
// point off the profile rather than carrying a hand-tuned margin that goes stale the next
// time the bag is reshaped.
const MIN_BAG_GAP = (() => {
  let widest = 0;
  for (let i = 0; i <= 20; i++) widest = Math.max(widest, bagHalfExtents(i / 20).x);
  return 2 * widest + 0.04;
})();
// A bag holding one of every item is sealed: its contents are locked in, and anything
// else lowered into it is spat back out rather than counted.
const EJECT_UP = 1.3; // m/s
const EJECT_SIDE = 0.9; // m/s
// The placed bag's walls sit a touch inside BAG.depth, plus a little slack so an item that
// only just fits isn't scraping both walls on the way down.
const WALL_CLEARANCE = 0.02;

// Finishing a bag: the film gathers into its pouch shape while the contents stand themselves
// up inside it. One animation, so the bag looks like it is drawing the order together.
const FINISH_DURATION = 0.8;
const ROW_GAP = 0.008;
// Pack the rows just inside the bag's nominal width. The film is a rounded cross-section, so
// an item's corner sits further from the axis than its edge does; holding the contents off
// the walls is what buys that diagonal its clearance.
const PACK_INSET = 0.92;
// The folded washrag is the base layer; everything else stands on top of it.
const RAG_FOLD_T = 0.026;
const UPRIGHT = new THREE.Quaternion();
const TIPPED = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

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
export function createBagSystem({ world, scene, camera, domElement, drag, pickables, items, onFinish }) {
  const bags = [];
  const required = new Set(items.map((i) => i.label));
  const checkPos = new THREE.Vector3();

  // Every item has to physically fit through the bag. Items are Z-locked and can only spin in
  // the X/Y plane, so their Z extent is fixed however the player turns them: anything deeper
  // than the bag's interior straddles the front and back walls and can never be packed. This
  // is the cheapest check that a bag or item resize is safe, and it has bitten once already --
  // shrinking the bag to 170mm silently stranded the 209mm toothbrush set.
  for (const item of items) {
    const depth = item.spec.shape === 'cylinder' ? item.spec.radius * 2 : item.spec.size[2];
    if (depth > BAG.depth - WALL_CLEARANCE) {
      throw new Error(
        `${item.label} is ${(depth * 1000).toFixed(0)}mm deep and cannot fit a ${(BAG.depth * 1000).toFixed(0)}mm bag`
      );
    }
  }

  function canPlace(x) {
    return bags.every(({ bag }) => bag.state === 'soft' || Math.abs(bag.center.x - x) >= MIN_BAG_GAP);
  }

  function spawnBag(origin) {
    const bag = createBag({
      world,
      scene,
      camera, // the inked edges are billboarded, so they need to know where you are looking from
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
      finish: null, // in-flight shrivel + tidy animation, see planTidy
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
      // One of each: a second copy of something the bag already counts is spat back out.
      if ([...entry.contained].some((other) => other.label === item.label)) {
        entry.settle.delete(item);
        eject(item, c);
        continue;
      }
      const t = item.body.velocity.length() < SETTLE_SPEED ? (entry.settle.get(item) ?? 0) + dt : 0;
      entry.settle.set(item, t);
      if (t >= SETTLE_TIME) entry.contained.add(item);
    }
    const labels = new Set([...entry.contained].map((i) => i.label));
    return [...required].every((l) => labels.has(l));
  }

  /**
   * Footprint and height of an item once it is stood upright, plus the rotation that gets it
   * there. Bottles, jars and sticks are modelled standing already; the toothbrush set lies
   * along Z, so tipping it a quarter turn about X stands it on its tail and swaps which of
   * its dimensions is the height.
   */
  function standingSize(spec) {
    if (spec.shape === 'cylinder') {
      return { x: spec.radius * 2, z: spec.radius * 2, y: spec.height, quat: UPRIGHT };
    }
    const [sx, sy, sz] = spec.size;
    if (spec.shape === 'compound') return { x: sx, z: sy, y: sz, quat: TIPPED };
    return { x: sx, z: sz, y: sy, quat: UPRIGHT };
  }

  /**
   * Lay out the finished bag's contents: everything upright, tallest along the back so the
   * short items in front don't hide them, and all of it standing on the folded washrag.
   *
   * Two rows because a single one doesn't fit -- the eight rigid items are about 486mm stood
   * side by side and the bag is ~300mm across. They are static by this point, so placing them
   * off the shared Z plane is safe; nothing simulates them any more.
   */
  function planTidy(entry) {
    const c = entry.bag.center;
    const rag = [...entry.contained].find((i) => i.spec.kind === 'washrag');
    const standing = [...entry.contained]
      .filter((i) => i !== rag)
      .map((handle) => ({ handle, size: standingSize(handle.spec) }))
      .sort((a, b) => b.size.y - a.size.y);

    const rows = [standing.slice(0, Math.ceil(standing.length / 2)), standing.slice(Math.ceil(standing.length / 2))];
    const rowDepth = rows.map((row) => Math.max(0, ...row.map((e) => e.size.z)));
    const totalDepth = rowDepth[0] + ROW_GAP + rowDepth[1];
    const floorY = c.y + RAG_FOLD_T;

    const targets = [];
    let z = c.z - totalDepth / 2;
    rows.forEach((row, i) => {
      const rowZ = z + rowDepth[i] / 2;
      z += rowDepth[i] + ROW_GAP;
      // Same equal-gaps packing the shelves use, so a row always reads as deliberate.
      const used = row.reduce((sum, e) => sum + e.size.x, 0);
      const packWidth = BAG.width * PACK_INSET;
      const gap = (packWidth - used) / (row.length + 1);
      let x = c.x - packWidth / 2 + gap;
      for (const { handle, size } of row) {
        targets.push({ handle, quat: size.quat, pos: new THREE.Vector3(x + size.x / 2, floorY + size.y / 2, rowZ) });
        x += size.x + gap;
      }
    });

    if (rag) targets.push({ handle: rag, quat: UPRIGHT, pos: new THREE.Vector3(c.x, c.y + RAG_FOLD_T / 2, c.z) });
    return { t: 0, targets };
  }

  /** Sealed bags reject latecomers: pop anything that isn't part of the set back out. */
  function ejectIntruders(entry) {
    const c = entry.bag.center;
    for (const item of items) {
      if (entry.contained.has(item) || drag.held === item.body || item.isHeld?.()) continue;
      if (!isInside(item.body, c)) continue;
      eject(item, c);
    }
  }

  /** Pop an item up and out over whichever side of the bag it is nearer. */
  function eject(item, c) {
    item.push(item.body.position.x >= c.x ? EJECT_SIDE : -EJECT_SIDE, EJECT_UP);
  }

  function update(dt) {
    for (const entry of bags) {
      entry.bag.update(dt);
      if (entry.bag.state !== 'placed') continue;
      // The order is done once the set is complete *and* the gift tag is on: that is when the
      // bag gathers itself into a pouch and the contents stand up inside it. Up to here it is
      // a plain box, which is what makes it packable in the first place.
      if (entry.complete && entry.tag && !entry.finish && entry.bag.shrivel === 0) {
        entry.finish = planTidy(entry);
      }
      if (entry.finish) {
        const f = entry.finish;
        f.t = Math.min(1, f.t + dt / FINISH_DURATION);
        const e = 1 - (1 - f.t) ** 3;
        entry.bag.setShrivel(e);
        for (const { handle, pos, quat } of f.targets) handle.placeAt(pos, quat, e);
        if (f.t >= 1) {
          entry.finish = null;
          onFinish?.(entry);
        }
      }

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

  /**
   * Send every stray bag back to the stack: any bag that was dropped somewhere other than
   * the table (the floor, a shelf) is still soft and never placed. The one in hand is left
   * alone, and placed bags are permanent.
   */
  function clearStrays() {
    for (let i = bags.length - 1; i >= 0; i--) {
      const { bag, checkmark } = bags[i];
      if (bag.state !== 'soft' || bag.held) continue;
      bag.dispose();
      checkmark.dispose();
      const p = pickables.indexOf(bag.mesh);
      if (p !== -1) pickables.splice(p, 1);
      bags.splice(i, 1);
    }
  }

  /**
   * Debug shortcut: drop a bag on the first free spot of the table and seal one free copy of
   * every item into it, as if the player had packed it. The items are locked where they
   * stand; the finish tidy flies them into the pouch once a tag goes on. Returns the entry,
   * or null if the table is full or some item has no free copy (restock first).
   */
  function autoPack() {
    const picked = new Map();
    for (const item of items) {
      if (picked.has(item.label) || holds(item) || drag.held === item.body || item.isHeld?.()) continue;
      picked.set(item.label, item);
    }
    if ([...required].some((label) => !picked.has(label))) return null;

    const reach = TABLE.width / 2 - BAG.width / 2 - 0.02;
    let x = null;
    for (let i = 0; i <= 24 && x === null; i++) {
      const candidate = TABLE.centerX - reach + (2 * reach * i) / 24;
      if (canPlace(candidate)) x = candidate;
    }
    if (x === null) return null;

    const origin = new THREE.Vector3(x, TABLE.topY + 0.02, TABLE.centerZ);
    const bag = spawnBag(origin);
    bag.beginDrag(origin).release();
    const entry = bags.find((e) => e.bag === bag);
    if (bag.state === 'soft') {
      // release() declined the spot after all: put the bag back rather than leave a stray.
      bag.dispose();
      entry.checkmark.dispose();
      pickables.splice(pickables.indexOf(bag.mesh), 1);
      bags.splice(bags.indexOf(entry), 1);
      return null;
    }
    for (const item of picked.values()) {
      item.lock();
      entry.contained.add(item);
    }
    entry.complete = true;
    entry.sealed = true;
    return entry;
  }

  /** True once a bag is complete, tagged, and has finished shrivelling into its pouch. */
  function isFinished(entry) {
    return entry.complete && entry.tag && !entry.finish && entry.bag.shrivel === 1;
  }

  /**
   * Take a finished bag off the table for good. Its collider, checkmark and bookkeeping go now,
   * freeing its spot on the table; its meshes are left for the caller (whoever is carrying it
   * off), who disposes the bag with `entry.bag.dispose()` once it is out of sight.
   */
  function takeAway(entry) {
    entry.bag.releaseBody();
    entry.checkmark.dispose();
    bags.splice(bags.indexOf(entry), 1);
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
    clearStrays,
    bagAt,
    isFinished,
    takeAway,
    autoPack,
    get list() {
      return bags;
    },
  };
}
