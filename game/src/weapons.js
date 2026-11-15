// Weapons: four buyable guns, one free sidearm. Each definition owns its numbers
// (damage, headshot multiplier, fire gap, spread, price); the view model and the
// reload cycle live here, main.js owns the ray and the damage. Spread grows with
// movement speed and with sustained fire, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 26, headMult: 3, mag: 12, reserve: 36, gap: 0.16, reload: 1.4, spreadStill: 0.003, spreadMove: 0.02, auto: false, range: 40 },
  smg: { name: 'Kestrel-9 SMG', kind: 'smg', price: 1500, damage: 24, headMult: 3, mag: 32, reserve: 96, gap: 0.075, reload: 2.0, spreadStill: 0.005, spreadMove: 0.034, auto: true, range: 45 },
  rifle: { name: 'VK-7 Rifle', kind: 'rifle', price: 2600, damage: 34, headMult: 3, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, range: 70 },
  dmr: { name: 'Longshot DMR', kind: 'dmr', price: 3400, damage: 88, headMult: 2.5, mag: 10, reserve: 30, gap: 0.55, reload: 2.4, spreadStill: 0.0008, spreadMove: 0.04, auto: false, range: 90 },
};
export const BUY_ORDER = ['pistol', 'smg', 'rifle', 'dmr'];

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  stock.position.set(0, -0.02, 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), dark);
  sight.position.set(0, 0.075, -0.05);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    id: 'pistol', def: WEAPONS.pistol, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
  };

  function equip(id, keepAmmo = false) {
    const def = WEAPONS[id];
    state.id = id;
    state.def = def;
    state.reloadLeft = 0;
    state.cooldown = 0;
    if (!keepAmmo) { state.mag = def.mag; state.reserve = def.reserve; }
    // Shorter barrel for the pistol, longer for the DMR — the model reads the gun.
    barrel.scale.z = id === 'pistol' ? 0.55 : id === 'dmr' ? 1.5 : 1;
    barrel.position.z = id === 'pistol' ? -0.3 : id === 'dmr' ? -0.48 : -0.38;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = state.def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  equip('pistol'); // every round starts on the free sidearm; rifles are bought

  return {
    state,
    step,
    equip,
    ready() { return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    pullTrigger() {
      state.cooldown = state.def.gap;
      state.flash = 0.06;
      state.kick = state.def.kind === 'dmr' ? 0.11 : 0.055;
      state.bloom = Math.min(0.05, state.bloom + (state.def.kind === 'smg' ? 0.006 : 0.008));
    },
    takeRound() { if (state.mag <= 0) return false; state.mag -= 1; return true; },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return false;
      state.reloadLeft = state.def.reload;
      return true;
    },
    spread(speed) {
      const move = Math.min(1, speed / 5.2);
      return state.def.spreadStill + move * state.def.spreadMove + state.bloom;
    },
    refill() {
      state.mag = state.def.mag;
      state.reserve = state.def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
