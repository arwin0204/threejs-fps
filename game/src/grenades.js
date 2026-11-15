// Grenades and the bomb. A frag grenade is a small ballistic body: it arcs,
// bounces off colliders with damped velocity, then detonates after its fuse with
// radial damage that falls off with distance and is blocked by walls. The bomb
// (the "spike") is planted by holding E on a site, ticks a 35 s fuse with a
// beeping light, and is defused by an enemy holding the channel for 4 s.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createGrenades(scene, colliders) {
  const items = [];
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.5 });
  const probe = new THREE.Box3();

  function throwGrenade(origin, direction, power = 11) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    scene.add(mesh);
    const item = {
      mesh, vel: direction.clone().multiplyScalar(power).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 1.6, alive: true,
    };
    items.push(item);
    return item;
  }

  function overlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  // Returns detonation events {x, y, z} for main.js to resolve.
  function step(dt) {
    const booms = [];
    for (const item of items) {
      if (!item.alive) continue;
      item.fuse -= dt;
      item.vel.y -= 14 * dt;
      const p = item.mesh.position;
      const nx = p.x + item.vel.x * dt;
      const ny = p.y + item.vel.y * dt;
      const nz = p.z + item.vel.z * dt;
      if (overlaps(nx, p.y, p.z)) item.vel.x *= -0.45; else p.x = nx;
      if (overlaps(p.x, ny, p.z)) item.vel.y *= -0.45; else p.y = ny;
      if (overlaps(p.x, p.y, nz)) item.vel.z *= -0.45; else p.z = nz;
      if (p.y < 0.09) { p.y = 0.09; item.vel.y = Math.abs(item.vel.y) * 0.45; item.vel.x *= 0.8; item.vel.z *= 0.8; }
      if (item.fuse <= 0) {
        item.alive = false;
        scene.remove(item.mesh);
        booms.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    return booms;
  }

  return { throwGrenade, step, items };
}

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.4, metalness: 0.4 }),
  );
  body.position.y = 0.11;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  light.position.set(0.12, 0.26, 0);
  const glow = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 8);
  glow.position.y = 0.6;
  group.add(body, light, glow);
  group.visible = false;
  scene.add(group);
  return {
    group,
    plant(x, z) { group.position.set(x, 0, z); group.visible = true; },
    clear() { group.visible = false; },
    beep(on) { light.visible = on; glow.intensity = on ? 8 : 0; },
  };
}
