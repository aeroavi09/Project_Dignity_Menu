// Pure data describing the room, furniture and toiletry items.
// Units are meters / kilograms. Shared by physics (cannon-es) and rendering (three).
// This module has no dependencies so it can be used headlessly.

export const ROOM = {
  minX: -2.1,
  maxX: 2.1,
  backZ: -0.25, // back wall
  frontZ: 0.45, // invisible front wall: keeps play in a shallow depth slab
  height: 2.6,
};

export const SHELF = {
  centerX: -0.95,
  centerZ: 0,
  width: 1.2,
  depth: 0.34,
  height: 1.9,
  sideT: 0.03,
  boardT: 0.03,
  backT: 0.02,
  // Top-surface Y of each board. Index 0 = shelf 1 (topmost) ... index 4 = shelf 5 (bottom).
  levels: [1.64, 1.26, 0.88, 0.5, 0.12],
};

export const TABLE = {
  centerX: 0.95,
  centerZ: 0.02,
  width: 1.2,
  depth: 0.5,
  topY: 0.75,
  topT: 0.05,
  legW: 0.05,
  apronH: 0.08,
  apronT: 0.02,
};

// Furniture palette: bright ocean blue.
// WHITE is kept as the name the parts list uses for the structural pieces -- shelf posts,
// boards, back panel, table legs and apron all share this one tone so the set reads as
// designed rather than assembled. The table top is a lighter tint of the same hue: related
// to the frame, but bright enough that bags and tags stay legible on it.
const WHITE = 0x1ca7d8;
const TABLE_TOP = 0x52c6ea;

/** Static furniture parts as boxes: { size:[x,y,z], pos:[x,y,z], color } */
export function buildStaticParts() {
  const parts = [];
  const s = SHELF;
  const innerW = s.width - 2 * s.sideT;

  // Shelving unit: four slim corner posts (open sides so items can be slid out
  // sideways within the shallow play depth), a back panel, 5 boards.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        name: 'shelf-post',
        size: [s.sideT, s.height, s.sideT],
        pos: [s.centerX + sx * (s.width / 2 - s.sideT / 2), s.height / 2, s.centerZ + sz * (s.depth / 2 - s.sideT / 2)],
        color: WHITE,
      });
    }
  }
  parts.push({
    name: 'shelf-back',
    size: [s.width, s.height, s.backT],
    pos: [s.centerX, s.height / 2, s.centerZ - s.depth / 2 - s.backT / 2],
    color: WHITE,
  });
  s.levels.forEach((y, i) => {
    parts.push({
      name: `shelf-${i + 1}`,
      size: [innerW, s.boardT, s.depth],
      pos: [s.centerX, y - s.boardT / 2, s.centerZ],
      color: WHITE,
    });
  });

  // Table: soft off-white top, white legs and apron frame.
  const t = TABLE;
  const legH = t.topY - t.topT;
  // The collider is thicker than the visible top (it extends down into the space
  // enclosed by the apron) so fast-falling items can't tunnel through it.
  const colliderT = t.topT + t.apronH;
  parts.push({
    name: 'table-top',
    size: [t.width, t.topT, t.depth],
    pos: [t.centerX, t.topY - t.topT / 2, t.centerZ],
    collider: { size: [t.width, colliderT, t.depth], pos: [t.centerX, t.topY - colliderT / 2, t.centerZ] },
    color: TABLE_TOP,
  });
  const lx = t.width / 2 - t.legW / 2 - 0.03;
  const lz = t.depth / 2 - t.legW / 2 - 0.03;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        name: 'table-leg',
        size: [t.legW, legH, t.legW],
        pos: [t.centerX + sx * lx, legH / 2, t.centerZ + sz * lz],
        color: WHITE,
      });
    }
  }
  const apronY = legH - t.apronH / 2;
  for (const sz of [-1, 1]) {
    parts.push({
      name: 'table-apron',
      size: [2 * lx, t.apronH, t.apronT],
      pos: [t.centerX, apronY, t.centerZ + sz * lz],
      color: WHITE,
    });
  }
  for (const sx of [-1, 1]) {
    parts.push({
      name: 'table-apron',
      size: [t.apronT, t.apronH, 2 * lz],
      pos: [t.centerX + sx * lx, apronY, t.centerZ],
      color: WHITE,
    });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Toiletry item templates. Physics shape is an upright cylinder (axis = Y), a box, or
// a 'compound' set of boxes welded at fixed offsets. `dims` = {radius, height} or
// {size:[x,y,z]}; a compound also carries `parts`, and `size` is its overall bounds.
// Masses are tuned for play, not realism: the light items are deliberately much
// heavier than life so a bumped lip balm doesn't get launched across the room.
// Keep the heaviest:lightest ratio low (~4:1) — that ratio, not the absolute
// values, is what decides how far one item shoves another.
// ---------------------------------------------------------------------------
const T = {
  shampoo: (color) => ({ kind: 'shampoo', shape: 'cylinder', radius: 0.033, height: 0.2, mass: 0.55, color }),
  bodyWash: (color) => ({ kind: 'bodyWash', shape: 'cylinder', radius: 0.035, height: 0.21, mass: 0.6, color }),
  conditioner: (color) => ({ kind: 'conditioner', shape: 'cylinder', radius: 0.032, height: 0.19, mass: 0.52, color }),
  soap: (color) => ({ kind: 'soap', shape: 'box', size: [0.099, 0.0385, 0.066], mass: 0.25, color }),
  wipes: (color) => ({ kind: 'wipes', shape: 'cylinder', radius: 0.055, height: 0.075, mass: 0.4, color }),
  // Toothbrush + toothpaste, strapped together as one rigid set. `size` is the overall
  // bounds (used for shelf layout); each part's offset is from the body origin, with the
  // y offsets chosen so both parts rest flat on the shelf.
  toothbrushSet: (color) => ({
    kind: 'toothbrushSet',
    shape: 'compound',
    size: [0.064, 0.031, 0.209],
    mass: 0.19,
    color,
    parts: [
      { name: 'brush', size: [0.02, 0.031, 0.209], offset: [-0.0198, 0, 0] },
      // The tube is round at the cap end and flattens into a wider crimp at the tail,
      // so its box collider takes the widest width and the tallest height: the round
      // end sets the height, the crimp sets the width.
      { name: 'paste', size: [0.033, 0.0275, 0.16], offset: [0.0143, -0.0018, 0.013] },
    ],
  }),
  washrag: (color) => ({ kind: 'washrag', shape: 'box', size: [0.15, 0.03, 0.15], mass: 0.15, color }),
  deodorant: (color) => ({ kind: 'deodorant', shape: 'box', size: [0.0525, 0.126, 0.0315], mass: 0.22, color }),
  lipBalm: (color) => ({ kind: 'lipBalm', shape: 'cylinder', radius: 0.0105, height: 0.0683, mass: 0.13, color }),
};

const SHELF_CONTENTS = [
  // Shelf 1 (top)
  [
    T.shampoo(0xff5fae), T.shampoo(0xff5fae), T.shampoo(0xff5fae),
    T.bodyWash(0x1f6bff), T.bodyWash(0x1f6bff), T.bodyWash(0x1f6bff),
    T.conditioner(0xa855f7), T.conditioner(0xa855f7), T.conditioner(0xa855f7),
  ],
  // Shelf 2
  [
    T.soap(0xfafaf5), T.soap(0xffc247), T.soap(0xfafaf5),
    T.wipes(0x2ec4a6), T.wipes(0x2ec4a6),
  ],
  // Shelf 3
  [
    T.toothbrushSet(0xe53935), T.toothbrushSet(0x43a047), T.toothbrushSet(0xfb8c00), T.toothbrushSet(0x00acc1),
    T.washrag(0xf28b82), T.washrag(0xfdd663),
  ],
  // Shelf 4
  [
    T.deodorant(0x3949ab), T.deodorant(0x00897b), T.deodorant(0xef6c00),
    T.lipBalm(0xe85d75), T.lipBalm(0xf2a65a), T.lipBalm(0x26c281),
  ],
  // Shelf 5 (bottom): empty
  [],
];

export function itemWidthX(item) {
  return item.shape === 'cylinder' ? item.radius * 2 : item.size[0];
}

export function itemHeight(item) {
  return item.shape === 'cylinder' ? item.height : item.size[1];
}

/** All items with initial positions, laid out in a row on their shelf with equal gaps. */
export function buildItems() {
  const s = SHELF;
  const innerMin = s.centerX - s.width / 2 + s.sideT;
  const innerW = s.width - 2 * s.sideT;
  const items = [];

  SHELF_CONTENTS.forEach((row, shelfIndex) => {
    if (row.length === 0) return;
    const widths = row.map(itemWidthX);
    const gap = (innerW - widths.reduce((a, b) => a + b, 0)) / (row.length + 1);
    if (gap <= 0) throw new Error(`Shelf ${shelfIndex + 1} is overfull`);
    let x = innerMin + gap;
    row.forEach((item, i) => {
      const y = s.levels[shelfIndex] + itemHeight(item) / 2 + 0.001;
      items.push({ ...item, shelf: shelfIndex + 1, pos: [x + widths[i] / 2, y, s.centerZ] });
      x += widths[i] + gap;
    });
  });
  return items;
}
