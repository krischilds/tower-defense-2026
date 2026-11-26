import * as THREE from 'three/webgpu';
import type { World } from '../sim/world';
import type { GameEvent } from '../sim/types';
import { getEffectiveTowerDef } from '../data/towers';

const MAX_PARTICLES = 400;
const UP = new THREE.Vector3(0, 1, 0);
const SMOKE_SPACING = 0.2;

interface Bolt {
  meshes: THREE.Mesh[];
  ttl: number;
}

/** Projectiles, beams, lightning and particles. Purely visual; driven by sim state and events. */
export class EffectsRenderer {
  readonly group = new THREE.Group();
  private projectiles = new Map<number, THREE.Object3D>();
  private beams = new Map<number, THREE.Mesh>();
  private bolts: Bolt[] = [];
  private mats = new Map<number, THREE.MeshBasicMaterial>();
  private shellMats = new Map<number, THREE.MeshStandardMaterial>();
  private missileMats = new Map<number, THREE.MeshBasicMaterial>();
  private unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  private shell = new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.17),
    new THREE.Vector2(0.045, -0.17),
    new THREE.Vector2(0.05, -0.15),
    new THREE.Vector2(0.05, 0.04),
    new THREE.Vector2(0.047, 0.09),
    new THREE.Vector2(0.035, 0.15),
    new THREE.Vector2(0.02, 0.2),
    new THREE.Vector2(0, 0.23),
  ], 16);
  private missileBody = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 16);
  private missileNose = new THREE.ConeGeometry(0.08, 0.17, 16);
  private missileFin: THREE.ExtrudeGeometry;
  private missileBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xaab4bc, metalness: 0.6, roughness: 0.45, transparent: true, depthTest: false, depthWrite: false,
  });
  private smokeDistance = new Map<number, number>();

  private particles: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private smokeParticles: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private smokeTexture: THREE.DataTexture;
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pMax = new Float32Array(MAX_PARTICLES);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pSmoke = new Uint8Array(MAX_PARTICLES);
  private pNext = 0;
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();

  constructor(
    private toWorld: (x: number, y: number, h: number) => THREE.Vector3,
    private muzzle: (t: import('../sim/world').PlacedTower) => THREE.Vector3,
  ) {
    const fin = new THREE.Shape();
    fin.moveTo(0.065, -0.14);
    fin.lineTo(0.19, -0.19);
    fin.lineTo(0.07, 0.015);
    fin.closePath();
    this.missileFin = new THREE.ExtrudeGeometry(fin, { depth: 0.015, bevelEnabled: false });
    this.missileFin.translate(0, 0, -0.0075);

    const textureSize = 64;
    const pixels = new Uint8Array(textureSize * textureSize * 4);
    for (let y = 0; y < textureSize; y++) {
      for (let x = 0; x < textureSize; x++) {
        const distance = Math.hypot((x + 0.5) / textureSize * 2 - 1, (y + 0.5) / textureSize * 2 - 1);
        const alpha = Math.max(0, 1 - distance);
        const offset = (y * textureSize + x) * 4;
        pixels.set([255, 255, 255, Math.round(alpha * alpha * 180)], offset);
      }
    }
    this.smokeTexture = new THREE.DataTexture(pixels, textureSize, textureSize);
    this.smokeTexture.magFilter = THREE.LinearFilter;
    this.smokeTexture.minFilter = THREE.LinearFilter;
    this.smokeTexture.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this.smokeTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_PARTICLES);
    this.particles.frustumCulled = false;
    this.particles.count = MAX_PARTICLES;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.setColorAt(i, this.tmpC.setHex(0xffffff));
    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x89929a,
      map: this.smokeTexture,
      transparent: true,
      depthWrite: false,
    });
    this.smokeParticles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smokeMaterial, MAX_PARTICLES);
    this.smokeParticles.frustumCulled = false;
    this.smokeParticles.count = MAX_PARTICLES;
    this.hideAll();
    this.group.add(this.particles);
    this.group.add(this.smokeParticles);
  }

  update(world: World, dt: number, camera: THREE.Camera) {
    for (const ev of world.drainEvents()) this.handle(ev);
    this.syncProjectiles(world);
    const liveMissiles = new Set(world.projectiles.filter((p) => p.kind === 'missile').map((p) => p.id));
    for (const id of this.smokeDistance.keys()) if (!liveMissiles.has(id)) this.smokeDistance.delete(id);
    this.syncBeams(world);
    this.updateBolts(dt);
    this.updateParticles(dt, camera);
  }

  dispose() {
    this.shell.dispose();
    this.shellMats.forEach((material) => material.dispose());
    this.missileMats.forEach((material) => material.dispose());
    this.missileBody.dispose();
    this.missileNose.dispose();
    this.missileFin.dispose();
    this.missileBodyMaterial.dispose();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
    this.smokeParticles.geometry.dispose();
    this.smokeParticles.material.dispose();
    this.smokeTexture.dispose();
  }

  private material(color: number) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.mats.set(color, m);
    }
    return m;
  }

  private shellMaterial(color: number) {
    let m = this.shellMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4, transparent: true, depthTest: false, depthWrite: false });
      this.shellMats.set(color, m);
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
        const p = this.toWorld(ev.x, ev.y, ev.blocked ? 1 : 0.45);
        this.burst(p, ev.color, ev.big ? 22 : 8, ev.big ? 3.5 : 2, ev.big ? 0.09 : 0.06);
        break;
      }
      case 'death': {
        const p = this.toWorld(ev.x, ev.y, 0.5);
        this.burst(p, ev.color, 24, 3.5, 0.1);
        this.burst(p, 0xffffff, 8, 2, 0.07);
        break;
      }
      case 'missileTrail': {
        const from = this.toWorld(ev.from.x, ev.from.y, 0.8);
        const to = this.toWorld(ev.to.x, ev.to.y, 0.8);
        const length = from.distanceTo(to);
        if (!this.smokeDistance.has(ev.id)) this.smoke(from);
        let next = SMOKE_SPACING - (this.smokeDistance.get(ev.id) ?? 0);
        while (next <= length) {
          this.smoke(from.clone().lerp(to, next / length));
          next += SMOKE_SPACING;
        }
        this.smokeDistance.set(ev.id, SMOKE_SPACING - (next - length));
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

  private makeMissile(color: number): THREE.Group {
    const missile = new THREE.Group();
    missile.name = 'missile';
    let accent = this.missileMats.get(color);
    if (!accent) {
      accent = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false });
      this.missileMats.set(color, accent);
    }
    const body = new THREE.Mesh(this.missileBody, this.missileBodyMaterial);
    const nose = new THREE.Mesh(this.missileNose, accent);
    nose.position.y = 0.235;
    missile.add(body, nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(this.missileFin, accent);
      fin.rotation.y = i * Math.PI / 2;
      missile.add(fin);
    }
    return missile;
  }

  private syncProjectiles(world: World) {
    const live = new Set<number>();
    for (const p of world.projectiles) {
      live.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = p.kind === 'missile' ? this.makeMissile(p.color) : new THREE.Mesh(this.shell, this.shellMaterial(p.color));
        m.traverse((object) => {
          if (object instanceof THREE.Mesh) object.renderOrder = 100;
        });
        this.projectiles.set(p.id, m);
        this.group.add(m);
      }
      m.position.copy(this.toWorld(p.x, p.y, 0.8));
      this.tmpV.set(p.dx, 0, p.dy).normalize();
      if (this.tmpV.lengthSq() > 0) m.quaternion.setFromUnitVectors(UP, this.tmpV);
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
      this.pSmoke[i] = 0;
      this.tmpM.makeScale(0, 0, 0);
      this.smokeParticles.setMatrixAt(i, this.tmpM);
      this.particles.setColorAt(i, this.tmpC);
    }
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  private smoke(at: THREE.Vector3) {
    const i = this.pNext++ % MAX_PARTICLES;
    this.pPos.set([at.x, at.y, at.z], i * 3);
    this.pVel.set([(Math.random() - 0.5) * 0.15, 0.3 + Math.random() * 0.2, (Math.random() - 0.5) * 0.15], i * 3);
    this.pMax[i] = this.pLife[i] = 0.6 + Math.random() * 0.3;
    this.pSize[i] = 0.11 + Math.random() * 0.05;
    this.pSmoke[i] = 1;
    this.tmpM.makeScale(0, 0, 0);
    this.particles.setMatrixAt(i, this.tmpM);
  }

  private hideAll() {
    this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.setMatrixAt(i, this.tmpM);
      this.smokeParticles.setMatrixAt(i, this.tmpM);
    }
    this.particles.instanceMatrix.needsUpdate = true;
    this.smokeParticles.instanceMatrix.needsUpdate = true;
  }

  private updateParticles(dt: number, camera: THREE.Camera) {
    camera.getWorldQuaternion(this.tmpQ);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const o = i * 3;
      if (!this.pSmoke[i]) this.pVel[o + 1] -= 7 * dt;
      this.pPos[o] += this.pVel[o] * dt;
      this.pPos[o + 1] = Math.max(0.2, this.pPos[o + 1] + this.pVel[o + 1] * dt);
      this.pPos[o + 2] += this.pVel[o + 2] * dt;
      const remaining = Math.max(0, this.pLife[i] / this.pMax[i]);
      const s = this.pSize[i] * remaining * (this.pSmoke[i] ? 1 + (1 - remaining) * 2 : 1);
      this.tmpM.compose(
        this.tmpV.set(this.pPos[o], this.pPos[o + 1], this.pPos[o + 2]),
        this.tmpQ,
        this.tmpScale.set(s * 2, s * 2, s * 2),
      );
      if (this.pSmoke[i]) {
        this.smokeParticles.setMatrixAt(i, this.tmpM);
      } else {
        this.particles.setMatrixAt(i, this.tmpM);
      }
    }
    this.particles.instanceMatrix.needsUpdate = true;
    this.smokeParticles.instanceMatrix.needsUpdate = true;
  }
}
