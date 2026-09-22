import * as CANNON from 'cannon-es';
import { buildItems } from './layout.js';
import { createPhysics, FIXED_DT, MAX_SUBSTEPS } from './physics.js';
import { createDragController } from './drag.js';
import { createScene, addStaticMeshes, createItemMesh } from './scene.js';
import { createInteraction } from './interaction.js';
import { createBubbleTransition } from './bubbles.js';
import { createHoverLabel } from './hoverLabel.js';
import { createBagSystem } from './bags.js';
import { createSoftRag } from './softRag.js';
import { showTitle } from './title.js';
import { createTagSystem } from './tags.js';
import { createRestockButton } from './restock.js';
import { createAchievements } from './achievements.js';
import { createBottleFlipWatcher } from './bottleFlip.js';
import { createThrowInWatcher } from './throwIn.js';

const labelNameMap = {
  shampoo: 'Shampoo',
  bodyWash: 'Body Wash',
  conditioner: 'Hair Conditioner',
  wipes: 'Hand Wipes',
  soap: 'Soap',
  toothbrushSet: 'Toothbrush & Toothpaste',
  washrag: 'Washrag',
  deodorant: 'Deodorant',
  lipBalm: 'Lip Balm',
};

const container = document.getElementById('app');
const { renderer, scene, camera } = createScene(container);
const { world, staticParts, createItemBody } = createPhysics();

addStaticMeshes(scene, staticParts);

const pairs = [];
const rags = [];
const trackedItems = [];
const pickables = [];

function drop(list, entry) {
  const i = list.indexOf(entry);
  if (i !== -1) list.splice(i, 1);
}

/**
 * Build one item from its layout spec and wire it into every list that tracks items.
 * Called for the initial shelf contents and again by the restock button whenever a
 * slot needs a replacement, so it has to be safe to run mid-game.
 */
function spawnItem(spec) {
  const label = labelNameMap[spec.kind];

  if (spec.kind === 'washrag') {
    const rag = createSoftRag({ world, scene, item: spec });
    rag.mesh.userData.label = label;
    rags.push(rag);
    pickables.push(rag.mesh);
    const handle = {
      spec,
      label,
      body: rag.body,
      isHeld: () => rag.held,
      push: (vx, vy) => rag.push(vx, vy),
      reset: () => rag.reset(),
      // `blend` is absolute progress 0..1; see softRag.placeAt. The rag ignores the target
      // rotation -- a six-particle cloth has no orientation to set, it just lies flat.
      placeAt: (pos, _quat, blend) => rag.placeAt(pos.x, pos.y, pos.z, blend),
      lock: () => {
        rag.lock();
        rag.mesh.userData.locked = true;
      },
      destroy: () => {
        rag.dispose();
        drop(rags, rag);
        drop(pickables, rag.mesh);
      },
    };
    trackedItems.push(handle);
    return handle;
  }

  const body = createItemBody(spec);
  const mesh = createItemMesh(spec);
  mesh.userData.body = body;
  mesh.userData.label = label;
  scene.add(mesh);
  const pair = { body, mesh };
  pairs.push(pair);
  pickables.push(mesh);

  const handle = {
    spec,
    label,
    body,
    push: (vx, vy) => {
      body.velocity.set(vx, vy, 0);
      body.wakeUp();
    },
    // Ease this item toward a pose. Used by the tidy-up when a bag is finished, which runs
    // after lock() has made the body static -- moving a static body is just a teleport, so
    // nothing here has to fight the solver.
    placeAt: (pos, quat, blend) => {
      body.position.lerp(pos, blend, body.position);
      body.quaternion.slerp(quat, blend, body.quaternion);
    },
    // Once an item has settled in a bag it belongs to that bag: pinned in place and
    // no longer grabbable, so it can never come back out.
    lock: () => {
      body.type = CANNON.Body.STATIC;
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.updateMassProperties();
      mesh.userData.locked = true;
    },
    reset: () => {
      body.position.set(...spec.pos);
      body.quaternion.set(0, 0, 0, 1);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    },
    destroy: () => {
      world.removeBody(body);
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      drop(pairs, pair);
      drop(pickables, mesh);
    },
  };
  trackedItems.push(handle);
  return handle;
}

function despawnItem(handle) {
  if (drag.held === handle.body) drag.release();
  handle.destroy();
  drop(trackedItems, handle);
  bags.forget(handle);
}

const drag = createDragController(world);

// One slot per position on the shelves; `item` is whatever currently occupies it.
const slots = buildItems().map((spec) => ({ spec, item: null }));
for (const slot of slots) slot.item = spawnItem(slot.spec);
const interaction = createInteraction({
  camera,
  domElement: renderer.domElement,
  drag,
  pickables,
});

const hoverLabel = createHoverLabel(camera, renderer.domElement, pickables);

const bags = createBagSystem({
  world,
  scene,
  camera,
  domElement: renderer.domElement,
  drag,
  pickables,
  items: trackedItems,
});

createRestockButton({
  slots,
  spawnItem,
  despawnItem,
  items: trackedItems,
  bags,
  drag,
});

const achievements = createAchievements();
const bottleFlip = createBottleFlipWatcher({ drag, items: trackedItems, achievements });
const throwIn = createThrowInWatcher({ drag, items: trackedItems, bags, achievements });

const tags = createTagSystem({
  world,
  scene,
  camera,
  domElement: renderer.domElement,
  drag,
  pickables,
  bags,
});

// Fixed-timestep physics driven by the render loop: accumulate real elapsed time
// and run whole FIXED_DT steps; leftover time carries into the next frame.
let accumulator = 0;
let last = performance.now();
let bubbleTransitionComplete = false;

async function startGame() {
  // Play bubble transition before allowing interaction
  await createBubbleTransition(scene, camera);
  bubbleTransitionComplete = true;
  showTitle('Toiletries 4 Dignity');
}

function frame(now) {
  const elapsed = Math.min((now - last) / 1000, 0.1); // avoid a spiral after tab switches
  last = now;

  interaction.update();
  hoverLabel.update();

  accumulator += elapsed;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    world.step(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) accumulator = 0;

  for (const { body, mesh } of pairs) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }
  for (const rag of rags) rag.update();
  bags.update(elapsed);
  tags.update(elapsed);
  bottleFlip.update(elapsed);
  throwIn.update(elapsed);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Start the bubble transition, then begin the main game loop
startGame();
requestAnimationFrame(frame);
