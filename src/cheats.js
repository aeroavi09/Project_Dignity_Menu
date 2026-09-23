// Playtesting shortcuts: secret words typed anywhere in the game (outside a text field).

/** Call `onCode` whenever the letters of `code` are typed in a row. */
export function listenForCode(code, onCode) {
  let typed = '';
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-code.length);
    if (typed === code) {
      typed = '';
      onCode();
    }
  });
}

/** Artwork for a cheat-made gift tag, the same size as one drawn in the tag popup. */
export function drawCheatTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 280;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, 200, 280);
  g.fillStyle = '#ff2d86';
  g.strokeStyle = '#000';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(100, 190);
  g.bezierCurveTo(40, 150, 20, 120, 20, 90);
  g.bezierCurveTo(20, 60, 45, 45, 65, 45);
  g.bezierCurveTo(82, 45, 95, 55, 100, 72);
  g.bezierCurveTo(105, 55, 118, 45, 135, 45);
  g.bezierCurveTo(155, 45, 180, 60, 180, 90);
  g.bezierCurveTo(180, 120, 160, 150, 100, 190);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#000';
  g.font = 'bold 30px "Comic Sans MS", cursive';
  g.textAlign = 'center';
  g.fillText('Chellito', 100, 240);
  return canvas;
}
