import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadBlueberryFont } from './fonts.js';
import { INK, inkBoxEdges } from './scene.js';

const FONT_FAMILY = 'Blueberry';

// The sign is a real cannon-es body: it free-falls from above the visible room and lands on
// an invisible static ledge mounted on the back wall. Its Z-depth is kept thin and tucked
// just behind the shelf's own depth footprint (z -0.17..0.17, see SHELF in layout.js), which
// only avoids physically clipping the shelf posts/back panel — the shelf is still closer to
// the camera there, so a board whose X range overlaps it gets visually occluded (looks
// "inside" the shelf). SIGN_X shifts the whole board right of the shelf's right edge
// (x=-0.35) so their X ranges never overlap on screen; the table's static geometry tops out
// around y=0.75, well below the sign, so overlapping its X range on the right is fine.
// Locked to one Z-depth plane and rotation about Z only, same convention as every item.
const SIGN_W = 1.6;
const SIGN_H = 0.5;
const SIGN_D = 0.04;
const SIGN_X = 0.65;
const SIGN_Z = -0.21;
const SIGN_MASS = 1;
const START_Y = 3.4; // above ROOM.height (2.6): starts off-screen and drops into frame

const LEDGE_W = SIGN_W + 0.15;
const LEDGE_D = SIGN_D + 0.08;
const LEDGE_H = 0.08;
const LEDGE_TOP_Y = 1.45;

function signBoardTexture(text) {
  const w = 1024;
  const h = Math.round(w * (SIGN_H / SIGN_W));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');

  g.fillStyle = '#fff8ec';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2a1020';
  g.lineWidth = 14;
  g.strokeRect(7, 7, w - 14, h - 14);

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = '#af1ef9';
  g.fillStyle = '#00e3ff';
  let fontSize = h * 0.55;
  g.font = `${fontSize}px "${FONT_FAMILY}", "Comic Sans MS", cursive`;
  const maxWidth = w * 0.88;
  const measured = g.measureText(text).width;
  if (measured > maxWidth) {
    fontSize *= maxWidth / measured;
    g.font = `${fontSize}px "${FONT_FAMILY}", "Comic Sans MS", cursive`;
  }
  g.lineWidth = fontSize * 0.14;
  g.strokeText(text, w / 2, h / 2);
  g.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A physical sign board that drops onto a ledge above the shelf/table gap once dropped.
 * Created up front so its static ledge exists from the start of the game; `drop(text)`
 * spawns and releases the falling board, and `update()` must be called every frame to
 * mirror the mesh onto the settled body (same pattern as bags.js/tags.js).
 */
export function createTitleSign({ world, scene, pickables, onClick }) {
  const signMaterial = new CANNON.Material('sign');
  world.addContactMaterial(
    new CANNON.ContactMaterial(signMaterial, signMaterial, { friction: 0.6, restitution: 0.15 })
  );

  const ledgeBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: signMaterial });
  ledgeBody.addShape(new CANNON.Box(new CANNON.Vec3(LEDGE_W / 2, LEDGE_H / 2, LEDGE_D / 2)));
  ledgeBody.position.set(SIGN_X, LEDGE_TOP_Y - LEDGE_H / 2, SIGN_Z);
  world.addBody(ledgeBody);

  const ledgeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(LEDGE_W, LEDGE_H, LEDGE_D),
    new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.8 })
  );
  ledgeMesh.position.copy(ledgeBody.position);
  scene.add(ledgeMesh);
  // Inked on every edge like the rest of the furniture, with a heavier pen: it hangs furthest
  // back of anything in the room, so the standard line reads thinner here than elsewhere.
  scene.add(inkBoxEdges([{ size: [LEDGE_W, LEDGE_H, LEDGE_D], pos: ledgeBody.position.toArray() }], INK * 1.5));

  let body = null;
  let mesh = null;
  let dropped = false;

  async function drop(text) {
    if (dropped) return;
    dropped = true;
    await loadBlueberryFont();

    const texture = signBoardTexture(text);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xcf8f4f, roughness: 0.85 });
    const faceMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(SIGN_W, SIGN_H, SIGN_D),
      [boardMat, boardMat, boardMat, boardMat, faceMat, boardMat]
    );
    scene.add(mesh);
    // Clickable, not grabbable: an onGrab that returns nothing opens something instead of
    // starting a drag (see interaction.js), the same trick as the tag maker.
    if (onClick) {
      mesh.userData.label = 'Donate & Volunteer';
      mesh.userData.onGrab = () => {
        onClick();
      };
      pickables.push(mesh);
    }

    body = new CANNON.Body({
      mass: SIGN_MASS,
      material: signMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(SIGN_W / 2, SIGN_H / 2, SIGN_D / 2)),
      linearDamping: 0.15,
      angularDamping: 0.4,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.5,
      // Same depth-plane lock as every other pickable item.
      linearFactor: new CANNON.Vec3(1, 1, 0),
      angularFactor: new CANNON.Vec3(0, 0, 1),
    });
    body.position.set(SIGN_X, START_Y, SIGN_Z);
    world.addBody(body);
  }

  function update() {
    if (!body) return;
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  return { drop, update };
}
