import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ROOM, TABLE } from './layout.js';
import { INK } from './scene.js';
import { createVoice } from './voice.js';

// Mia, a Mixamo-rigged character, collects every finished goodie bag: she walks in from the
// right, reaches over the table, lifts the bag into her arms, turns, and carries it off frame.
// Purely visual -- she has no physics body. Each FBX carries the same skeleton, so any clip
// retargets onto the one skinned mesh loaded from the walk file.
const MODEL_DIR = `${import.meta.env.BASE_URL}models/`;
const FILES = { walk: 'MiaWalking.fbx', reach: 'MiaReach.fbx', turn: 'MiaBoxTurn.fbx', carry: 'MiaBoxWalkArc.fbx' };
const HIPS = 'mixamorigHips';

const HEIGHT = 1.2; // m
// Her standing height in the rig's own units, measured from the skinned mesh once posed. The
// un-posed bind mesh is centred on the origin, but every clip stands her with her feet on it,
// so the root sits at floor level (y = 0) -- offsetting it from the bind-pose box is what had
// her floating half a metre up.
const RIG_HEIGHT = 1.86;

// Close enough that her reach lands on the bag (her hand gets ~0.35 m out in front at full
// stretch) while keeping her body clear of the table's front edge.
const STAND_Z = TABLE.centerZ + TABLE.depth / 2 + 0.16;
const EXIT_Z = STAND_Z + 0.14;
const OFFSTAGE_X = ROOM.maxX + 0.7; // clear of the frame even on an ultrawide window
const ARRIVE = 0.03;
const WAIT = 1.2; // s the finished bag sits on the table before she comes for it
const GRAB_AT = 0.65; // fraction of the reach clip at full stretch, where her hand meets the bag
const FADE = 0.3;
const TURN_EASE = 6; // 1/s, exponential ease toward a target heading
// Where the bag rides, relative to her feet. While it's still over the table its base stays
// just above the table top, so it slides off into her arms without sinking through; once her
// turn has swung it clear of the table edge, it settles down into her hands, which the
// box-carry clips hold at 0.68-0.82 m.
const LIFT_HEIGHT = TABLE.topY + 0.02;
const CARRY_HEIGHT = 0.6;
const CARRY_FORWARD = 0.22;
const LIFT_ARC = 0.04; // a small hop as it leaves the table
const CARGO_HALF = 0.2; // the finished pouch's half-footprint, with its bulge
const LOWER_EASE = 5; // 1/s

const PORTRAIT_EYE_Y = 1.02; // m, about her eye line at HEIGHT

// One recording of short quips; she says a random one each time she lifts a finished bag.
// [start, end] in seconds, measured from the recording's silences: every gap between quips is
// 0.5-0.7s, while pauses inside a quip are a few hundredths -- except the last one, which has
// a 0.3s pause mid-line and is kept whole. Re-recording means re-measuring these.
const QUIPS_URL = `${import.meta.env.BASE_URL}audio/MiaQuips.mp3`;
const QUIPS = [
  [0.11, 0.6],
  [1.05, 1.8],
  [2.29, 3.8],
  [4.25, 5.06],
  [5.45, 6.02],
  [6.55, 8.78],
];

// The model faces +Z, so heading θ looks along (sin θ, cos θ).
const FACE_LEFT = -Math.PI / 2;
const FACE_TABLE = Math.PI;

function hipsTrack(clip, prop) {
  return clip.tracks.find((t) => t.name === `${HIPS}.${prop}`);
}

/** Ground speed of the hips' baked travel, in rig units per second. */
function strideSpeed(clip) {
  const v = hipsTrack(clip, 'position').values;
  const n = v.length - 3;
  return Math.hypot(v[n] - v[0], v[n + 2] - v[2]) / clip.duration;
}

/**
 * Pin the hips' travel (XZ) and heading (yaw) to their first key, keeping height and tilt so
 * the bob and sway survive. The controller drives travel and heading through the root instead:
 * the clips disagree about both, so leaving them baked in makes every crossfade jump. Returns
 * the removed yaw curve, which the turn clip uses to rotate the root in step with the body.
 */
function pinRoot(clip) {
  const pos = hipsTrack(clip, 'position').values;
  for (let i = 3; i < pos.length; i += 3) {
    pos[i] = pos[0];
    pos[i + 2] = pos[2];
  }
  const rot = hipsTrack(clip, 'quaternion');
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const yaws = [];
  let yaw0 = null;
  let prev = 0;
  for (let i = 0; i < rot.values.length; i += 4) {
    e.setFromQuaternion(q.fromArray(rot.values, i), 'YXZ');
    if (yaw0 === null) yaw0 = prev = e.y;
    let y = e.y;
    while (y - prev > Math.PI) y -= 2 * Math.PI;
    while (y - prev < -Math.PI) y += 2 * Math.PI;
    prev = y;
    yaws.push(y - yaw0);
    e.y = yaw0;
    q.setFromEuler(e).toArray(rot.values, i);
  }
  return { times: rot.times, yaws };
}

function yawAt({ times, yaws }, t) {
  if (t <= times[0]) return yaws[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
      return yaws[i - 1] + (yaws[i] - yaws[i - 1]) * f;
    }
  }
  return yaws[yaws.length - 1];
}

/**
 * The same ink line the items carry (see outline() in scene.js), for a skinned mesh. Items
 * scale a copy of each part up by the ink width, but a scaled copy can't follow a deforming
 * skeleton, so this shell shares her skeleton instead and pushes every vertex out along its
 * skinned normal. `width` is in the mesh's own units, so callers divide out her scale.
 */
function skinnedOutline(mesh, width) {
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinning_vertex>',
      `#include <skinning_vertex>\n\ttransformed += normalize( objectNormal ) * ${width.toFixed(6)};`
    );
  };
  const shell = new THREE.SkinnedMesh(mesh.geometry, material);
  shell.bind(mesh.skeleton, mesh.bindMatrix);
  shell.frustumCulled = false;
  mesh.add(shell);
}

function easeAngle(from, to, k) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
}

/**
 * `carryAway(item)` is main.js's hand-off: it pulls an item out of the simulation and every
 * tracking list but leaves its mesh, so she can pick it up. Call `update(dt)` every frame.
 */
export function createMia({ scene, renderer, bags, tags, carryAway }) {
  let resolvePortrait;
  // A head-and-shoulders picture of her (data URL) for the tutorial's speech bubble. Resolves
  // once the model and its texture are both in; never resolves if the model fails to load.
  const portrait = new Promise((r) => (resolvePortrait = r));
  let ready = false;
  let root = null;
  let mixer = null;
  let socket = null;
  let scale = 1;
  const actions = {};
  let turnYaw = null;
  let walkSpeed = 0;
  let carrySpeed = 0;

  const quips = createVoice(QUIPS_URL);
  let lastQuip = -1;

  /** A random quip, never the same one twice running. */
  function sayQuip() {
    // Draw from the others, then step over the last one to fill the gap it left.
    let i = Math.floor(Math.random() * (lastQuip < 0 ? QUIPS.length : QUIPS.length - 1));
    if (lastQuip >= 0 && i >= lastQuip) i++;
    lastQuip = i;
    quips.play(QUIPS[i]);
  }

  let state = 'away';
  let waiting = null; // { entry, t } -- a finished bag she is about to come for
  let job = null; // { entry, group, liftFrom, liftT }
  let heading = FACE_LEFT;
  let turnFrom = 0;
  let exitDir = 1;

  const loader = new FBXLoader();
  Promise.all(Object.values(FILES).map((f) => loader.loadAsync(MODEL_DIR + f)))
    .then(([walkFbx, reachFbx, turnFbx, carryFbx]) => {
      root = walkFbx;
      scale = HEIGHT / RIG_HEIGHT;
      root.scale.setScalar(scale);
      root.visible = false;
      const skinned = [];
      root.traverse((obj) => {
        if (!obj.isMesh) return;
        skinned.push(obj);
        // Posed, she stands well above the bind-pose bounds three.js would cull against.
        obj.frustumCulled = false;
        // Lit, the imported material renders her near-black: its diffuse colour loads as
        // black and the export's normals are poor. Unlit shows the texture as painted, which
        // also suits the flat, poster-lit room.
        const map = (Array.isArray(obj.material) ? obj.material[0] : obj.material).map;
        obj.material = new THREE.MeshBasicMaterial({ map });
      });
      for (const mesh of skinned) skinnedOutline(mesh, INK / scale);
      scene.add(root);

      socket = new THREE.Object3D();
      socket.scale.setScalar(1 / scale); // world-scaled, so the cargo keeps its real size
      socket.position.set(0, LIFT_HEIGHT / scale, CARRY_FORWARD / scale);
      root.add(socket);

      const clips = {
        walk: walkFbx.animations[0],
        reach: reachFbx.animations[0],
        turn: turnFbx.animations[0],
        carry: carryFbx.animations[0],
      };
      walkSpeed = strideSpeed(clips.walk) * scale;
      carrySpeed = strideSpeed(clips.carry) * scale;
      pinRoot(clips.walk);
      pinRoot(clips.reach);
      turnYaw = pinRoot(clips.turn);
      pinRoot(clips.carry);

      mixer = new THREE.AnimationMixer(root);
      for (const [name, clip] of Object.entries(clips)) actions[name] = mixer.clipAction(clip);
      for (const name of ['reach', 'turn']) {
        actions[name].setLoop(THREE.LoopOnce);
        actions[name].clampWhenFinished = true;
      }
      ready = true;
      whenTextured(skinned).then(() => resolvePortrait(renderPortrait()));
    })
    .catch((err) => console.error('Mia failed to load', err));

  /**
   * FBXLoader hands back the model before its texture image has finished decoding. Also waits
   * for her to be offstage, since the portrait borrows her mixer and pose.
   */
  function whenTextured(meshes) {
    const ready = () => state === 'away' && meshes.every((m) => m.material.map?.image?.width > 0);
    return new Promise((resolve) => {
      const check = () => (ready() ? resolve() : setTimeout(check, 100));
      check();
    });
  }

  /**
   * Draw her head and shoulders, standing in the first frame of her walk, into a small render
   * target and hand back the pixels as a data URL. She is borrowed from the room for the one
   * render and put straight back; she is hidden there until a bag needs collecting anyway.
   */
  function renderPortrait() {
    const home = root.parent;
    const saved = { position: root.position.clone(), rotation: root.rotation.y, visible: root.visible };
    const stage = new THREE.Scene();
    stage.background = new THREE.Color(0xfff4fb);
    stage.add(root);
    root.position.set(0, 0, 0);
    root.rotation.y = 0; // facing +Z, toward the camera below
    root.visible = true;
    actions.walk.reset().play();
    mixer.update(0);
    root.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
    camera.position.set(0, PORTRAIT_EYE_Y, 0.8);
    camera.lookAt(0, PORTRAIT_EYE_Y - 0.03, 0);
    const size = 256;
    const target = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.SRGBColorSpace });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(stage, camera);
    renderer.setRenderTarget(previous);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    target.dispose();

    mixer.stopAllAction();
    home.add(root);
    root.position.copy(saved.position);
    root.rotation.y = saved.rotation;
    root.visible = saved.visible;

    // Render targets read back bottom row first.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    const image = g.createImageData(size, size);
    const row = size * 4;
    for (let y = 0; y < size; y++) image.data.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
    g.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }

  function switchTo(from, to) {
    actions[from].fadeOut(FADE);
    actions[to].reset().fadeIn(FADE).play();
  }

  function pickUp() {
    const { entry } = job;
    bags.takeAway(entry);
    const group = new THREE.Group();
    group.position.copy(entry.bag.center);
    scene.add(group);
    group.updateMatrixWorld();
    group.attach(entry.bag.mesh);
    for (const item of entry.contained) {
      carryAway(item);
      group.attach(item.mesh);
    }
    if (entry.tag) group.attach(entry.tag.mesh);
    socket.attach(group); // keeps its world pose; the lift then eases it into her arms
    sayQuip();
    job.group = group;
    job.liftFrom = group.position.clone();
    job.liftT = 0;
  }

  function dropOff() {
    const { entry, group } = job;
    for (const item of entry.contained) item.destroy();
    if (entry.tag) tags.disposeTag(entry.tag);
    entry.bag.dispose();
    group.removeFromParent();
    job = null;
  }

  function update(dt) {
    if (!ready) return;

    if (state === 'away') {
      const entry = bags.list.find(bags.isFinished);
      if (!entry) {
        waiting = null;
        return;
      }
      if (waiting?.entry !== entry) waiting = { entry, t: 0 };
      waiting.t += dt;
      if (waiting.t < WAIT) return;
      job = { entry };
      waiting = null;
      heading = FACE_LEFT;
      socket.position.y = LIFT_HEIGHT / scale;
      root.position.set(OFFSTAGE_X, 0, STAND_Z);
      root.visible = true;
      mixer.stopAllAction();
      // Full weight from the first frame: fading in from nothing would blend her with the
      // un-posed rig, which is centred on her origin and so sinks half of her into the floor.
      actions.walk.reset().play();
      state = 'in';
    }

    mixer.update(dt);

    if (state === 'in') {
      const dx = job.entry.bag.center.x - root.position.x;
      if (Math.abs(dx) < ARRIVE) {
        switchTo('walk', 'reach');
        state = 'reach';
      } else {
        root.position.x += Math.sign(dx) * Math.min(walkSpeed * dt, Math.abs(dx));
      }
    } else if (state === 'reach') {
      heading = easeAngle(heading, FACE_TABLE, Math.min(1, TURN_EASE * dt));
      const t = actions.reach.time / actions.reach.getClip().duration;
      if (!job.group && t >= GRAB_AT) pickUp();
      if (!actions.reach.isRunning() && job.group) {
        switchTo('reach', 'turn');
        turnFrom = heading;
        state = 'turn';
      }
    } else if (state === 'turn') {
      heading = turnFrom + yawAt(turnYaw, actions.turn.time);
      if (!actions.turn.isRunning()) {
        // Leave the way she is now facing, squared up to the room so she clears the table.
        exitDir = Math.sin(heading) >= 0 ? 1 : -1;
        switchTo('turn', 'carry');
        state = 'out';
      }
    } else if (state === 'out') {
      heading = easeAngle(heading, (exitDir * Math.PI) / 2, Math.min(1, TURN_EASE * dt));
      root.position.x += exitDir * carrySpeed * dt;
      // Drift away from the table as she goes, so the bag in her arms clears its edge.
      root.position.z += (EXIT_Z - root.position.z) * Math.min(1, 2 * dt);
      if (Math.abs(root.position.x) > OFFSTAGE_X) {
        dropOff();
        mixer.stopAllAction();
        root.visible = false;
        state = 'away';
      }
    }

    if (state === 'turn' || state === 'out') {
      // Settle the bag into her hands, but only once its footprint has left the table.
      socket.getWorldPosition(probe);
      const overTable =
        probe.z - CARGO_HALF < TABLE.centerZ + TABLE.depth / 2 &&
        Math.abs(probe.x - TABLE.centerX) < TABLE.width / 2 + CARGO_HALF;
      const target = (overTable ? LIFT_HEIGHT : CARRY_HEIGHT) / scale;
      socket.position.y += (target - socket.position.y) * Math.min(1, LOWER_EASE * dt);
    }

    if (job?.group && job.liftT < 1) {
      // Ease the bag off the table and into her arms over what's left of the reach.
      const rest = (1 - GRAB_AT) * actions.reach.getClip().duration;
      job.liftT = Math.min(1, job.liftT + dt / rest);
      const e = 1 - (1 - job.liftT) ** 3;
      job.group.position.lerpVectors(job.liftFrom, ORIGIN, e);
      job.group.position.y += Math.sin(Math.PI * e) * LIFT_ARC;
    }

    root.rotation.y = heading;
  }

  return { update, portrait };
}

const ORIGIN = new THREE.Vector3();
const probe = new THREE.Vector3();
