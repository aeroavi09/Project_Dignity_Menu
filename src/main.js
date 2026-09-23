import * as CANNON from 'cannon-es';
import { buildItems } from './layout.js';
import { createPhysics, FIXED_DT, MAX_SUBSTEPS } from './physics.js';
import { createDragController } from './drag.js';
import { createScene, addStaticMeshes, createItemMesh, disposeItemMesh } from './scene.js';
import { createInteraction } from './interaction.js';
import { createBubbleTransition } from './bubbles.js';
import { createHoverLabel } from './hoverLabel.js';
import { createBagSystem } from './bags.js';
import { createSoftRag } from './softRag.js';
import { createTitleSign } from './title.js';
import { createMia } from './mia.js';
import { createBagCounter } from './bagCounter.js';
import { listenForCode, drawCheatTag } from './cheats.js';
import { createTagSystem } from './tags.js';
import { createRestockButton } from './restock.js';
import { createHomeButton } from './homeButton.js';
import { createAchievements } from './achievements.js';
import { createBottleFlipWatcher } from './bottleFlip.js';
import { createThrowInWatcher } from './throwIn.js';
import { startMenu } from './menu.js';
import { createSettingsUI, getSettings } from './settings.js';

const labelNameMap = {
  shampoo: 'Shampoo',
  bodyWash: 'Body Wash',
  conditioner: 'Hair Conditioner',
  wipes: 'Baby Wipes',
  soap: 'Soap',
  toothbrushSet: 'Toothbrush & Toothpaste',
  washrag: 'Washrag',
  deodorant: 'Deodorant',
  lipBalm: 'Lip Balm',
};

/**
 * Everything below used to run at import time. It is wrapped so the renderer, the physics
 * world, the item spawns and every pointer listener are created only once the player has
 * pressed Play on the menu -- the game itself is unchanged.
 */
function bootGame() {
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
        mesh: rag.mesh,
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
        // Out of the simulation, mesh left where it is (see carryAway).
        detach: () => {
          rag.detach();
          drop(rags, rag);
          drop(pickables, rag.mesh);
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
      mesh,
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
      // Out of the simulation and no longer synced to the body, mesh left where it is.
      detach: () => {
        world.removeBody(body);
        drop(pairs, pair);
        drop(pickables, mesh);
      },
      destroy: () => {
        handle.detach();
        mesh.removeFromParent();
        disposeItemMesh(mesh);
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

  /**
   * Hand an item over to whoever is carrying its finished bag away: it leaves the simulation
   * and every tracking list, but its mesh stays put for the carrier to move, and `destroy()`
   * is theirs to call once it is out of sight. `gone` tells the restock button to refill the
   * slot rather than try to reset an item that no longer exists.
   */
  function carryAway(handle) {
    handle.detach();
    drop(trackedItems, handle);
    bags.forget(handle);
    handle.gone = true;
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

  const bagCounter = createBagCounter();
  const bags = createBagSystem({
    world,
    scene,
    camera,
    domElement: renderer.domElement,
    drag,
    pickables,
    items: trackedItems,
    onFinish: () => bagCounter.add(),
  });

  createHomeButton();

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

  const titleSign = createTitleSign({ world, scene });
  const mia = createMia({ scene, bags, tags, carryAway });

  // Secret: type "chellito" to get a packed, tagged bag -- skips the packing when testing.
  listenForCode('chellito', () => {
    const entry = bags.autoPack();
    if (entry) tags.attachNew(entry, drawCheatTag());
    else console.warn('chellito: no room on the table, or an item has no free copy -- try Restock');
  });
  // Fixed-timestep physics driven by the render loop: accumulate real elapsed time
  // and run whole FIXED_DT steps; leftover time carries into the next frame.
  let accumulator = 0;
  let last = performance.now();
  let bubbleTransitionComplete = false;

  async function startGame() {
    // Play bubble transition before allowing interaction
    await createBubbleTransition(scene, camera, { reduceMotion: getSettings().reduceMotion });
    bubbleTransitionComplete = true;
    titleSign.drop('Toiletries 4 Dignity');
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
    titleSign.update();
    mia.update(elapsed);
    bottleFlip.update(elapsed);
    throwIn.update(elapsed);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // Start the bubble transition, then begin the main game loop
  startGame();
  requestAnimationFrame(frame);
}

// Mounted once, up front, so the gear button (and the music it starts) is present on the
// menu and stays present through the rest of the session rather than being torn down with it.
createSettingsUI();

startMenu().then(bootGame);
