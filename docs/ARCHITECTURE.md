# Architecture

## Stack
Vite + TypeScript (strict) + Vue 3/Pinia (UI overlay) + Three.js `WebGPURenderer` (`three/webgpu`) + Vitest.

## WebGPU is mandatory
`src/render/webgpu.ts` checks `navigator.gpu`, requests an adapter, constructs `WebGPURenderer({ forceWebGL: false })`,
and after `init()` asserts `renderer.backend.isWebGPUBackend`. Three.js would otherwise silently fall back to WebGL2;
we throw `WebGPUUnavailableError` and the UI shows a blocking "WebGPU required" screen instead.

## Layers (dependencies point downward only)
- `src/ui/` – Vue components and Pinia store. Displays state; no game rules.
- `src/render/` – Three.js scene (`Battlefield`), camera (`CameraController`), `GameRenderer` glue. Reads sim state, never owns it.
- `src/sim/` – Pure TypeScript game rules (currently `Grid`). No DOM/three imports; unit-tested in `tests/`.
- `src/data/` – Data-driven definitions (maps now; towers/enemies/waves/balance later).

Renderer → UI communication is via callbacks (`onHover`, `onSelect`, `onFps`) wired in `GameView.vue` to the store.

## Coordinates
Tile (x, y) ↔ world (x − w/2 + .5, h, y − h/2 + .5); the board lies on the XZ plane, Y is up. Picking intersects the
pointer ray with the tile-top plane, so it is O(1) and independent of mesh count.

## Camera / input
Pointer Events for mouse and touch. Drag pans, right-drag rotates, wheel zooms; touch: one-finger pan, two-finger
pinch zoom + twist rotate, tap selects. Keyboard: WASD/arrows pan, Q/E rotate.

## Commands
`npm run dev`, `npm run build` (type-check + bundle), `npm test`.

## Deployment
Set the repository's Pages source to **GitHub Actions** in Settings → Pages. Pushes to `master` test, build, and deploy to GitHub Pages using `dev`; pushes to branches beginning with `release` test and build without deploying. Manual runs can select `dev` from any branch, with `dev` as the default. Selecting `prod` currently does not deploy because AWS is not configured; add an AWS deployment job using the `prod` environment when ready. Pull requests targeting either track test and build without deploying. The deployment build uses relative asset paths so it works under the repository's Pages URL.

## Pathfinding & placement (Milestone 2)
- `sim/pathfinding.ts`: Dijkstra distance field from the objective (8-directional, no diagonal corner cutting). One `FlowField` serves every enemy (step to lowest-distance neighbour), so recomputing it reroutes all enemies. Distances use Float64 - Float32 rounding corrupts Dijkstra's stale-entry check.
- `sim/world.ts`: authoritative state (towers, credits). `checkPlacement` rejects out-of-bounds, non-buildable, occupied, and any tile that would leave a spawn unable to reach the objective. `placeTower`/`sellTower` recompute the field and bump `version`; the renderer resyncs towers and the route overlay when it changes.
- `data/towers.ts`: tower costs/sell ratio/colour (placeholder stats; combat comes later).
- UI: the Available towers dashboard lists tower costs and selection buttons (also keys 1-4), with a ghost preview (green valid / red invalid), toast with the rejection reason, sell button (X), and route overlay toggle (P). Selecting a tower again or pressing Escape cancels placement.

## Enemies & game loop (Milestone 3)
- `data/enemies.ts` (health, speed, armor, objective damage, reward, colour, scale) and `data/balance.ts` (core health, temporary spawn cycle, sim step, speed options) hold all tuning.
- `World.update(dt)` spawns on a timer, moves each enemy along `FlowField.next` and damages the core on arrival; core at 0 sets `status = 'defeat'`. `World.reset()` restarts the level.
- Rerouting: an enemy re-reads the flow field each time it arrives at a tile, so tower changes take effect at the next tile. Towers cannot be placed on a tile an enemy is walking from/to, and `wouldBlockPath` also verifies every live enemy can still reach the objective.
- `core/gameLoop.ts`: fixed 1/60 s step accumulator with pause and 1/4x, 1/2x, 1x, 2x and 4x speeds, capped catch-up. The renderer calls it once per frame via `onFrame` and draws current sim positions (no interpolation; 60 Hz steps are sufficient).
- `render/enemyRenderer.ts`: one mesh per live enemy id, billboarded health bars.
- The game starts paused so the player can build first; the timed spawner is a placeholder for the wave system.

## Milestone 4: tower combat
- `sim/combat.ts`: targeting (`first|last|strongest|weakest|closest`, ties by id), armor (`1/(1+0.25*armor*(1-pierce))`), projectiles with splash, accelerating missiles, sticky laser beams, tesla chain lightning, and `sweepDead` (kill rewards). Missile blast damage falls off within a two-tile radius, like cannon splash.
- Towers are data-driven by `kind` (`projectile|missile|beam|chain`) in `data/towers.ts`: Cannon, Missile, Laser, Tesla. Missile travel events let the renderer create smoke along the path even when a missile impacts between frames.
- The sim emits `GameEvent`s (shot/hit/death/chain) that `render/effects.ts` turns into projectiles, beams, bolts and particles. Cannon shells have bullet-shaped metal bodies; missiles have pointed noses and fins. Missile smoke and impact sparks use soft camera-facing particles. Towers use rounded geometry and subdued metallic materials, aim via `Battlefield.aimTowers`, and enemies flash on hit.
- UI: range rings, a per-tower targeting priority selector, live credits.

## Milestone 5: automatic waves
- `data/waves.ts`: data-driven `WaveDef`s (spawn groups with count/interval/delay, clear `bonus`, `healthMult`, `boss`). 12 waves; boss waves at 6 and 12. Timing knobs (`FIRST_WAVE_DELAY`, `WAVE_DELAY`) are in `data/balance.ts`.
- `sim/waves.ts`: `WaveController` (countdown → active → countdown/done). `World.update` feeds it; a wave completes when its queue is empty and no enemies remain, which pays the bonus. Clearing the last wave sets `status = 'victory'`. `world.callNextWave()` skips the countdown.
- New enemies: armored, swarm, boss (data + renderer shapes).
- UI: wave counter, visible countdown with a remaining-time bar and "Send now" (N), clear toast, victory overlay. The countdown remains visible while paused.

## Milestone 6: tower upgrades
- `data/towers.ts` defines one two-level upgrade path per tower: Siege for Cannon, Lance for Laser, Storm for Tesla, and Warhead for Missile. `getEffectiveTowerDef` combines base stats with the purchased levels.
- `World.upgradeTower` validates the path, level, game state and credits before charging, and adds each upgrade cost to the tower's investment. Level 3 can only be purchased after Level 2. Selling refunds the configured fraction of the full investment.
- Combat, selected range indicators and effects use effective stats. Upgraded towers use branch colors and one glowing ring per upgrade level.
- Click a placed tower at any time to leave placement mode and show its stats, upgrade choices, prices, and sell value. Tower levels start at 1; filled and empty boxes show the current level including the base tower. Unaffordable upgrades are disabled.

## Planned milestones

1. **Expand the game:** Expand and balance the tower and enemy roster, then build level selection and progression.
2. **Persist completed runs locally:** Add an ASP.NET Core API and PostgreSQL with EF Core. Implement a small vertical slice
   that saves a completed game run and retrieves recent runs. Keep the simulation in the browser, validate API requests,
   and treat client-reported results as untrusted; a competitive leaderboard would require server-side verification.
   Commit the initial database migration and apply it explicitly during local setup.
3. **Run and test the full stack locally:** Run the API and PostgreSQL with Docker Compose and persist database data in a
   named volume. Run Vite locally with a development proxy to the API. Add API integration tests against PostgreSQL,
   including migration and persistence checks, alongside the existing frontend tests.
4. **Automate CI:** Use GitHub Actions to build and test the frontend and backend and build the API Docker image. Preserve
   the existing GitHub Pages deployment; publishing a container image can be added separately.
5. **Deploy later:** After the application works locally and CI is reliable, plan AWS deployment, potentially using EC2
   and Docker containers. AWS is not required for the preceding milestones.

For the backend, start with one API project and one test project under `backend/`, organized by feature as the application
grows. Use environment-based configuration for container connections and keep real credentials out of the repository.