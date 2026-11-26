# Neon Bastion

Neon Bastion is a browser-based sci-fi tower defense game built with Vue, TypeScript, and Three.js. It requires a browser with WebGPU support.

## Getting started

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in a WebGPU-compatible browser.

## How to play

The game starts paused so you can place towers before the first wave. Build on available tiles, defend the core from incoming enemies, and use credits from kills and cleared waves to build and upgrade your defenses. Towers cannot be placed if they block every route to the objective. Click a placed tower to inspect it, change its target priority, upgrade it, or sell it.

Use the speed controls to play at ¼×, ½×, 1×, 2×, or 4× speed.
The wave countdown shows the time remaining before enemies arrive; it pauses with the game and can be skipped with **Send now** or N.

Each tower has one two-step upgrade chain:

- **Cannon — Siege:** improves splash and range, then increases splash and damage.
- **Laser — Lance:** improves range and armor penetration, then extends range and fully penetrates armor.
- **Tesla — Storm:** increases chain coverage, then adds more jumps and reduces damage falloff.
- **Missile — Warhead:** increases damage and range, then adds damage and armor penetration.

The base tower is Level 1. Its first upgrade is Level 2; Level 3 is available only after Level 2 is purchased.

## Controls

| Action | Controls |
| --- | --- |
| Pan camera | Drag, WASD, or arrow keys |
| Rotate camera | Right-drag or Q/E |
| Top-down view preset | Top-down button beside the rotation controls |
| Zoom | Mouse wheel or pinch |
| Select a tower to build | 1–4 |
| Cancel placement / selection | Escape |
| Sell selected tower | X or Delete |
| Toggle enemy route display | P |
| Start or pause | Space |
| Send the next wave immediately | N |

The game starts in the centered, near-overhead Top-down view, and its button is selected. Clicking the preset returns to this view with a smooth transition. Panning, rotating, or zooming interrupts the move. The camera readout above the controls shows the position, target, yaw and pitch (in degrees), distance, field of view, and aspect ratio as you adjust the view.

## Development

```sh
npm run dev       # Start the development server
npm test          # Run the test suite
npm run build     # Type-check and create a production build
npm run preview   # Preview the production build
```

The simulation rules are kept separate from rendering and the UI. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details and planned milestones, including local API and database development.

For GitHub Pages deployment, see the [workflow README](.github/workflows/README.md).
