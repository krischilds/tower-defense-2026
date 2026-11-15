import * as THREE from 'three/webgpu';
import type { World } from '../sim/world';
import type { GameEvent } from '../sim/types';
import { getEffectiveTowerDef } from '../data/towers';

const MAX_PARTICLES = 400;
const UP = new THREE.Vector3(0, 1, 0);

interface Bolt {
  meshes: THREE.Mesh[];
  ttl: number;
}

/** Projectiles, beams, lightning and particles. Purely visual; driven by sim state and events. */
export class EffectsRenderer {
  readonly group = new THREE.Group();
  private projectiles = new Map<number, THREE.Mesh>();
  private beams = new Map<number, THREE.Mesh>();
  private bolts: Bolt[] = [];
  private mats = new Map<number, THREE.MeshBasicMaterial>();
  private unitCyl = new THREE.CylinderGeometry(1, 1, 1, 6);
  private shell = new THREE.SphereGeometry(0.11, 10, 8);

  private particles: THREE.InstancedMesh;
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pMax = new Float32Array(MAX_PARTICLES);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pNext = 0;
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(
    private toWorld: (x: number, y: number, h: number) => THREE.Vector3,
    private muzzle: (t: import('../sim/world').PlacedTower) => THREE.Vector3,
  ) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_PARTICLES);
    this.particles.frustumCulled = false;
    this.particles.count = MAX_PARTICLES;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.setColorAt(i, this.tmpC.setHex(0xffffff));
    this.hideAll();
    this.group.add(this.particles);
  }

  update(world: World, dt: number) {
    for (const ev of world.drainEvents()) this.handle(ev);
    this.syncProjectiles(world);
    this.syncBeams(world);
    this.updateBolts(dt);
    this.updateParticles(dt);
  }

  private material(color: number) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.mats.set(color, m);
    }
    return m;
  }

  private handle(ev: GameEvent) {
    switch (ev.type) {
      case 'shot': {
        const p = this.toWorld(ev.x, ev.y, 0.85);
        this.burst(p, ev.color, 4, 1.5, 0.05);
        break;
      }
      case 'hit': {
        const p = this.toWorld(ev.x, ev.y, 0.45);
        this.burst(p, ev.color, ev.big ? 22 : 8, ev.big ? 3.5 : 2, ev.big ? 0.09 : 0.06);
        break;
      }
      case 'death': {
        const p = this.toWorld(ev.x, ev.y, 0.5);
        this.burst(p, ev.color, 24, 3.5, 0.1);
        this.burst(p, 0xffffff, 8, 2, 0.07);
        break;
      }
      case 'chain': {
        const pts = ev.points.map((q, i) => this.toWorld(q.x, q.y, i === 0 ? 0.85 : 0.5));
        const meshes: THREE.Mesh[] = [];
        for (let i = 0; i + 1 < pts.length; i++) {
          let prev = pts[i];
          const steps = 4;
          for (let s = 1; s <= steps; s++) {
            const next = pts[i + 1].clone().lerp(pts[i], 1 - s / steps);
            if (s < steps) next.add(this.tmpV.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
            const m = new THREE.Mesh(this.unitCyl, this.material(0xbff3ff));
            this.place(m, prev, next, 0.03);
            this.group.add(m);
            meshes.push(m);
            prev = next;
          }
          this.burst(pts[i + 1], ev.color, 4, 1.5, 0.05);
        }
        this.bolts.push({ meshes, ttl: 0.12 });
        break;
      }
    }
  }

  private place(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
    const len = a.distanceTo(b);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(radius, Math.max(len, 0.001), radius);
    this.tmpV.copy(b).sub(a).normalize();
    m.quaternion.copy(this.tmpQ.setFromUnitVectors(UP, this.tmpV));
  }

  private syncProjectiles(world: World) {
    const live = new Set<number>();
    for (const p of world.projectiles) {
      live.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.shell, this.material(p.color));
        this.projectiles.set(p.id, m);
        this.group.add(m);
      }
      m.position.copy(this.toWorld(p.x, p.y, 0.8));
    }
    for (const [id, m] of this.projectiles) {
      if (live.has(id)) continue;
      this.group.remove(m);
      this.projectiles.delete(id);
    }
  }

  private syncBeams(world: World) {
    const byId = new Map(world.enemies.map((e) => [e.id, e]));
    const active = new Set<number>();
    for (const t of world.allTowers()) {
      const def = getEffectiveTowerDef(t);
      const target = t.firing && t.targetId !== null ? byId.get(t.targetId) : undefined;
      if (def.kind !== 'beam' || !target) continue;
      active.add(t.id);
      let m = this.beams.get(t.id);
      if (!m) {
        m = new THREE.Mesh(this.unitCyl, this.material(def.color));
        this.beams.set(t.id, m);
        this.group.add(m);
      }
      m.material = this.material(def.color);
      this.place(m, this.muzzle(t), this.toWorld(target.x, target.y, 0.5), 0.035 + Math.random() * 0.015);
      if (Math.random() < 0.5) this.burst(this.toWorld(target.x, target.y, 0.5), def.color, 1, 1.2, 0.04);
    }
    for (const [id, m] of this.beams) {
      if (active.has(id)) continue;
      this.group.remove(m);
      this.beams.delete(id);
    }
  }

  private updateBolts(dt: number) {
    this.bolts = this.bolts.filter((b) => {
      b.ttl -= dt;
      if (b.ttl > 0) return true;
      b.meshes.forEach((m) => this.group.remove(m));
      return false;
    });
  }

  private burst(at: THREE.Vector3, color: number, n: number, speed: number, size: number) {
    this.tmpC.setHex(color);
    for (let k = 0; k < n; k++) {
      const i = this.pNext++ % MAX_PARTICLES;
      this.pPos.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pVel.set([Math.cos(a) * s, up * s, Math.sin(a) * s], i * 3);
      this.pMax[i] = this.pLife[i] = 0.35 + Math.random() * 0.35;
      this.pSize[i] = size * (0.7 + Math.random() * 0.6);
      this.particles.setColorAt(i, this.tmpC);
    }
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  private hideAll() {
    this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.setMatrixAt(i, this.tmpM);
    this.particles.instanceMatrix.needsUpdate = true;
  }

  private updateParticles(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const o = i * 3;
      this.pVel[o + 1] -= 7 * dt;
      this.pPos[o] += this.pVel[o] * dt;
      this.pPos[o + 1] = Math.max(0.2, this.pPos[o + 1] + this.pVel[o + 1] * dt);
      this.pPos[o + 2] += this.pVel[o + 2] * dt;
      const s = this.pLife[i] > 0 ? this.pSize[i] * (this.pLife[i] / this.pMax[i]) : 0;
      this.tmpM.makeScale(s, s, s).setPosition(this.pPos[o], this.pPos[o + 1], this.pPos[o + 2]);
      this.particles.setMatrixAt(i, this.tmpM);
    }
    this.particles.instanceMatrix.needsUpdate = true;
  }
}
