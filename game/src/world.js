// MERIDIAN YARD — an original freight-yard map, 46 x 34 m, three lanes.
//   A site (west, -18, -10)  ·  B site (east, 18, -10)  ·  Mid (0, 0)
// Vanguard spawns south (z +13), Ember spawns north (z -13). Containers, crates,
// a gantry bridge and stacked pallets make lanes, corners and sightlines; every
// box is both a collider and a surface bullets stop on. Waypoints form the graph
// the bots walk: spawn -> lanes -> sites, with hold nodes at each site.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { x: -18, z: -10, r: 4.2 },
  B: { x: 18, z: -10, r: 4.2 },
};
export const SPAWNS = {
  vanguard: [[-4, 13], [0, 14], [4, 13]],
  ember: [[-4, -13], [0, -14], [4, -13], [-8, -12]],
};

// Waypoint graph: id -> {x, z, links:[ids]}. Bots walk it; holds are site guards.
export const WAYPOINTS = [
  { id: 0, x: 0, z: 13, links: [1, 2, 3] },       // vanguard spawn
  { id: 1, x: -10, z: 8, links: [0, 4, 5] },      // west lane
  { id: 2, x: 0, z: 4, links: [0, 6, 7] },        // mid
  { id: 3, x: 10, z: 8, links: [0, 8, 9] },       // east lane
  { id: 4, x: -16, z: 2, links: [1, 10] },
  { id: 5, x: -8, z: -2, links: [1, 6, 10] },
  { id: 6, x: 0, z: -2, links: [2, 5, 7, 11] },   // mid crossing
  { id: 7, x: 8, z: -2, links: [2, 6, 12] },
  { id: 8, x: 16, z: 2, links: [3, 12] },
  { id: 9, x: 10, z: -6, links: [3, 7, 12] },
  { id: 10, x: -18, z: -8, links: [4, 5, 11], hold: 'A' }, // A site
  { id: 11, x: -6, z: -10, links: [6, 10, 12], hold: null }, // A connector
  { id: 12, x: 18, z: -8, links: [7, 8, 9, 11], hold: 'B' }, // B site
  { id: 13, x: 0, z: -13, links: [11, 12] },      // ember spawn
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = {};
  for (const name of ['canvas', 'surface', 'hairline', 'ink', 'muted', 'accent', 'teal', 'ember']) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const colliders = [];
  const shootables = [];
  const siteMarkers = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground and perimeter (46 x 34, walls 5 m).
  box(46.4, 0.4, 34.4, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 34.4, -23.2, 2.5, 0, 'surface');
  box(0.4, 5, 34.4, 23.2, 2.5, 0, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, -17.2, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, 17.2, 'surface');

  // Site pads: painted floor plates + low rails so a site reads at a glance.
  for (const [key, site] of Object.entries(SITES)) {
    const pad = box(7, 0.08, 7, site.x, 0.04, site.z, key === 'A' ? 'teal' : 'ember', false);
    pad.receiveShadow = true;
    siteMarkers.push({ key, mesh: pad });
    box(7, 0.5, 0.3, site.x, 0.25, site.z - 3.5, 'hairline');
  }

  // Containers (A lane, west): tall steel boxes forming a long sightline with cover.
  box(6, 2.6, 2.4, -14, 1.3, 4, 'accent');
  box(6, 2.6, 2.4, -14, 1.3, 7.2, 'surface');
  box(2.4, 2.6, 6, -19, 1.3, -4, 'hairline');
  box(4, 2.6, 2.4, -10, 1.3, -6, 'surface');
  box(2.4, 1.2, 2.4, -6, 0.6, -8, 'hairline');
  // Containers (B lane, east), mirrored with a different rhythm.
  box(6, 2.6, 2.4, 14, 1.3, 4, 'ember');
  box(2.4, 2.6, 6, 19, 1.3, -4, 'surface');
  box(4, 2.6, 2.4, 10, 1.3, -6, 'hairline');
  box(2.4, 1.2, 2.4, 6, 0.6, -8, 'surface');
  box(6, 2.6, 2.4, 14, 1.3, -12, 'surface');
  // Mid: gantry pillars + a low bridge deck you can walk under, crates to crouch behind.
  box(0.8, 4.4, 0.8, -2.5, 2.2, -2, 'hairline');
  box(0.8, 4.4, 0.8, 2.5, 2.2, -2, 'hairline');
  box(6.4, 0.5, 2.2, 0, 4.4, -2, 'surface');
  box(1.6, 0.9, 1.6, -4, 0.45, 0, 'hairline');
  box(1.6, 0.9, 1.6, 4, 0.45, 0, 'hairline');
  box(1.2, 1.1, 3.6, -8, 0.55, 6, 'hairline');
  box(1.2, 1.1, 3.6, 8, 0.55, 6, 'hairline');
  box(3.6, 1.1, 1.2, 0, 0.55, 10, 'hairline');
  // Spawn cover.
  box(2.4, 0.9, 1.2, -3, 0.45, 11, 'hairline');
  box(2.4, 0.9, 1.2, 3, 0.45, 11, 'hairline');
  box(2.4, 0.9, 1.2, -3, 0.45, -11, 'hairline');
  box(2.4, 0.9, 1.2, 3, 0.45, -11, 'hairline');
  // Stacked pallets near each site (crouch cover + a perch).
  box(1.8, 0.8, 1.8, -21, 0.4, -13, 'hairline');
  box(1.8, 0.8, 1.8, 21, 0.4, -13, 'hairline');
  box(1.4, 1.6, 1.4, -15, 0.8, -13, 'surface');
  box(1.4, 1.6, 1.4, 15, 0.8, -13, 'surface');

  // Dusk lighting: low amber key, cool teal fill, hemisphere sky.
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.canvas), 1.3));
  const key = new THREE.DirectionalLight(new THREE.Color(0xffc98a), 2.8);
  key.position.set(14, 18, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.teal), 0.7);
  fill.position.set(-12, 10, -8);
  scene.add(fill);
  // Site beacons: small glowing posts so each site is visible down a lane.
  for (const [k, site] of Object.entries(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color(k === 'A' ? PALETTE.teal : PALETTE.ember), 6, 12);
    lamp.position.set(site.x, 3.2, site.z);
    scene.add(lamp);
  }

  return { colliders, shootables, group, siteMarkers };
}
