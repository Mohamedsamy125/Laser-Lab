# Laser Lab

- Start with `LASER_LAB_HANDOFF.md` for architecture, local setup, Vercel, and the game module contract.
- Work from this folder, which contains `package.json` and `vercel.json`. The browser source and assets live in `dist/`.
- Put each new game in `dist/games/<slug>/` and register it in `dist/games/catalog.js`. The game uses the shared camera, blue frame, mouse/touch, and normalized coordinates described in the handoff.
- Preserve compatibility with Robot Outbreak and the diagnostic pages. Run `npm test` and `npm run build` before handing off changes.
