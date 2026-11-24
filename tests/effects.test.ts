import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { EffectsRenderer } from '../src/render/effects';
import { Grid } from '../src/sim/grid';
import { updateCombat } from '../src/sim/combat';
import { World } from '../src/sim/world';

describe('cannon projectiles', () => {
  it('points the bullet-shaped shell toward its target until impact', () => {
    const world = new World(Grid.fromMap({ id: 't', name: 't', rows: ['S.........O', '...........'] }), 1000);
    world.placeTower('cannon', 6, 1);
    world.spawnEnemy('basic', { x: 9, y: 0 });
    const effects = new EffectsRenderer((x, y, h) => new THREE.Vector3(x, h, y), () => new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera();

    updateCombat(world, 0.01);
    effects.update(world, 0.01, camera);
    const shell = effects.group.children.find(
      (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.LatheGeometry,
    );
    if (!shell) throw new Error('Expected a visible cannon shell');
    const projectile = world.projectiles[0];
    const forward = () => new THREE.Vector3(0, 1, 0).applyQuaternion(shell.quaternion);
    const expected = new THREE.Vector3(projectile.tx - projectile.x, 0, projectile.ty - projectile.y).normalize();
    expect(forward().distanceTo(expected)).toBeLessThan(0.00001);

    projectile.tx = projectile.x;
    projectile.ty = projectile.y + 1;
    effects.update(world, 0.01, camera);
    expect(forward().distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(0.00001);

    updateCombat(world, 0.5);
    effects.update(world, 0.01, camera);
    expect(effects.group.children).not.toContain(shell);
    effects.dispose();
  });
});

describe('missile smoke', () => {
  it('points the missile nose toward its target and removes it on impact', () => {
    const world = new World(Grid.fromMap({ id: 't', name: 't', rows: ['S.........O', '...........'] }), 1000);
    world.placeTower('missile', 5, 1);
    world.spawnEnemy('basic', { x: 9, y: 0 });
    const effects = new EffectsRenderer((x, y, h) => new THREE.Vector3(x, h, y), () => new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera();

    updateCombat(world, 0.01);
    effects.update(world, 0.01, camera);
    const missile = effects.group.getObjectByName('missile');
    if (!missile) throw new Error('Expected a visible missile');
    const nose = missile.children.find((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.ConeGeometry);
    expect(nose?.position.y).toBeGreaterThan(0);
    const projectile = world.projectiles[0];
    const expected = new THREE.Vector3(projectile.tx - projectile.x, 0, projectile.ty - projectile.y).normalize();
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(missile.quaternion).distanceTo(expected)).toBeLessThan(0.00001);

    projectile.tx = projectile.x;
    projectile.ty = projectile.y + 1;
    effects.update(world, 0.01, camera);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(missile.quaternion).distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(0.00001);

    updateCombat(world, 0.5);
    effects.update(world, 0.01, camera);
    expect(effects.group.getObjectByName('missile')).toBeUndefined();
    effects.dispose();
  });

  it('follows simulation travel and includes a missile that impacts between frames', () => {
    const w = new World(Grid.fromMap({ id: 't', name: 't', rows: ['S.........O', '...........'] }), 1000);
    w.placeTower('missile', 5, 1);
    w.spawnEnemy('basic', { x: 9, y: 0 });
    const effects = new EffectsRenderer((x, y, h) => new THREE.Vector3(x, h, y), () => new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera();
    camera.rotation.set(-0.5, 0.3, 0);
    const particles = effects.group.children.find(
      (child) => child instanceof THREE.InstancedMesh
        && child.material instanceof THREE.MeshBasicMaterial
        && child.material.blending === THREE.NormalBlending,
    ) as THREE.InstancedMesh;
    expect(particles).toBeInstanceOf(THREE.InstancedMesh);
    if (Array.isArray(particles.material) || !(particles.material instanceof THREE.MeshBasicMaterial)) {
      throw new Error('Expected a smoke material');
    }
    expect(particles.material.transparent).toBe(true);
    expect(particles.material.depthWrite).toBe(false);
    const texture = particles.material.map;
    if (!(texture instanceof THREE.DataTexture) || !(texture.image.data instanceof Uint8Array)) {
      throw new Error('Expected a smoke texture');
    }
    const pixels = texture.image.data;
    expect(pixels[3]).toBe(0);
    expect(pixels[(32 * 64 + 32) * 4 + 3]).toBeGreaterThan(0);
    const matrix = new THREE.Matrix4();
    const visibleSmoke = () => {
      let count = 0;
      for (let i = 0; i < particles!.count; i++) {
        particles!.getMatrixAt(i, matrix);
        if (new THREE.Vector3().setFromMatrixScale(matrix).x > 0) count++;
      }
      return count;
    };

    updateCombat(w, 0.2);
    effects.update(w, 0.01, camera);
    const first = visibleSmoke();
    expect(first).toBeGreaterThan(1);
    const sparks = effects.group.children.find(
      (child) => child instanceof THREE.InstancedMesh
        && child.material instanceof THREE.MeshBasicMaterial
        && child.material.blending === THREE.AdditiveBlending,
    );
    if (!(sparks instanceof THREE.InstancedMesh) || !(sparks.material instanceof THREE.MeshBasicMaterial)) {
      throw new Error('Expected soft spark particles');
    }
    expect(sparks.material.transparent).toBe(true);
    expect(sparks.material.depthWrite).toBe(false);
    expect(sparks.material.map).toBe(texture);
    sparks.getMatrixAt(0, matrix);
    const sparkScale = new THREE.Vector3();
    const sparkRotation = new THREE.Quaternion();
    matrix.decompose(new THREE.Vector3(), sparkRotation, sparkScale);
    expect(sparkScale.x).toBeGreaterThan(0);
    expect(Math.abs(sparkRotation.dot(camera.quaternion))).toBeCloseTo(1);
    for (let i = 0; i < particles.count; i++) {
      particles.getMatrixAt(i, matrix);
      if (new THREE.Vector3().setFromMatrixScale(matrix).x === 0) continue;
      const rotation = new THREE.Quaternion();
      matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
      expect(Math.abs(rotation.dot(camera.quaternion))).toBeCloseTo(1);
      break;
    }
    effects.update(w, 0.01, camera);
    expect(visibleSmoke()).toBe(first);
    updateCombat(w, 0.5);
    expect(w.projectiles).toHaveLength(0);
    effects.update(w, 0.01, camera);
    expect(visibleSmoke()).toBeGreaterThan(first);
  });
});
