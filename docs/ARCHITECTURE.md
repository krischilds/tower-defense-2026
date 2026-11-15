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
Set the repository's Pages source to **GitHub Actions** in Settings → Pages. Pushes to `master` and manual workflow runs on `master` test, build, and deploy the game to GitHub Pages; pull requests to `master` test and build without deploying. The deployment build uses relative asset paths so it works under the repository's Pages URL.

## Pathfinding & placement (Milestone 2)
- `sim/pathfinding.ts`: Dijkstra distance field from the objective (8-directional, no diagonal corner cutting). One `FlowField` serves every enemy (step to lowest-distance neighbour), so recomputing it reroutes all enemies. Distances use Float64 - Float32 rounding corrupts Dijkstra's stale-entry check.
- `sim/world.ts`: authoritative state (towers, credits). `checkPlacement` rejects out-of-bounds, non-buildable, occupied, and any tile that would leave a spawn unable to reach the objective. `placeTower`/`sellTower` recompute the field and bump `version`; the renderer resyncs towers and the route overlay when it changes.
- `data/towers.ts`: tower costs/sell ratio/colour (placeholder stats; combat comes later).
- UI: the Available towers dashboard lists tower costs and selection buttons (also keys 1-3), with a ghost preview (green valid / red invalid), toast with the rejection reason, sell button (X), and route overlay toggle (P). Selecting a tower again or pressing Escape cancels placement.

## Enemies & game loop (Milestone 3)
- `data/enemies.ts` (health, speed, armor, objective damage, reward, colour, scale) and `data/balance.ts` (core health, temporary spawn cycle, sim step, speed options) hold all tuning.
- `World.update(dt)` spawns on a timer, moves each enemy along `FlowField.next` and damages the core on arrival; core at 0 sets `status = 'defeat'`. `World.reset()` restarts the level.
- Rerouting: an enemy re-reads the flow field each time it arrives at a tile, so tower changes take effect at the next tile. Towers cannot be placed on a tile an enemy is walking from/to, and `wouldBlockPath` also verifies every live enemy can still reach the objective.
- `core/gameLoop.ts`: fixed 1/60 s step accumulator with pause and 1x/2x/4x speed, capped catch-up. The renderer calls it once per frame via `onFrame` and draws current sim positions (no interpolation; 60 Hz steps are sufficient).
- `render/enemyRenderer.ts`: one mesh per live enemy id, billboarded health bars.
- The game starts paused so the player can build first; the timed spawner is a placeholder for the wave system.

## Milestone 4: tower combat
- `sim/combat.ts`: targeting (`first|last|strongest|weakest|closest`, ties by id), armor (`1/(1+0.25*armor*(1-pierce))`), projectiles with splash, sticky laser beams, tesla chain lightning, and `sweepDead` (kill rewards).
- Towers are data-driven by `kind` (`projectile|beam|chain`) in `data/towers.ts`: Cannon, Laser, Tesla.
- The sim emits `GameEvent`s (shot/hit/death/chain) that `render/effects.ts` turns into projectiles, beams, bolts and particles. Towers aim via `Battlefield.aimTowers`, and enemies flash on hit.
- UI: range rings, a per-tower targeting priority selector, live credits.

## Milestone 5: automatic waves
- `data/waves.ts`: data-driven `WaveDef`s (spawn groups with count/interval/delay, clear `bonus`, `healthMult`, `boss`). 12 waves; boss waves at 6 and 12. Timing knobs (`FIRST_WAVE_DELAY`, `WAVE_DELAY`) are in `data/balance.ts`.
- `sim/waves.ts`: `WaveController` (countdown → active → countdown/done). `World.update` feeds it; a wave completes when its queue is empty and no enemies remain, which pays the bonus. Clearing the last wave sets `status = 'victory'`. `world.callNextWave()` skips the countdown.
- New enemies: armored, swarm, boss (data + renderer shapes).
- UI: wave counter, countdown with "Send now" (N), clear toast, victory overlay.

## Milestone 6: tower upgrades
- `data/towers.ts` defines one two-level upgrade path per tower: Siege for Cannon, Lance for Laser, and Storm for Tesla. `getEffectiveTowerDef` combines base stats with the purchased levels.
- `World.upgradeTower` validates the path, level, game state and credits before charging, and adds each upgrade cost to the tower's investment. Level 3 can only be purchased after Level 2. Selling refunds the configured fraction of the full investment.
- Combat, selected range indicators and effects use effective stats. Upgraded towers use branch colors and one glowing ring per upgrade level.
- Click a placed tower at any time to leave placement mode and show its stats, upgrade choices, prices, and sell value. Tower levels start at 1; filled and empty boxes show the current level including the base tower. Unaffordable upgrades are disabled.

## Next milestone
Expand and balance the tower and enemy roster, then build level selection and progression.