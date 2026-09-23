const STYLE = `
.home-btn {
  position: fixed; left: 20px; top: 20px; z-index: 15000;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 18px;
  border: 3px solid #00c6e8; border-radius: 999px;
  background: #fff;
  color: #0090ad;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px; font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 150, 190, 0.3);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.home-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(0, 150, 190, 0.4); }
.home-btn:active { transform: scale(0.96); }
`;

/**
 * Top-left "Main Menu" button, shown during the game (a twin of the Settings button on the right).
 *
 * Going back reloads the page rather than tearing the game down in place: bootGame() builds
 * the renderer, physics world, pointer listeners and HUD buttons once, with no teardown, and a
 * reload is the one way back that is guaranteed to leave nothing behind. Achievements and
 * settings live in localStorage, so they survive it; the packed bags don't, hence the confirm.
 */
export function createHomeButton() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.className = 'home-btn';
  button.type = 'button';
  button.textContent = 'Main Menu';
  document.body.appendChild(button);

  button.addEventListener('click', () => {
    if (window.confirm('Go back to the main menu? Your bags will be cleared.')) window.location.reload();
  });

  return { element: button };
}
