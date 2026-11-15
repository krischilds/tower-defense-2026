import * as THREE from 'three/webgpu';
import type { Enemy } from '../sim/world';
import { getEnemyDef } from '../data/enemies';

interface Visual {
  root: THREE.Group;
  body: THREE.Object3D;
  bar: THREE.Group;
  fill: THREE.Mesh;
  bob: number;
  mat: THREE.MeshStandardMaterial;
}

const BAR_W = 0.7;

/** Draws sim enemies, keeping one mesh per live enemy id. */
export class EnemyRenderer {
  readonly group = new THREE.Group();
  private visuals = new Map<number, Visual>();
  private barBg = new THREE.PlaneGeometry(BAR_W + 0.06, 0.12);
  private barFill = new THREE.PlaneGeometry(BAR_W, 0.08).translate(BAR_W / 2, 0, 0);
  private bgMat = new THREE.MeshBasicMaterial({ color: 0x050810, depthTest: false, transparent: true, opacity: 0.8 });
  private fillMat = new THREE.MeshBasicMaterial({ color: 0x3dff9a, depthTest: false });

  constructor(private toWorld: (x: number, y: number, h: number) => THREE.Vector3) {}

  sync(enemies: readonly Enemy[], camera: THREE.Camera, time: number, simTime: number) {
    const live = new Set<number>();
    for (const e of enemies) {
      live.add(e.id);
      let v = this.visuals.get(e.id);
      if (!v) {
        v = this.create(e);
        this.visuals.set(e.id, v);
        this.group.add(v.root);
      }
      const def = getEnemyDef(e.defId);
      const h = 0.2 + def.scale * 0.55 + Math.sin(time * 6 + v.bob) * 0.04;
      v.root.position.copy(this.toWorld(e.x, e.y, 0));
      v.body.position.y = h;
      v.body.rotation.y = e.heading;
      v.body.rotation.x = Math.sin(time * 8 + v.bob) * 0.08;
      v.mat.emissiveIntensity = simTime - e.lastHit < 0.1 ? 2.6 : 0.55;
      const ratio = Math.max(0, e.health / e.maxHealth);
      v.bar.visible = ratio < 1;
      v.fill.scale.x = Math.max(ratio, 0.001);
      v.bar.quaternion.copy(camera.quaternion);
      v.bar.position.y = h + def.scale * 0.6 + 0.25;
    }
    for (const [id, v] of this.visuals) {
      if (live.has(id)) continue;
      this.group.remove(v.root);
      this.visuals.delete(id);
    }
  }

  private create(e: Enemy): Visual {
    const def = getEnemyDef(e.defId);
    const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.4 });
    const body = new THREE.Group();
    const s = def.scale;
    if (def.id === 'runner') {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28 * s * 1.6, 0.9 * s * 1.3, 4), mat);
      cone.rotation.x = Math.PI / 2;
      body.add(cone);
    } else if (def.id === 'tank') {
      body.add(new THREE.Mesh(new THREE.BoxGeometry(0.75 * s, 0.5 * s, 0.95 * s), mat));
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.25 * s, 0.25 * s, 8), mat);
      turret.position.y = 0.35 * s;
      body.add(turret);
    } else if (def.id === 'armored') {
      body.add(new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.7 * s, 0.7 * s), mat));
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.85 * s, 0.15 * s, 0.85 * s), mat);
      plate.position.y = 0.3 * s;
      body.add(plate);
    } else if (def.id === 'boss') {
      body.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 * s, 0), mat));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7 * s, 0.07 * s, 6, 20), mat);
      ring.rotation.x = Math.PI / 2;
      body.add(ring);
    } else {
      body.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.5 * s), mat));
    }

    const bar = new THREE.Group();
    const bg = new THREE.Mesh(this.barBg, this.bgMat);
    bg.renderOrder = 20;
    const fill = new THREE.Mesh(this.barFill, this.fillMat);
    fill.position.set(-BAR_W / 2, 0, 0.001);
    fill.renderOrder = 21;
    bar.add(bg, fill);

    const root = new THREE.Group();
    root.add(body, bar);
    return { root, body, bar, fill, bob: Math.random() * 6, mat };
  }
}
