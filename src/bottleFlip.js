import * as CANNON from 'cannon-es';

// The three tall cylinder bottles — the only items worth flipping.
const BOTTLE_KINDS = new Set(['shampoo', 'bodyWash', 'conditioner']);

const MIN_TURN = (300 * Math.PI) / 180; // a flip is ~one full rotation; allow a little short
const MIN_AIR = 0.08; // m the bottle must drop from its peak, so a roll along a shelf can't count
const UPRIGHT_DOT = 0.94; // local +Y vs world +Y — within ~20° of standing
const STILL_SPEED = 0.08; // m/s
const STILL_SPIN = 0.6; // rad/s
const STILL_TIME = 0.35; // s held still before we judge the landing
const FLIGHT_TIMEOUT = 20; // s, so a bottle nudged into a corner doesn't watch forever

const UP = new CANNON.Vec3(0, 1, 0);

/**
 * Watches for a thrown bottle that spins a full turn and lands upright.
 *
 * Items are constrained to `angularFactor: (0,0,1)`, so all rotation is about Z and the
 * turn can be measured as a single unwrapped angle rather than a quaternion arc.
 * A flight starts when the drag controller lets go of a bottle and ends when it settles.
 */
export function createBottleFlipWatcher({ drag, items, achievements }) {
  const flights = new Map(); // body -> flight record
  const axis = new CANNON.Vec3();
  let prevHeld = null;

  function zAngle(body) {
    const q = body.quaternion;
    return 2 * Math.atan2(q.z, q.w);
  }

  function isBottle(body) {
    const item = items.find((i) => i.body === body);
    return item ? BOTTLE_KINDS.has(item.spec.kind) : false;
  }

  function isUpright(body) {
    body.quaternion.vmult(UP, axis);
    return axis.y >= UPRIGHT_DOT;
  }

  function land(body, flight) {
    flights.delete(body);
    if (flight.turned < MIN_TURN) return;
    if (flight.maxY - body.position.y < MIN_AIR) return;
    if (!isUpright(body)) return;
    achievements.unlock('bottle-flip');
  }

  function update(dt) {
    // drag.held goes null on release; that frame starts the flight.
    const held = drag.held;
    if (prevHeld && prevHeld !== held && isBottle(prevHeld)) {
      flights.set(prevHeld, {
        angle: zAngle(prevHeld),
        turned: 0,
        maxY: prevHeld.position.y,
        still: 0,
        age: 0,
      });
    }
    prevHeld = held;

    for (const [body, flight] of flights) {
      if (body === held) {
        flights.delete(body); // picked straight back up — not a landing
        continue;
      }
      flight.age += dt;
      if (flight.age > FLIGHT_TIMEOUT) {
        flights.delete(body);
        continue;
      }

      const angle = zAngle(body);
      let delta = angle - flight.angle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      flight.turned += Math.abs(delta);
      flight.angle = angle;
      flight.maxY = Math.max(flight.maxY, body.position.y);

      const settled =
        body.velocity.length() < STILL_SPEED && body.angularVelocity.length() < STILL_SPIN;
      flight.still = settled ? flight.still + dt : 0;
      if (flight.still >= STILL_TIME) land(body, flight);
    }
  }

  return { update };
}
