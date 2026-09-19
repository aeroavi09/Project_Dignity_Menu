const STYLE = `
.restock-btn {
  position: fixed; right: 20px; bottom: 20px; z-index: 15000;
  display: flex; align-items: center; gap: 8px;
  padding: 11px 18px 11px 15px;
  border: none; border-radius: 999px;
  background: #22a447; color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px; font-weight: 700; letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  transition: transform 0.12s ease, background 0.12s ease;
}
.restock-btn:hover { background: #1c8d3c; }
.restock-btn:active { transform: scale(0.96); }
.restock-btn-icon { font-size: 18px; line-height: 1; display: inline-block; }
.restock-btn.spinning .restock-btn-icon { animation: restock-spin 0.5s ease; }
@keyframes restock-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;

/**
 * "Restock" button: puts every loose item back on its shelf slot.
 *
 * Items that have settled inside a bag are never pulled back out — the slot they came
 * from gets a freshly spawned replacement instead. Anything left over from an earlier
 * restock (a replaced item that was later taken out of its bag) is removed, so pressing
 * the button repeatedly can't litter the room with duplicates.
 */
export function createRestockButton({ slots, spawnItem, despawnItem, items, bags, drag }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.className = 'restock-btn';
  button.type = 'button';
  button.innerHTML = '<span class="restock-btn-icon">⟳</span>Restock';
  document.body.appendChild(button);

  function restock() {
    drag.release(); // no-op unless something is mid-drag

    const keep = new Set();
    for (const slot of slots) {
      if (bags.holds(slot.item)) slot.item = spawnItem(slot.spec);
      else slot.item.reset();
      keep.add(slot.item);
    }
    for (const item of [...items]) {
      if (keep.has(item) || bags.holds(item)) continue;
      despawnItem(item);
    }

    button.classList.remove('spinning');
    void button.offsetWidth; // restart the animation on repeat presses
    button.classList.add('spinning');
  }

  button.addEventListener('click', restock);

  return { restock, element: button };
}
