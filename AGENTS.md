# Laser Lab

- Start with `LASER_LAB_HANDOFF.md` for architecture, local setup, GitHub Pages, Vercel, and the game module contract.
- Work from this folder, which contains `package.json` and `vercel.json`. The browser source and assets live in `dist/`.
- `dist/index.html` is the game library; `dist/play.html?game=<slug>` is the shared player. Keep all local URLs relative so GitHub Pages project paths work.
- Put each new game in `dist/games/<slug>/` and register it in `dist/games/catalog.js`. The game uses the shared camera, blue frame, mouse/touch, and normalized coordinates described in the handoff.
- Use `npm run game:new -- <slug> "Game Title"` to create a draft game with categorized asset folders. Its `manifest.js` owns its catalog metadata; drafts remain hidden until ready.
- Robot Outbreak implementation and assets are in `dist/games/robot-outbreak/`; the old root game modules are compatibility re-exports.
- Shared camera, laser detection, calibration and vision workers live in `dist/laser/`, with `dist/laser/index.js` as the player entry. Games receive normalized `shoot()` events; never duplicate camera or detector code inside a game.
- Preserve compatibility with Robot Outbreak and the diagnostic pages. Run `npm test` and `npm run build` before handing off changes.
