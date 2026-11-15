import * as THREE from 'three/webgpu';
import { Battlefield, type TileRef } from './battlefield';
import { CameraController } from './cameraController';
import { EnemyRenderer } from './enemyRenderer';
import { EffectsRenderer } from './effects';
import { getEffectiveTowerDef, getTowerDef } from '../data/towers';
import { createWebGPURenderer } from './webgpu';
import type { World } from '../sim/world';

export interface RenderCallbacks {
  onHover(t: TileRef | null): void;
  onTap(t: TileRef | null): void;
  onFps(fps: number): void;
  onCameraInfo(info: string): void;
  /** Called every rendered frame with real elapsed seconds, before drawing. */
  onFrame(dt: number): void;
}

export class GameRenderer {
  private renderer!: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private controls!: CameraController;
  private field!: Battlefield;
  private enemyView!: EnemyRenderer;
  private effects!: EffectsRenderer;
  private selectedTile: TileRef | null = null;
  private placing: string | null = null;
  private hovered: TileRef | null = null;
  private seenVersion = -1;
  private showPath = true;
  private last = performance.now();
  private elapsed = 0;
  private frames = 0;
  private fpsTime = 0;
  private lastCameraInfo = '';
  private resizeObs!: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private cb: RenderCallbacks,
  ) {}

  async start() {
    this.renderer = await createWebGPURenderer(this.canvas);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.Fog(0x05070d, 35, 80);

    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a0f1e, 1.2));
    const sun = new THREE.DirectionalLight(0xbfd8ff, 2.2);
    sun.position.set(-8, 16, 6);
    this.scene.add(sun);

    this.field = new Battlefield(this.world.grid);
    this.scene.add(this.field.group);
    this.enemyView = new EnemyRenderer((x, y, h) => this.field.tileToWorld(x, y, h));
    this.scene.add(this.enemyView.group);
    this.effects = new EffectsRenderer((x, y, h) => this.field.tileToWorld(x, y, h), (t) => this.field.muzzle(t));
    this.scene.add(this.effects.group);

    this.controls = new CameraController(this.camera, this.canvas);
    this.controls.onHover = (x, y) => this.cb.onHover(this.pickAt(x, y));
    this.controls.onTap = (x, y) => this.cb.onTap(this.pickAt(x, y));
    this.canvas.addEventListener('pointerleave', () => this.cb.onHover(this.pickAt(-1e6, -1e6)));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  rotate(dYaw: number) {
    this.controls.rotate(dYaw);
  }
  thirdPersonView() {
    this.controls?.thirdPersonView();
  }
  zoom(f: number) {
    this.controls.zoom(f);
  }
  /** Exposed for diagnostics/tests. */
  get backendName() {
    return 'WebGPU';
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private pickAt(clientX: number, clientY: number): TileRef | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this.hovered = this.field.pick(ndc, this.camera);
    this.refreshHover();
    return this.hovered;
  }

  /** Enter/leave tower placement mode (null = off). */
  setPlacing(defId: string | null) {
    this.placing = defId;
    this.refreshHover();
  }

  setSelected(t: TileRef | null) {
    this.selectedTile = t;
    this.field.setSelected(t);
    this.refreshHover();
  }

  setPathVisible(v: boolean) {
    this.showPath = v;
    this.field.setPathVisible(v);
  }

  private refreshHover() {
    const t = this.hovered;
    if (!this.placing || !t) {
      this.field.setHover(t);
      const sel = this.selectedTile && !this.placing ? this.world.towerAt(this.selectedTile.x, this.selectedTile.y) : undefined;
      this.field.setRange(sel ? this.selectedTile : null, sel ? getEffectiveTowerDef(sel).range : 0, 0xffd34d);
      return;
    }
    const valid = this.world.checkPlacement(t.x, t.y) === null;
    this.field.setHover(t, valid ? 0x4dff9a : 0xff3b5c);
    this.field.showGhost(t, this.placing, valid);
    this.field.setRange(t, getTowerDef(this.placing).range, valid ? 0x4dff9a : 0xff3b5c);
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the board in view on narrow (portrait/mobile) screens.
    this.camera.fov = w / h < 1 ? 55 : 40;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.elapsed += dt;
    const t = this.elapsed;
    this.cb.onFrame(dt);
    this.controls.update(dt);
    const cameraInfo = this.controls.getDebugInfo();
    if (cameraInfo !== this.lastCameraInfo) {
      this.lastCameraInfo = cameraInfo;
      this.cb.onCameraInfo(cameraInfo);
    }
    this.enemyView.sync(this.world.enemies, this.camera, t, this.world.time);
    this.field.aimTowers(this.world.allTowers(), dt);
    this.effects.update(this.world, dt);
    if (this.seenVersion !== this.world.version) {
      this.seenVersion = this.world.version;
      this.field.syncTowers(this.world.allTowers());
      this.field.showRoutes(this.world.routes());
      this.field.setPathVisible(this.showPath);
      this.refreshHover();
    }
    this.field.update(t);
    this.renderer.render(this.scene, this.camera);

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.cb.onFps(Math.round(this.frames / this.fpsTime));
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}
