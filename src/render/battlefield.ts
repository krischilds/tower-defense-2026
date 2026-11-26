import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Grid, TileType } from '../sim/grid';
import type { Point } from '../sim/pathfinding';
import type { PlacedTower } from '../sim/world';
import { getEffectiveTowerDef, getTowerDef, type TowerKind } from '../data/towers';

const TILE = 1;
const GAP = 0.06;
const TILE_H = 0.2;
const BLOCK_H = 0.9;

const COLORS: Record<TileType, number> = {
  buildable: 0x16263d,
  blocked: 0x2a3550,
  spawn: 0xff3b5c,
  objective: 0x2bffb0,
};

export interface TileRef {
  x: number;
  y: number;
}

/** Renders a sim Grid as a 3D tile field. Tile (x, y) maps to world (x - w/2 + .5, 0, y - h/2 + .5). */
export class Battlefield {
  readonly group = new THREE.Group();
  private towerGroup = new THREE.Group();
  private pathGroup = new THREE.Group();
  private ghost = new THREE.Group();
  private ghostKey = '';
  private heads = new Map<number, THREE.Object3D>();
  private rangeRing: THREE.Mesh;
  private hover: THREE.Mesh;
  private select: THREE.Mesh;
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_H);
  private raycaster = new THREE.Raycaster();

  constructor(private grid: Grid) {
    this.buildBase();
    this.buildTiles();
    this.buildMarkers();
    this.hover = this.makeCursor(0x4dd2ff, 0.9);
    this.select = this.makeCursor(0xffd34d, 1.0);
    this.hover.visible = this.select.visible = false;
    const ring = new THREE.RingGeometry(0.97, 1, 64);
    ring.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.8, depthTest: false }));
    this.rangeRing.renderOrder = 9;
    this.rangeRing.visible = false;
    this.group.add(this.hover, this.select, this.towerGroup, this.pathGroup, this.ghost, this.rangeRing);
    this.ghost.visible = false;
  }

  tileToWorld(x: number, y: number, h = TILE_H): THREE.Vector3 {
    return new THREE.Vector3(x - this.grid.width / 2 + 0.5, h, y - this.grid.height / 2 + 0.5);
  }

  /** Returns the tile under a normalized-device-coordinate pointer, or null. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): TileRef | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    const x = Math.floor(hit.x + this.grid.width / 2);
    const y = Math.floor(hit.z + this.grid.height / 2);
    return this.grid.inBounds(x, y) ? { x, y } : null;
  }

  setHover(t: TileRef | null, color = 0x4dd2ff) {
    (this.hover.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.place(this.hover, t);
    this.ghost.visible = false;
  }

  /** Semi-transparent tower preview at a tile while in placement mode. */
  showGhost(t: TileRef | null, defId: string | null, valid: boolean) {
    if (!t || !defId) {
      this.ghost.visible = false;
      return;
    }
    const key = `${defId}:${valid}`;
    if (key !== this.ghostKey) {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      this.ghost.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        geometries.add(child.geometry);
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      this.ghost.clear();
      const def = getTowerDef(defId);
      this.ghost.add(this.makeTowerMesh(def.kind, valid ? def.color : 0xff3333, 0.45));
      this.ghostKey = key;
    }
    this.ghost.position.copy(this.tileToWorld(t.x, t.y, TILE_H));
    this.ghost.visible = true;
  }

  syncTowers(towers: PlacedTower[]) {
    this.towerGroup.clear();
    this.heads.clear();
    for (const t of towers) {
      const def = getEffectiveTowerDef(t);
      const m = this.makeTowerMesh(def.kind, def.color, 1);
      for (let level = 0; level < t.level; level++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.3 + level * 0.05, 0.035, 6, 16),
          new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.4, roughness: 0.5 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.28 + level * 0.15;
        m.add(ring);
      }
      m.position.copy(this.tileToWorld(t.x, t.y, TILE_H));
      m.userData.head.rotation.y = t.aim;
      this.heads.set(t.id, m.userData.head as THREE.Object3D);
      this.towerGroup.add(m);
    }
  }

  /** Synchronizes projectile heads and smoothly turns the other tower heads. */
  aimTowers(towers: readonly PlacedTower[], dt: number) {
    const k = 1 - Math.exp(-14 * dt);
    for (const t of towers) {
      const head = this.heads.get(t.id);
      if (!head) continue;
      const kind = getEffectiveTowerDef(t).kind;
      if (kind === 'projectile' || kind === 'missile') {
        head.rotation.y = t.aim;
        continue;
      }
      let d = t.aim - head.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      head.rotation.y += d * k;
    }
  }

  /** Muzzle position in world space for effects. */
  muzzle(t: PlacedTower): THREE.Vector3 {
    const p = this.tileToWorld(t.x, t.y, TILE_H + 0.62);
    p.x += Math.sin(t.aim) * 0.5;
    p.z += Math.cos(t.aim) * 0.5;
    return p;
  }

  /** Shows a flat range ring around a tile (null hides it). */
  setRange(t: TileRef | null, range: number, color = 0x4dd2ff) {
    this.rangeRing.visible = !!t;
    if (!t) return;
    this.rangeRing.position.copy(this.tileToWorld(t.x, t.y, TILE_H + 0.03));
    this.rangeRing.scale.setScalar(range);
    (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(color);
  }
  /** Draws the current enemy routes as a trail of glowing dots. */
  showRoutes(routes: Point[][]) {
    this.pathGroup.clear();
    const pts = routes.flat();
    if (!pts.length) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.04, 0.16),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85 }),
      pts.length,
    );
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.setPosition(this.tileToWorld(p.x, p.y, TILE_H + 0.03));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.pathGroup.add(mesh);
  }

  setPathVisible(v: boolean) {
    this.pathGroup.visible = v;
  }

  private makeTowerMesh(kind: TowerKind, color: number, opacity: number) {
    const g = new THREE.Group();
    const transparent = opacity < 1;
    const body = new THREE.MeshStandardMaterial({ color: 0x596573, metalness: 0.65, roughness: 0.5, transparent, opacity });
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, metalness: 0.25, roughness: 0.5, transparent, opacity });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.25, 24), body);
    base.position.y = 0.125;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 20), glow);
    core.position.y = 0.4;
    const head = new THREE.Group();
    head.position.y = 0.62;
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12), body));
    if (kind === 'projectile') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 0.55, 16), body);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.28;
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), glow);
      brake.rotation.x = Math.PI / 2;
      brake.position.z = 0.55;
      head.add(barrel, brake);
    } else if (kind === 'missile') {
      const launcher = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.3, 0.55, 3, 0.06), body);
      launcher.position.z = 0.2;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 16), glow);
      tube.rotation.x = Math.PI / 2;
      tube.position.z = 0.3;
      head.add(launcher, tube);
    } else if (kind === 'beam') {
      const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 16), body);
      emitter.rotation.x = Math.PI / 2;
      emitter.position.z = 0.3;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), glow);
      lens.position.z = 0.56;
      head.add(emitter, lens);
    } else {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 12, 24), glow);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 0.2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 16), body);
      spike.position.y = 0.42;
      head.add(coil, spike);
    }
    g.userData.head = head;
    g.add(base, core, head);
    return g;
  }
  setSelected(t: TileRef | null) {
    this.place(this.select, t);
  }

  update(time: number) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    this.select.scale.setScalar(1 + pulse * 0.04);
    this.group.children.forEach((c) => {
      if (c.userData.spin) c.rotation.y = time * 0.8;
      if (c.userData.bob) c.position.y = c.userData.baseY + Math.sin(time * 2) * 0.1;
    });
  }

  private place(m: THREE.Mesh, t: TileRef | null) {
    m.visible = !!t;
    if (!t) return;
    const tile = this.grid.get(t.x, t.y)!;
    const h = tile.type === 'blocked' ? BLOCK_H : TILE_H;
    m.position.copy(this.tileToWorld(t.x, t.y, h + 0.02));
  }

  private makeCursor(color: number, opacity: number) {
    const outer = TILE * 0.5;
    const inner = outer - 0.08;
    const shape = new THREE.Shape();
    shape.moveTo(-outer, -outer);
    shape.lineTo(outer, -outer);
    shape.lineTo(outer, outer);
    shape.lineTo(-outer, outer);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-inner, -inner);
    hole.lineTo(-inner, inner);
    hole.lineTo(inner, inner);
    hole.lineTo(inner, -inner);
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    return mesh;
  }

  private buildBase() {
    const w = this.grid.width + 1.2;
    const h = this.grid.height + 1.2;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.3, h),
      new THREE.MeshStandardMaterial({ color: 0x070b14, metalness: 0.8, roughness: 0.4 }),
    );
    base.position.y = -0.17;
    this.group.add(base);

    // Glowing rim
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.06, h + 0.2),
      new THREE.MeshBasicMaterial({ color: 0x1f8fff }),
    );
    rim.position.y = -0.3;
    this.group.add(rim);
  }

  private buildTiles() {
    const tiles = this.grid.all();
    const geo = new THREE.BoxGeometry(TILE - GAP, 1, TILE - GAP);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.45 });
    const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    tiles.forEach((t, i) => {
      const h = t.type === 'blocked' ? BLOCK_H : TILE_H;
      const p = this.tileToWorld(t.x, t.y, 0);
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      mesh.setMatrixAt(i, m);
      c.setHex(COLORS[t.type]);
      // subtle checker variation for readability
      if ((t.x + t.y) % 2 === 0 && t.type === 'buildable') c.multiplyScalar(1.25);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildMarkers() {
    for (const t of this.grid.find('spawn')) this.marker(t, 0xff3b5c, new THREE.OctahedronGeometry(0.3));
    for (const t of this.grid.find('objective')) this.marker(t, 0x2bffb0, new THREE.IcosahedronGeometry(0.35));
    for (const t of this.grid.all().filter((t) => t.type === 'blocked')) {
      const crystal = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.5, 5),
        new THREE.MeshStandardMaterial({ color: 0x6a8cff, emissive: 0x2b4cff, emissiveIntensity: 0.8 }),
      );
      crystal.position.copy(this.tileToWorld(t.x, t.y, BLOCK_H + 0.25));
      this.group.add(crystal);
    }
  }

  private marker(t: TileRef, color: number, geo: THREE.BufferGeometry) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
    const p = this.tileToWorld(t.x, t.y, TILE_H + 0.6);
    mesh.position.copy(p);
    mesh.userData = { spin: true, bob: true, baseY: p.y };
    const light = new THREE.PointLight(color, 6, 5);
    light.position.set(0, 0.3, 0);
    mesh.add(light);
    this.group.add(mesh);
  }
}
