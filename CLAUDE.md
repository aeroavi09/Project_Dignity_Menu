# Toiletry Shelf Game

Three.js + cannon-es physics game (Vite, vanilla JS, no framework). Player drags toiletries off a shelf, packs them into plastic bags, and decorates finished bags with hand-drawn gift tags.

## Run it

```
npm install
npm run dev      # http://localhost:5173 (or next free port)
npm run build     # outputs to dist/
```

## Architecture

- `main.js` — wiring + the fixed-timestep loop. Owns `spawnItem()`/`despawnItem()` and a **slot registry** (one entry per shelf position, holding the item currently in it). Items are created and destroyed mid-game, so anything that caches an item list must tolerate that — push/splice the shared `pickables`/`pairs`/`trackedItems` arrays rather than rebuilding them.
- `layout.js` — pure data (shelf/table/room dimensions, item templates). No dependencies; shared by physics and rendering. An item's `shape` is `'cylinder'`, `'box'`, or `'compound'` — a set of boxes welded at fixed offsets into one body (the toothbrush + toothpaste). A compound's `size` is its overall bounds, used for shelf packing; `buildItems()` throws "Shelf N is overfull" if a resize stops a row fitting, which is the cheapest check that a size change is safe.
- `physics.js` — cannon-es world setup, static colliders, `createItemBody()`. Items use `linearFactor: (1,1,0)` / `angularFactor: (0,0,1)` — **every pickable item is locked to one Z-depth plane** so nothing can roll out of a bag's reach. Preserve this on any new item type.
- `scene.js` — Three.js renderer/camera/lighting, static meshes, per-item-kind mesh builders.
- `drag.js` — the core pickup mechanic: a cannon-es Spring between the held body and a cursor-following anchor. Tuned via `STIFFNESS_PER_KG`/`DAMPING_PER_KG` — don't retune without a reason, other systems (bag handle, tag) mirror this tuning intentionally for a consistent feel.
- `interaction.js` — raycast pickup/hover. Supports two paths: a plain mesh with `userData.body` uses the standard spring drag; a mesh with `userData.onGrab` hands control to a custom controller (used by soft bags and the tag/bag generators). If `onGrab` returns nothing, no drag starts — that's how generators intercept a click as "open a UI" instead of "pick me up." A third flag, `userData.locked`, blocks grabbing entirely while leaving the mesh hoverable, so bagged items keep their name label.
- `softBodyBag.js` / `bags.js` — plastic bags: a ~9-particle mass-spring "soft body" while carried, snapping into a single static rigid body when dropped on the table. `bags.js` tracks per-bag contents/completeness and the checkmark, and owns the seal/lock rules below.
- `softRag.js` — washrags as a floppy particle chain (same idea, simpler). Exposes `reset`/`push`/`lock`/`dispose` so the restock button can treat a six-particle rag like any other single-body item.
- `restock.js` — the bottom-left Restock button: returns loose items to their slots, spawns replacements for bagged ones, and cleans up orphans.
- `achievements.js` — the store (persisted in localStorage), the unlock toast and the 🏆 page. Adding an entry to `ACHIEVEMENTS` is all that a new one needs on the UI side.
- `bottleFlip.js` / `throwIn.js` — the achievement watchers, one per easter egg. Each is polled from the frame loop and calls `achievements.unlock(id)`. They observe existing state (`drag.held`, `bags.holds`) rather than requiring hooks in the systems they watch.
- `tagGenerator.js` / `tagPopup.js` / `tags.js` — gift tag mechanic: click the generator to open a draw/text popup, finished tag becomes a normal pickable, snaps onto a completed bag.
- `bubbles.js`, `title.js`, `hoverLabel.js` — cosmetic: intro transition, title card, hover tooltips + world-anchored labels (checkmarks etc).

## Bag lifecycle

Three states, and the transitions matter more than the code makes obvious:

1. **Open** — items entering the bag are counted after settling (`SETTLE_TIME`) but stay fully dynamic and grabbable. Containment is re-checked every frame, so lifting a mistake back out un-counts it. This window is deliberately forgiving.
2. **Complete** — the frame the bag holds one of every label in `required`. This is the commit point: `entry.sealed` is set, and every contained item is `lock()`ed (body → static, `userData.locked` → true). Nothing comes back out.
3. **Sealed** — contents are frozen, `trackContents` is skipped entirely, and anything lowered in afterwards is shoved back out by `ejectIntruders`.

The restock button never reclaims an item from a bag at any stage — the slot gets a freshly spawned replacement instead, and an item that left a bag before it sealed is despawned on the next press so repeat presses can't accumulate duplicates.

## Gotchas

- **Asset URLs at runtime must use `import.meta.env.BASE_URL`, never a hardcoded absolute path.** GitHub Pages serves this from a subpath (`/Project_Dignity/`); anything built as a template string injected via `<style>`/`<script>` at runtime (not a real `.css`/`.html` file) bypasses Vite's own path rewriting. `title.js`'s font-face is the reference example — bit us once already (font silently fell back to a system font in production, worked fine locally).
- `vite.config.js`'s `base` is derived automatically from `GITHUB_REPOSITORY` at build time — don't hardcode it.
- **Scaling every item's mass by the same factor changes nothing.** Gravity is mass-independent, the drag spring is tuned per-kg (`STIFFNESS_PER_KG`), and friction scales with weight — so a uniform "make things heavier" is a pure no-op. What actually governs how far one item shoves another is the *ratio* between them; `layout.js` keeps heaviest:lightest near 4:1 for that reason. To resist toppling, reach for `angularDamping` and restitution instead.
- **A `STATIC` or `SLEEPING` body does not integrate gravity at all** (`Body.integrate` returns early on both). Anything pinned via `item.lock()` stays exactly where it is, which is the point — but it also means you must never restore a body to `SLEEPING` if it might be unsupported: sleepers are only woken by contact, so one left in mid-air hangs there permanently. Wake on unfreeze, always.
- Static/sleeping pairs are skipped by the broadphase (`needBroadphaseCollision`), so a pinned item generates no contacts — you cannot ask "is this still supported?" once it is static.
- **Mesh builders must express every dimension as a fraction of the item's collider size**, never a literal. `scene.js` builders are written this way so resizing an item in `layout.js` scales its whole appearance; a hardcoded `0.008` handle radius silently stays put while everything around it grows. Bit us once when scaling the toothbrush set.
- **Hand-built `BufferGeometry` needs its winding order checked.** `computeVertexNormals()` happily produces inward-facing normals from backwards triangles: the build passes, the geometry is valid, and the mesh just renders inside-out. `tubeBarrelGeometry` in `scene.js` had exactly this. Assert `dot(normal, outward radial) > 0` on a sample of vertices rather than eyeballing it.
- **Judge contact-based rules from cannon's `collide` events, not per-frame sampling.** A contact is created and resolved inside `world.step()`, so by the time a frame ends a bounce has already happened and been smoothed away — sampling positions each frame misses it entirely. `throwIn.js` is the reference example.
- Physics step is fixed at 1/240s (`FIXED_DT` in `physics.js`) because thin items (lip balm, toothbrush) tunnel through 3cm shelf boards at larger steps.

## Testing physics/gameplay changes

Prefer a **headless Node script** driving `world.step()` directly over browser automation for anything involving the spring/physics loop. Automated browser tabs in this environment are frequently not OS-focused, which means `document.hidden` is true and `requestAnimationFrame` — which the entire game loop runs on — doesn't fire, regardless of how long you wait. Screenshots still render (CDP forces a frame for capture) so visual/UI checks work fine in-browser; anything time-dependent (drag settling, bag snapping, arrow animations) does not, and will silently appear frozen. A minimal DOM stub (`document.createElement` returning a plain object with `style`/`classList`/`addEventListener`) is enough to run `bags.js`/`tags.js`/`softRag.js` headlessly — see prior test scripts in scratch space for the pattern if reconstructing one.

Two things worth knowing about what else runs headlessly:

- `layout.js` and `physics.js` import cleanly in Node, so item sizes, shelf packing, collider offsets and "does it settle when dropped" are all testable by stepping the world directly.
- **Three.js geometry needs no WebGL context.** `createItemMesh()` and `new THREE.Box3().setFromObject(mesh)` work in plain Node, which makes it cheap to assert that a mesh agrees with its collider — that it rests flush on a shelf rather than floating above or sinking into it, and that it doesn't overhang its own bounds. Only the renderer needs a browser.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to Pages automatically on push to `main`. Live at whatever Pages URL is configured in repo Settings → Pages (Source must be "GitHub Actions", not "Deploy from a branch").
