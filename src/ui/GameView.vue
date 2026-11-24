<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useGameStore } from './store';
import { GameRenderer } from '../render/gameRenderer';
import { Grid } from '../sim/grid';
import { World, type PlaceResult, type TargetPriority, type UpgradeResult } from '../sim/world';
import { PRIORITIES } from '../sim/types';
import { MAPS } from '../data/maps';
import { STARTING_CREDITS, TOWERS, getEffectiveTowerDef, getTowerDef, getUpgradeBranches } from '../data/towers';
import { SPEED_OPTIONS } from '../data/balance';
import { GameLoop } from '../core/gameLoop';
import { WebGPUUnavailableError } from '../render/webgpu';

const store = useGameStore();
const canvas = ref<HTMLCanvasElement>();
const cameraInfo = ref('');
const map = MAPS[0];
const world = new World(Grid.fromMap(map), STARTING_CREDITS);
const loop = new GameLoop(world);
const grid = world.grid;
let game: GameRenderer | undefined;
let toastTimer: number | undefined;

store.currency = world.credits;
store.totalWaves = world.waves.total;
store.objectiveMax = world.coreMax;
store.objectiveHealth = world.coreHealth;

const REASONS: Record<Extract<PlaceResult, { ok: false }>['reason'], string> = {
  'out-of-bounds': 'Outside the battlefield',
  'not-buildable': 'Cannot build on this tile',
  occupied: 'Tile is occupied',
  'enemy-in-way': 'An enemy is on that tile',
  'blocks-path': 'Would block all enemy routes',
  'insufficient-funds': 'Not enough credits',
};

function onFrame(dt: number) {
  loop.advance(dt);
  if (store.objectiveHealth !== world.coreHealth) store.objectiveHealth = world.coreHealth;
  if (store.currency !== world.credits) store.currency = world.credits;
  if (store.enemyCount !== world.enemies.length) store.enemyCount = world.enemies.length;
  const wc = world.waves;
  if (store.wave !== wc.started) store.wave = wc.started;
  if (store.wavePhase !== wc.phase) store.wavePhase = wc.phase;
  const cd = Math.max(0, Math.ceil(wc.countdown));
  if (store.countdown !== cd) store.countdown = cd;
  if (store.lastBonus !== wc.lastBonus) {
    store.lastBonus = wc.lastBonus;
    if (wc.lastBonus > 0) toast(`Wave ${wc.started} cleared  +${wc.lastBonus}`);
  }
  if (world.status === 'victory' && !store.victory) {
    store.victory = true;
    loop.paused = true;
    store.paused = true;
  }
  if (world.status === 'defeat' && !store.defeated) {
    store.defeated = true;
    loop.paused = true;
    store.paused = true;
  }
}

function togglePause() {
  if (store.defeated || store.victory) return;
  loop.paused = !loop.paused;
  store.paused = loop.paused;
}

function setSpeed(s: number) {
  loop.speed = s;
  store.speed = s;
}

function restart() {
  world.reset();
  loop.paused = true;
  store.paused = true;
  store.defeated = false;
  store.victory = false;
  store.lastBonus = 0;
  store.wave = 0;
  game?.setSelected(null);
  syncStore();
  store.objectiveHealth = world.coreHealth;
}

const selectedTower = computed(() => {
  const s = store.selected;
  void store.revision;
  const t = s ? world.towerAt(s.x, s.y) : undefined;
  return t ? { ...t } : undefined; // snapshot so the template re-renders on every revision
});
const selectedDef = computed(() => (selectedTower.value ? getEffectiveTowerDef(selectedTower.value) : null));
const selectedBranchName = computed(() => {
  const tower = selectedTower.value;
  return tower ? getUpgradeBranches(tower.defId).find((branch) => branch.id === tower.branch)?.name : undefined;
});
const upgradeLevelCount = computed(() => {
  const tower = selectedTower.value;
  if (!tower) return 0;
  const branches = getUpgradeBranches(tower.defId);
  const selected = branches.find((branch) => branch.id === tower.branch);
  return selected ? selected.levels.length : Math.max(0, ...branches.map((branch) => branch.levels.length));
});
const selectedDescription = computed(() => {
  const tower = selectedTower.value;
  if (!tower) return '';
  const branch = getUpgradeBranches(tower.defId).find((item) => item.id === tower.branch);
  return branch?.levels[tower.level - 1]?.description ?? getTowerDef(tower.defId).description;
});
const upgradeOptions = computed(() => {
  const tower = selectedTower.value;
  if (!tower) return [];
  return getUpgradeBranches(tower.defId)
    .filter((branch) => !tower.branch || branch.id === tower.branch)
    .map((branch) => ({ branch, next: branch.levels[tower.level] }))
    .filter((option) => option.next);
});

const UPGRADE_REASONS: Record<Extract<UpgradeResult, { ok: false }>['reason'], string> = {
  'no-tower': 'No tower selected',
  'invalid-branch': 'Unknown upgrade path',
  'branch-locked': 'This tower has already chosen another path',
  'max-level': 'Tower is fully upgraded',
  'insufficient-funds': 'Not enough credits',
  'game-ended': 'The level has ended',
};

function upgrade(branchId: string) {
  const tile = store.selected;
  if (!tile) return;
  const result = world.upgradeTower(tile.x, tile.y, branchId);
  if (!result.ok) {
    toast(UPGRADE_REASONS[result.reason]);
    return;
  }
  syncStore();
}

function toast(msg: string) {
  store.message = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (store.message = ''), 2000);
}

function syncStore() {
  store.currency = world.credits;
  store.revision++;
}

function setPlacing(id: string | null) {
  store.placing = id;
  game?.setPlacing(id);
}

function onTap(t: { x: number; y: number } | null) {
  if (!t) return;
  if (world.towerAt(t.x, t.y)) {
    setPlacing(null);
    store.selected = grid.get(t.x, t.y)!;
    game?.setSelected(store.selected);
    return;
  }
  if (store.placing) {
    const res = world.placeTower(store.placing, t.x, t.y);
    if (res.ok) {
      syncStore();
      // Stay in placement mode so several towers can be built quickly.
    } else toast(REASONS[res.reason]);
    return;
  }
  const same = store.selected && store.selected.x === t.x && store.selected.y === t.y;
  store.selected = same ? null : grid.get(t.x, t.y)!;
  game?.setSelected(store.selected);
}

function sell() {
  const s = store.selected;
  if (!s) return;
  const refund = world.sellTower(s.x, s.y);
  if (refund !== null) {
    toast(`Sold for ${refund}`);
    syncStore();
  }
}

function setPriority(p: TargetPriority) {
  const s = store.selected;
  if (!s) return;
  world.setPriority(s.x, s.y, p);
  store.revision++;
}

function towerTip(id: string) {
  const d = getTowerDef(id);
  const dmg = d.kind === 'beam' ? `${d.damage}/s` : `${d.damage}`;
  return `${d.name}: ${d.description} Damage ${dmg}, range ${d.range}`;
}

function togglePath() {
  store.showPath = !store.showPath;
  game?.setPathVisible(store.showPath);
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLElement) {
    if (e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (e.code === 'Space' && e.target.closest('button')) return;
  }
  if (e.key === 'n' || e.key === 'N') {
    world.callNextWave();
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= TOWERS.length) setPlacing(store.placing === TOWERS[n - 1].id ? null : TOWERS[n - 1].id);
  else if (e.key === 'Escape') {
    setPlacing(null);
    store.selected = null;
    game?.setSelected(null);
  } else if (e.key === 'Delete' || e.key === 'x') sell();
  else if (e.key === 'p') togglePath();
  else if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  game = new GameRenderer(canvas.value!, world, {
    onHover: (t) => (store.hovered = t ? grid.get(t.x, t.y)! : null),
    onTap,
    onFps: (fps) => (store.fps = fps),
    onCameraInfo: (info) => (cameraInfo.value = info),
    onFrame,
  });
  try {
    await game.start();
    store.backend = game.backendName;
  } catch (e) {
    store.error =
      e instanceof WebGPUUnavailableError
        ? e.message
        : `Failed to start renderer: ${e instanceof Error ? e.message : String(e)}`;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  game?.dispose();
});
</script>

<template>
  <div class="game">
    <canvas ref="canvas" class="view" />

    <div v-if="store.error" class="error">
      <h1>WebGPU required</h1>
      <p>{{ store.error }}</p>
      <p class="hint">
        Use a recent Chrome, Edge, or Safari 26+ / Firefox with WebGPU enabled, on a secure context (https or localhost).
        This game does not fall back to WebGL or Canvas.
      </p>
    </div>

    <template v-else>
      <header class="hud">
        <div class="stat"><span>CREDITS</span><b>{{ store.currency }}</b></div>
        <div class="stat wide">
          <span>CORE {{ store.objectiveHealth }} / {{ store.objectiveMax }}</span>
          <div class="bar"><i :style="{ width: (store.objectiveHealth / store.objectiveMax) * 100 + '%' }" /></div>
        </div>
        <div class="stat"><span>WAVE</span><b>{{ store.wave }} / {{ store.totalWaves }}</b></div>
        <div class="stat"><span>ENEMIES</span><b>{{ store.enemyCount }}</b></div>
      </header>

      <div class="time">
        <button class="play-toggle" :class="{ running: !store.paused }" title="Start / pause (Space)" @click="togglePause">{{ store.paused ? 'Start' : 'Pause' }}</button>
        <button v-for="s in SPEED_OPTIONS" :key="s" :class="{ active: store.speed === s }" :aria-pressed="store.speed === s" @click="setSpeed(s)">{{ s === 0.25 ? '¼' : s === 0.5 ? '½' : s }}×</button>
      </div>

      <div v-if="store.wavePhase === 'countdown' && !store.paused && !store.defeated && !store.victory" class="wavebar">
        {{ store.wave === 0 ? 'First wave' : 'Wave ' + (store.wave + 1) }} in {{ store.countdown }}s
        <button @click="world.callNextWave()">Send now (N)</button>
      </div>

      <div v-if="store.paused && !store.defeated && !store.victory" class="banner">Paused — build your defences, then press Start or Space</div>

      <div v-if="store.victory" class="overlay victory">
        <h1>Victory!</h1>
        <p>All {{ store.totalWaves }} waves defeated · Core {{ store.objectiveHealth }} / {{ store.objectiveMax }}</p>
        <button @click="restart">Play again</button>
      </div>

      <div v-if="store.defeated" class="overlay">
        <h1>Core destroyed</h1>
        <button @click="restart">Restart level</button>
      </div>

      <aside class="panel">
        <h2>{{ map.name }}</h2>
        <template v-if="selectedTower && selectedDef">
          <h3>{{ selectedDef.name }} tower (level {{ selectedTower.level + 1 }} of {{ upgradeLevelCount + 1 }})</h3>
          <p class="muted">{{ selectedDescription }}</p>
          <p>Damage {{ selectedDef.damage }}{{ selectedDef.kind === 'beam' ? '/s' : '' }} · Range {{ selectedDef.range }}<template v-if="selectedDef.kind !== 'beam'"> · {{ selectedDef.fireRate }} shots/s</template></p>
          <p class="muted">Armor pierce {{ Math.round(selectedDef.armorPierce * 100) }}%<template v-if="selectedDef.kind === 'projectile'"> · Splash {{ selectedDef.splash ?? 0 }}</template><template v-if="selectedDef.kind === 'chain'"> · Chains {{ selectedDef.chainCount }}</template></p>
          <p>Level {{ selectedTower.level + 1 }}<template v-if="selectedBranchName"> · {{ selectedBranchName }}</template></p>
          <div
            v-if="upgradeLevelCount"
            class="upgrade-levels"
            role="img"
            :aria-label="`Level ${selectedTower.level + 1} of ${upgradeLevelCount + 1}`"
          >
            <span v-for="level in upgradeLevelCount + 1" :key="level" :class="{ filled: level <= selectedTower.level + 1 }" />
          </div>
          <h3>Upgrades</h3>
          <p v-if="selectedTower.level === 0" class="muted">Choose one path; choices are permanent.</p>
          <div v-if="upgradeOptions.length" class="upgrades">
            <button v-for="{ branch, next } in upgradeOptions" :key="branch.id" :disabled="store.currency < next.cost" @click="upgrade(branch.id)">
              <strong>{{ branch.name }} · Level {{ selectedTower.level + 2 }} · {{ next.cost }} credits</strong>
              <span>{{ next.description }}</span>
              <span v-if="store.currency < next.cost">Not enough credits</span>
            </button>
          </div>
          <p v-else class="muted">Maximum upgrade level reached.</p>
          <p class="muted">Targeting</p>
          <div class="prio">
            <button v-for="p in PRIORITIES" :key="p" :class="{ active: selectedTower.priority === p }" @click="setPriority(p)">{{ p }}</button>
          </div>
          <button class="sell" @click="sell">Sell (+{{ Math.floor(selectedTower.invested * selectedDef.sellRatio) }})</button>
        </template>
        <template v-else-if="store.selected">
          <h3>Selected tile</h3>
          <p>({{ store.selected.x }}, {{ store.selected.y }}) · {{ store.selected.type }}</p>
        </template>
        <p v-else class="muted">{{ store.placing ? 'Click a tile to build.' : 'Select a tower from the dashboard, or click a tile.' }}</p>
        <p v-if="store.hovered" class="muted">Hover: ({{ store.hovered.x }}, {{ store.hovered.y }}) · {{ store.hovered.type }}</p>
        <label class="toggle"><input type="checkbox" :checked="store.showPath" @change="togglePath" /> Show enemy route (P)</label>
      </aside>

      <div v-if="store.message" class="toast">{{ store.message }}</div>

      <nav class="towers" aria-label="Available towers">
        <div class="towers-heading">
          <strong>Available towers</strong>
          <span>{{ store.placing ? 'Select a tile to build · Esc to cancel' : 'Select a tower to build' }}</span>
        </div>
        <div class="tower-list">
          <button
            v-for="(t, i) in TOWERS"
            :key="t.id"
            :class="{ active: store.placing === t.id, poor: store.currency < t.cost }"
            :style="{ '--c': '#' + t.color.toString(16).padStart(6, '0') }"
            :title="towerTip(t.id)"
            :aria-pressed="store.placing === t.id"
            @click="setPlacing(store.placing === t.id ? null : t.id)"
          >
            <i aria-hidden="true" />
            <span>{{ t.name }}</span>
            <small>{{ t.cost }} credits · [{{ i + 1 }}]</small>
            <small v-if="store.currency < t.cost" class="unaffordable">Not enough credits</small>
          </button>
        </div>
      </nav>

      <div v-if="cameraInfo" class="camera-info" aria-label="Camera debug information">
        <strong>Camera</strong>
        <pre>{{ cameraInfo }}</pre>
      </div>
      <div class="controls">
        <button title="Rotate left (Q)" @click="game?.rotate(-Math.PI / 4)">⟲</button>
        <button title="Rotate right (E)" @click="game?.rotate(Math.PI / 4)">⟳</button>
        <button class="view-preset" title="Third-person view" aria-label="Third-person view" @click="game?.thirdPersonView()">3rd</button>
        <button title="Zoom in" @click="game?.zoom(0.8)">＋</button>
        <button title="Zoom out" @click="game?.zoom(1.25)">－</button>
      </div>

      <footer class="status">{{ store.backend }} · {{ store.fps }} FPS</footer>
      <div class="help">
        Drag: pan · Right-drag / Q,E: rotate · Wheel / pinch: zoom · WASD: move · 1-4: tower · Esc: cancel · X: sell
      </div>
    </template>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
html,
body,
#app {
  margin: 0;
  height: 100%;
  background: #05070d;
  overflow: hidden;
}
.game {
  position: relative;
  width: 100%;
  height: 100%;
  color: #cfe6ff;
  user-select: none;
}
.view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  pointer-events: none;
}
.stat {
  background: rgba(10, 20, 40, 0.7);
  border: 1px solid #1f8fff55;
  border-radius: 8px;
  padding: 6px 14px;
  display: flex;
  flex-direction: column;
  min-width: 90px;
  backdrop-filter: blur(6px);
}
.stat.wide {
  flex: 1;
  max-width: 360px;
}
.stat span {
  font-size: 11px;
  letter-spacing: 0.15em;
  color: #6aa8ff;
}
.stat b {
  font-size: 20px;
}
.bar {
  height: 10px;
  margin-top: 8px;
  background: #0a1426;
  border-radius: 5px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2bffb0, #1fd0ff);
}
.panel {
  position: absolute;
  top: 80px;
  right: 12px;
  width: 220px;
  background: rgba(10, 20, 40, 0.75);
  border: 1px solid #1f8fff55;
  border-radius: 8px;
  padding: 4px 14px 10px;
  max-height: calc(100% - 112px);
  overflow-y: auto;
  backdrop-filter: blur(6px);
}
.panel h2 {
  font-size: 15px;
  color: #4dd2ff;
}
.panel h3 {
  font-size: 12px;
  margin: 8px 0 2px;
  color: #ffd34d;
}
.panel p {
  margin: 4px 0;
  font-size: 13px;
}
.muted {
  color: #7c93b5;
}
.toggle {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #9fb8dc;
  cursor: pointer;
}
.prio {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.prio button {
  padding: 4px 8px;
  font-size: 12px;
  color: #cfe6ff;
  text-transform: capitalize;
  background: rgba(10, 20, 40, 0.8);
  border: 1px solid #1f8fff66;
  border-radius: 6px;
  cursor: pointer;
}
.prio button.active {
  border-color: #ffd34d;
  background: rgba(255, 211, 77, 0.2);
}
.upgrade-levels {
  display: flex;
  gap: 5px;
  margin: 6px 0;
}
.upgrade-levels span {
  width: 18px;
  height: 18px;
  box-sizing: border-box;
  border: 1px solid #6aa8ff;
  border-radius: 3px;
  background: #0a1426;
}
.upgrade-levels span.filled {
  border-color: #ffd34d;
  background: #ffd34d;
}
.upgrades {
  display: grid;
  gap: 6px;
  margin: 6px 0;
}
.upgrades button {
  display: grid;
  gap: 4px;
  padding: 8px;
  text-align: left;
  color: #cfe6ff;
  background: rgba(10, 20, 40, 0.8);
  border: 1px solid #1f8fff88;
  border-radius: 6px;
  cursor: pointer;
}
.upgrades button span {
  color: #9fb8dc;
  font-size: 12px;
}
.upgrades button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.sell {
  margin: 6px 0;
  padding: 8px 12px;
  color: #fff;
  background: #8a2338;
  border: 1px solid #ff3b5c;
  border-radius: 6px;
  cursor: pointer;
}
.time {
  position: absolute;
  right: 12px;
  bottom: 32px;
  display: flex;
  gap: 6px;
}
.time button {
  min-width: 44px;
  height: 40px;
  color: #cfe6ff;
  background: rgba(10, 20, 40, 0.8);
  border: 1px solid #1f8fff66;
  border-radius: 8px;
  cursor: pointer;
}
.time button.active {
  border-color: #4dff9a;
  background: rgba(77, 255, 154, 0.15);
}
.time button.play-toggle {
  min-width: 90px;
  padding: 0 16px;
  color: #05190e;
  background: #4dff9a;
  border-color: #4dff9a;
  font-weight: 600;
}
.time button.play-toggle.running {
  color: #fff;
  background: #596575;
  border-color: #8491a1;
}
.wavebar {
  position: absolute;
  top: 130px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #9fe8ff;
}
.wavebar button {
  padding: 4px 10px;
  color: #cfe6ff;
  background: rgba(10, 20, 40, 0.8);
  border: 1px solid #1f8fff66;
  border-radius: 6px;
  cursor: pointer;
}
.overlay.victory h1 {
  color: #5dffb0;
}
.banner {
  position: absolute;
  top: 130px;
  left: 12px;
  font-size: 13px;
  color: #ffd34d;
  pointer-events: none;
}
.overlay {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(5, 7, 13, 0.78);
}
.overlay h1 {
  margin: 0;
  color: #ff3b5c;
}
.overlay button {
  padding: 12px 28px;
  font-size: 16px;
  color: #fff;
  background: #1f6fff;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.towers {
  position: absolute;
  top: 170px;
  left: 12px;
  display: flex;
  flex-direction: column;
  width: 150px;
  max-width: calc(100% - 24px);
  max-height: calc(100% - 370px);
  box-sizing: border-box;
  padding: 8px;
  background: rgba(10, 20, 40, 0.9);
  border: 1px solid #1f8fff55;
  border-radius: 8px;
  backdrop-filter: blur(6px);
}
.towers-heading {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0 2px 6px;
  font-size: 11px;
  color: #9fb8dc;
}
.towers-heading strong {
  color: #4dd2ff;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.tower-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}
.towers button {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding: 8px 10px;
  color: #cfe6ff;
  background: rgba(10, 20, 40, 0.8);
  border: 1px solid #1f8fff66;
  border-radius: 8px;
  cursor: pointer;
}
.towers button i {
  width: 22px;
  height: 22px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 10px var(--c);
}
.towers button small {
  color: #7c93b5;
}
.towers button.active {
  border-color: #ffd34d;
  background: rgba(255, 211, 77, 0.18);
}
.towers button.poor {
  border-color: #a9685d;
}
.towers button .unaffordable {
  color: #ff9a89;
}
.towers button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -3px;
}
.toast {
  position: absolute;
  top: 84px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  color: #ffd1d9;
  background: rgba(120, 20, 40, 0.85);
  border: 1px solid #ff3b5c;
  border-radius: 8px;
  pointer-events: none;
}
.camera-info {
  position: absolute;
  left: 12px;
  bottom: 96px;
  padding: 6px 8px;
  color: #cfe6ff;
  background: rgba(10, 20, 40, 0.9);
  border: 1px solid #1f8fff55;
  border-radius: 8px;
  font-size: 11px;
  user-select: text;
}
.camera-info pre {
  margin: 4px 0 0;
  font: inherit;
  white-space: pre-wrap;
}
.controls {
  position: absolute;
  left: 12px;
  bottom: 40px;
  display: flex;
  gap: 8px;
}
.controls button {
  width: 44px;
  height: 44px;
  font-size: 20px;
  color: #cfe6ff;
  background: rgba(10, 20, 40, 0.75);
  border: 1px solid #1f8fff88;
  border-radius: 8px;
  cursor: pointer;
}
.controls button:hover {
  background: rgba(31, 143, 255, 0.3);
}
.controls .view-preset {
  font-size: 14px;
}
.status {
  position: absolute;
  right: 12px;
  bottom: 8px;
  font-size: 12px;
  color: #7c93b5;
}
.help {
  position: absolute;
  left: 12px;
  bottom: 8px;
  font-size: 12px;
  color: #7c93b5;
}
.error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  background: #05070d;
}
.error h1 {
  color: #ff3b5c;
}
.error .hint {
  max-width: 520px;
  color: #7c93b5;
}
@media (max-width: 700px) {
  .time {
    bottom: 90px;
    max-width: calc(100% - 24px);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .camera-info {
    bottom: 190px;
  }
  .panel {
    top: auto;
    bottom: 100px;
    right: 12px;
    width: 180px;
  }
  .towers {
    width: 120px;
  }
  .panel {
    bottom: 300px;
  }
  .help {
    display: none;
  }
  .stat b {
    font-size: 16px;
  }
}
</style>
