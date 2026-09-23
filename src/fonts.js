// Shared FontFace loading for the game's playful display face. Registering via
// document.fonts (rather than a per-module @font-face rule) makes the font available to
// every module for the rest of the session, independent of any one module's DOM lifetime —
// title.js's canvas-drawn sign needs it truly loaded before it paints, while menu.js/
// settings.js's plain CSS text can just reference the family name and let the browser swap
// it in once loaded, no waiting required.
//
// import.meta.env.BASE_URL is Vite's configured `base` ('/' in dev, '/Project_Dignity/' on
// GitHub Pages) — a hardcoded '/fonts/...' path 404s once the site is served from a subpath.
// The filename has spaces, so it needs encoding too.
const FONT_FILES = {
  Blueberry: 'Blueberry Personal Use Only.ttf',
};

const loading = new Map();

export function loadFont(family) {
  if (loading.has(family)) return loading.get(family);

  const promise = (async () => {
    if (!document.fonts) return;
    const url = `${import.meta.env.BASE_URL}fonts/${encodeURIComponent(FONT_FILES[family])}`;
    const face = new FontFace(family, `url("${url}")`);
    await Promise.race([
      face.load().then((f) => document.fonts.add(f)).catch(() => null),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  })();

  loading.set(family, promise);
  return promise;
}

export function loadBlueberryFont() {
  return loadFont('Blueberry');
}
