const THROW_SPEED = 1.2; // m/s at release — a lob, not a gentle lowering
const RIM_MARGIN = 0.06; // m of slack so clipping the bag's rim on the way in still counts
const WINDOW = 6; // s from release to settling, after which it wasn't one motion

/**
 * Watches for an item thrown clean into a bag: released with real pace, touching nothing
 * outside the bag on the way, and settling into it as one continuous motion.
 *
 * Purity is judged from cannon's `collide` events rather than per-frame sampling, because
 * a contact resolves inside `world.step()` — by the time a frame ends, a bounce off the
 * shelf has already happened and been smoothed away. Each collision is tested against the
 * bag volume at that instant, so hitting the bag's own floor is fine while hitting
 * anything outside it is a foul.
 */
export function createThrowInWatcher({ drag, items, bags, achievements }) {
  const throws = new Map(); // item -> { age, foul, onCollide }
  let prevHeld = null;

  function stop(item, record) {
    item.body.removeEventListener('collide', record.onCollide);
    throws.delete(item);
  }

  function consider(item) {
    if (throws.has(item)) return;
    // Rags are a particle chain with an averaged proxy body — no contacts to listen to.
    if (typeof item.body.addEventListener !== 'function') return;
    if (item.body.velocity.length() < THROW_SPEED) return;
    if (bags.bagAt(item.body)) return; // let go while already over the bag: not a throw

    const record = { age: 0, foul: false };
    record.onCollide = () => {
      if (!bags.bagAt(item.body, RIM_MARGIN)) record.foul = true;
    };
    item.body.addEventListener('collide', record.onCollide);
    throws.set(item, record);
  }

  function update(dt) {
    const held = drag.held;
    if (prevHeld && prevHeld !== held) {
      const item = items.find((i) => i.body === prevHeld);
      if (item) consider(item);
    }
    prevHeld = held;

    for (const [item, record] of throws) {
      record.age += dt;
      if (record.foul || record.age > WINDOW || drag.held === item.body) {
        stop(item, record);
        continue;
      }
      if (bags.holds(item)) {
        stop(item, record);
        achievements.unlock('nothing-but-net');
      }
    }
  }

  return { update };
}
