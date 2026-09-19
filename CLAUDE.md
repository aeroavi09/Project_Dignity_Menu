# Toiletry Shelf Game

Three.js + cannon-es physics game (Vite, vanilla JS, no framework). Player drags toiletries off a shelf, packs them into plastic bags, and decorates finished bags with hand-drawn gift tags.

## Run it

```
npm install
npm run dev      # http://localhost:5173 (or next free port)
npm run build     # outputs to dist/
```

## Architecture

- `layout.js` — pure data (shelf/table/room dimensions, item templates). No dependencies; shared by physics and rendering.
- `physics.js` — cannon-es world setup, static colliders, `createItemBody()`. Items use `linearFactor: (1,1,0)` / `angularFactor: (0,0,1)` — **every pickable item is locked to one Z-depth plane** so nothing can roll out of a bag's reach. Preserve this on any new item type.
- `scene.js` — Three.js renderer/camera/lighting, static meshes, per-item-kind mesh builders.
- `drag.js` — the core pickup mechanic: a cannon-es Spring between the held body and a cursor-following anchor. Tuned via `STIFFNESS_PER_KG`/`DAMPING_PER_KG` — don't retune without a reason, other systems (bag handle, tag) mirror this tuning intentionally for a consistent feel.
- `interaction.js` — raycast pickup/hover. Supports two paths: a plain mesh with `userData.body` uses the standard spring drag; a mesh with `userData.onGrab` hands control to a custom controller (used by soft bags and the tag/bag generators). If `onGrab` returns nothing, no drag starts — that's how generators intercept a click as "open a UI" instead of "pick me up."
- `softBodyBag.js` / `bags.js` — plastic bags: a ~9-particle mass-spring "soft body" while carried, snapping into a single static rigid body when dropped on the table. `bags.js` tracks per-bag contents/completeness and the checkmark.
- `softRag.js` — washrags as a floppy particle chain (same idea, simpler).
- `tagGenerator.js` / `tagPopup.js` / `tags.js` — gift tag mechanic: click the generator to open a draw/text popup, finished tag becomes a normal pickable, snaps onto a completed bag.
- `bubbles.js`, `title.js`, `hoverLabel.js` — cosmetic: intro transition, title card, hover tooltips + world-anchored labels (checkmarks etc).

## Gotchas

- **Asset URLs at runtime must use `import.meta.env.BASE_URL`, never a hardcoded absolute path.** GitHub Pages serves this from a subpath (`/Project_Dignity/`); anything built as a template string injected via `<style>`/`<script>` at runtime (not a real `.css`/`.html` file) bypasses Vite's own path rewriting. `title.js`'s font-face is the reference example — bit us once already (font silently fell back to a system font in production, worked fine locally).
- `vite.config.js`'s `base` is derived automatically from `GITHUB_REPOSITORY` at build time — don't hardcode it.
- Physics step is fixed at 1/240s (`FIXED_DT` in `physics.js`) because thin items (lip balm, toothbrush) tunnel through 3cm shelf boards at larger steps.

## Testing physics/gameplay changes

Prefer a **headless Node script** driving `world.step()` directly over browser automation for anything involving the spring/physics loop. Automated browser tabs in this environment are frequently not OS-focused, which means `document.hidden` is true and `requestAnimationFrame` — which the entire game loop runs on — doesn't fire, regardless of how long you wait. Screenshots still render (CDP forces a frame for capture) so visual/UI checks work fine in-browser; anything time-dependent (drag settling, bag snapping, arrow animations) does not, and will silently appear frozen. A minimal DOM stub (`document.createElement` returning a plain object with `style`/`classList`/`addEventListener`) is enough to run `bags.js`/`tags.js`/`softRag.js` headlessly — see prior test scripts in scratch space for the pattern if reconstructing one.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to Pages automatically on push to `main`. Live at whatever Pages URL is configured in repo Settings → Pages (Source must be "GitHub Actions", not "Deploy from a branch").
