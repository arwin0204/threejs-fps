// MERIDIAN YARD — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. Phases: menu -> buy -> live -> (planted) -> over.
// Rounds are first to 5. The player is Vanguard's spike carrier; 2 Vanguard bots
// and 4 Ember bots fight over two sites, A and B. Win a round by eliminating the
// other squad, or by planting the spike and letting its 35 s fuse run out.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame, renders it
// twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades, createBomb } from './grenades.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BOMB_FUSE = 35;
const PLANT_TIME = 3;
const DEFUSE_TIME = 4;
const BUY_TIME = 12;
const WIN_ROUNDS = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 30, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const audio = createAudio();
const player = createPlayer(world.colliders, SPAWNS.vanguard[0]);
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, world.colliders, world.shootables, random);
const grenades = createGrenades(scene, world.colliders);
const bomb = createBomb(scene);

const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3();
const tmpEye = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpHit = new THREE.Vector3();

// Tracers: a fixed pool of lines, reused, never allocated per shot.
const tracers = [];
for (let i = 0; i < 14; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
  line.visible = false;
  scene.add(line);
  tracers.push({ line, ttl: 0 });
}
let tracerIdx = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 0.9;
  t.ttl = 0.09;
}
// Explosion flash: one reusable mesh + light.
const boomMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
);
boomMesh.visible = false;
scene.add(boomMesh);
const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18);
scene.add(boomLight);
let boomTtl = 0;

// ---- Game state (one place) ----
const G = {
  phase: 'menu', // menu | buy | live | over
  round: 1,
  scoreV: 0,
  scoreE: 0,
  money: 800,
  health: 100,
  grenades: 0,
  owned: ['pistol'],
  timer: ROUND_TIME,
  buyTimer: BUY_TIME,
  bombPlanted: false,
  bombSite: null,
  bombFuse: BOMB_FUSE,
  plantProgress: 0,
  planting: false,
  elapsed: 0,
  kills: 0,
  started: false,
  frozen: false,
  noise: null,
  matchOver: false,
};
const body = player.state;
const botViews = []; // {ref, eyePos, moving, alive, team} — foe lookups without allocation
const playerView = { ref: 'player', eyePos: new THREE.Vector3(), moving: false, alive: true, team: 'vanguard' };
let emberBots = [];
let vanguardBots = [];
let carrierBot = null;

function allBots() { return bots.bots; }

function setupRound() {
  const objective = random() < 0.5 ? 'A' : 'B';
  const other = objective === 'A' ? 'B' : 'A';
  // Reset player.
  body.position.set(SPAWNS.vanguard[0][0], 0, SPAWNS.vanguard[0][1]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  G.health = 100;
  G.bombPlanted = false;
  G.bombSite = null;
  G.bombFuse = BOMB_FUSE;
  G.plantProgress = 0;
  G.timer = ROUND_TIME;
  G.buyTimer = BUY_TIME;
  bomb.clear();
  hud.hideBomb();
  hud.hidePlant();
  // Bots: rebuild the squads each round from the same four Ember and two Vanguard.
  for (const b of allBots()) scene.remove(b.group);
  bots.bots.length = 0;
  bots.hitMeshes.length = 0;
  botViews.length = 0;
  const eNames = ['Ash', 'Cinder', 'Flint', 'Ember'];
  emberBots = eNames.map((name, i) => bots.makeBot({
    name, team: 'ember', spawn: SPAWNS.ember[i], objective: i === 0 ? objective : (i % 2 ? objective : other),
    carrier: i === 0, skill: 0.7 + random() * 0.5,
  }));
  carrierBot = emberBots[0];
  vanguardBots = ['Juno', 'Moss'].map((name, i) => bots.makeBot({
    name, team: 'vanguard', spawn: SPAWNS.vanguard[i + 1], objective: i === 0 ? objective : other,
    skill: 0.8 + random() * 0.3,
  }));
  for (const b of allBots()) botViews.push({ ref: b, eyePos: new THREE.Vector3(), moving: false, alive: true, team: b.team });
  weapon.refill();
  hud.setHealth(G.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name);
  hud.setMoney(G.money);
  hud.setGrenades(G.grenades);
  hud.setScore(G.scoreV, G.scoreE, G.round);
  hud.setAlive(3, 4);
  hud.setHint('B — buy menu · E — plant spike · G — throw frag · R — reload');
}

function startBuyPhase() {
  G.phase = 'buy';
  G.buyTimer = BUY_TIME;
  setupRound();
  hud.banner(`ROUND ${G.round}`, 'Buy phase — spend your money, then fight.', 2200);
  hud.openBuy(G.money, G.owned, buyItem);
  if (!shot) hud.setHint('Buy phase — click a weapon or press 1-4, G for frag. Enter to start the round.');
}

function buyItem(id) {
  if (G.phase !== 'buy') return;
  if (id === 'grenade') {
    if (G.money < 300 || G.grenades >= 2) { audio.deny(); return; }
    G.money -= 300;
    G.grenades += 1;
    audio.buy();
  } else {
    const w = WEAPONS[id];
    if (!w || G.owned.includes(id) || G.money < w.price) { audio.deny(); return; }
    G.money -= w.price;
    G.owned.push(id);
    weapon.equip(id);
    audio.buy();
  }
  hud.setMoney(G.money);
  hud.setGrenades(G.grenades);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name);
  hud.refreshBuy(G.money, G.owned, buyItem);
}

function startLive() {
  if (G.phase !== 'buy') return;
  G.phase = 'live';
  hud.closeBuy();
  hud.setHint('Plant the spike at A or B — or eliminate Ember.');
  if (!shot) input.requestLock();
}

function endRound(vanguardWon, reason) {
  if (G.phase === 'over') return;
  G.phase = 'over';
  if (vanguardWon) {
    G.scoreV += 1;
    G.money += 3250;
    audio.roundWin();
  } else {
    G.scoreE += 1;
    G.money += 1900;
    audio.roundLose();
  }
  hud.setMoney(G.money);
  hud.setScore(G.scoreV, G.scoreE, G.round);
  hud.setAlive(bots.aliveOf('vanguard').length + (G.health > 0 ? 1 : 0), bots.aliveOf('ember').length);
  hud.hideBomb();
  hud.hidePlant();
  hud.banner(vanguardWon ? 'ROUND WON' : 'ROUND LOST', reason, 3400);
  if (document.pointerLockElement) document.exitPointerLock();
  if (G.scoreV >= WIN_ROUNDS || G.scoreE >= WIN_ROUNDS) {
    G.matchOver = true;
    setTimeout(() => {
      hud.showOverlay('matchEnd', G.scoreV > G.scoreE
        ? `Vanguard takes the match ${G.scoreV}–${G.scoreE}. ${G.kills} eliminations, $${G.money} banked.`
        : `Ember takes the match ${G.scoreE}–${G.scoreV}. Better luck next yard.`);
      G.phase = 'menu';
    }, 3600);
    return;
  }
  setTimeout(() => {
    if (G.phase !== 'over') return;
    G.round += 1;
    startBuyPhase();
  }, 3600);
}

function restartMatch() {
  G.round = 1;
  G.scoreV = 0;
  G.scoreE = 0;
  G.money = 800;
  G.kills = 0;
  G.owned = ['pistol'];
  G.grenades = 0;
  G.matchOver = false;
  weapon.equip('pistol');
  startBuyPhase();
}

// ---- Shooting ----
function shootFrom(origin, dir, def, shooter, targetTeam) {
  scene.updateMatrixWorld(true);
  raycaster.set(origin, dir);
  raycaster.far = def.range;
  const targets = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : tmpHit.copy(origin).addScaledVector(dir, def.range);
  spawnTracer(origin, end);
  if (!hit) return null;
  if (hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    if (bot.team === targetTeam) return { bot, part: hit.object.userData.part, point: hit.point };
    return { blocked: true, point: hit.point };
  }
  return { blocked: true, point: hit.point };
}

function applyDamageToBot(bot, amount, killerName, headshot) {
  const killed = bots.damage(bot, amount);
  if (killed) {
    hud.addKill(killerName, bot.name, headshot);
    if (killerName === 'You') {
      G.money += 300;
      G.kills += 1;
      hud.setMoney(G.money);
    }
    if (bot === carrierBot && G.phase === 'live') {
      // The spike drops where the carrier fell: the player can still plant it.
      hud.setHint('Spike carrier down — the spike is yours. Plant it at A or B.');
    }
  }
  return killed;
}

function playerShoot() {
  if (!weapon.takeRound()) { audio.dryFire(); return; }
  camera.getWorldDirection(direction);
  const spread = weapon.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  const def = weapon.state.def;
  const result = shootFrom(camera.position, direction, def, 'player', 'ember');
  weapon.pullTrigger();
  player.recoil(def.kind === 'dmr' ? 0.03 : 0.011 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.kind);
  G.noise = { x: body.position.x, z: body.position.z, team: 'vanguard' };
  if (result && result.bot) {
    const head = result.part === 'head';
    const dmg = def.damage * (head ? def.headMult : 1);
    const killed = applyDamageToBot(result.bot, dmg, 'You', head);
    hud.hitMarker(killed);
    audio.hit(killed);
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
}

function botShoot(bot, targetView, err) {
  const from = tmpEye.set(bot.mover.state.position.x, bot.mover.state.position.y + bot.mover.state.eye, bot.mover.state.position.z);
  tmpDir.copy(targetView.eyePos).sub(from).normalize();
  tmpDir.x += (random() * 2 - 1) * err;
  tmpDir.y += (random() * 2 - 1) * err;
  tmpDir.z += (random() * 2 - 1) * err;
  tmpDir.normalize();
  const def = WEAPONS.rifle;
  const result = shootFrom(from, tmpDir, def, bot, bot.team === 'ember' ? 'vanguard' : 'ember');
  audio.shot('rifle', true);
  G.noise = { x: bot.mover.state.position.x, z: bot.mover.state.position.z, team: bot.team };
  if (!result || !result.bot) return;
  const head = result.part === 'head';
  const dmg = def.damage * (head ? 1.5 : 1) * (0.85 + random() * 0.3);
  if (result.bot === 'player') return; // player is not in hitMeshes; handled below
  bots.damage(result.bot, dmg);
}

function damagePlayer(amount, fromName) {
  if (G.phase !== 'live' || G.health <= 0) return;
  G.health -= amount;
  hud.setHealth(G.health);
  hud.damageFlash();
  audio.hurt();
  if (G.health <= 0) {
    G.health = 0;
    hud.setHealth(0);
    hud.addKill(fromName, 'You', false);
    hud.banner('YOU ARE DOWN', 'Your squad fights on.', 2000);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// Bot hitscan against the player: wall check first, then a spread-cone roll.
function botShootPlayer(bot, err) {
  const from = tmpEye.set(bot.mover.state.position.x, bot.mover.state.position.y + bot.mover.state.eye, bot.mover.state.position.z);
  const to = playerView.eyePos;
  tmpDir.copy(to).sub(from);
  const dist = tmpDir.length();
  tmpDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(from, tmpDir);
  raycaster.far = dist;
  if (raycaster.intersectObjects(world.shootables, false).length > 0) return; // wall in the way
  const hitChance = Math.max(0.04, 0.32 - dist * 0.008 - err * 4);
  if (random() > hitChance) {
    // Near miss: tracer past the camera.
    tmpHit.copy(to).addScaledVector(tmpDir, 2);
    tmpHit.x += (random() * 2 - 1) * 0.6;
    tmpHit.y += (random() * 2 - 1) * 0.6;
    spawnTracer(from, tmpHit);
    return;
  }
  spawnTracer(from, to);
  audio.shot('rifle', false);
  damagePlayer(WEAPONS.rifle.damage * 0.55 * (0.8 + random() * 0.4), bot.name);
}

// ---- Bomb ----
function tryPlant(dt) {
  const inSite = Object.entries(SITES).find(([, s]) => Math.hypot(s.x - body.position.x, s.z - body.position.z) < s.r);
  if (!inSite || G.bombPlanted || G.health <= 0) {
    G.plantProgress = 0;
    G.planting = false;
    hud.hidePlant();
    return;
  }
  G.planting = true;
  G.plantProgress += dt / PLANT_TIME;
  hud.showPlant(G.plantProgress);
  if (Math.floor(G.plantProgress * 10) !== Math.floor((G.plantProgress - dt / PLANT_TIME) * 10)) audio.plant();
  if (G.plantProgress >= 1) {
    G.bombPlanted = true;
    G.bombSite = inSite[0];
    G.bombFuse = BOMB_FUSE;
    bomb.plant(body.position.x, body.position.z);
    G.money += 300;
    hud.setMoney(G.money);
    hud.addKill('You', `SPIKE @ ${G.bombSite}`, false);
    hud.banner('SPIKE PLANTED', `Defend site ${G.bombSite} — ${BOMB_FUSE}s to detonation.`, 2600);
    audio.beep(true);
    hud.hidePlant();
  }
}

function explodeBomb() {
  const site = SITES[G.bombSite];
  boomMesh.position.set(site.x, 1, site.z);
  boomMesh.visible = true;
  boomMesh.scale.setScalar(0.5);
  boomLight.position.set(site.x, 2, site.z);
  boomLight.intensity = 60;
  boomTtl = 0.5;
  audio.explosion();
  bomb.clear();
  // Radial damage: anyone near the site takes heavy damage.
  const all = [{ x: body.position.x, z: body.position.z, isPlayer: true }, ...allBots().map((b) => ({ x: b.mover.state.position.x, z: b.mover.state.position.z, bot: b }))];
  for (const t of all) {
    const d = Math.hypot(t.x - site.x, t.z - site.z);
    if (d < 9) {
      if (t.isPlayer) damagePlayer(120 - d * 8, 'Spike');
      else if (t.bot.alive) bots.damage(t.bot, 120 - d * 8);
    }
  }
  endRound(true, `The spike detonated at site ${G.bombSite}.`);
}

function resolveExplosion(at) {
  boomMesh.position.set(at.x, Math.max(0.5, at.y), at.z);
  boomMesh.visible = true;
  boomMesh.scale.setScalar(0.5);
  boomLight.position.set(at.x, at.y + 1, at.z);
  boomLight.intensity = 60;
  boomTtl = 0.5;
  audio.explosion();
  const all = [{ x: body.position.x, z: body.position.z, isPlayer: true }, ...allBots().map((b) => ({ x: b.mover.state.position.x, z: b.mover.state.position.z, bot: b }))];
  for (const t of all) {
    const d = Math.hypot(t.x - at.x, t.z - at.z);
    if (d < 7) {
      if (t.isPlayer) damagePlayer(110 - d * 10, 'Frag');
      else if (t.bot.alive) applyDamageToBot(t.bot, 110 - d * 10, 'You', false);
    }
  }
}

// ---- Fixed-step simulation ----
function step(dt) {
  G.elapsed += dt;
  if (G.phase === 'buy') {
    G.buyTimer -= dt;
    hud.setTimer(G.buyTimer, false);
    if (G.buyTimer <= 0) startLive();
    return;
  }
  if (G.phase !== 'live') return;

  // Round timer / bomb fuse.
  if (G.bombPlanted) {
    G.bombFuse -= dt;
    hud.showBomb(G.bombFuse);
    bomb.beep(Math.floor(G.elapsed * 2) % 2 === 0);
    if (Math.ceil(G.bombFuse) !== Math.ceil(G.bombFuse + dt)) audio.beep();
    if (G.bombFuse <= 0) { explodeBomb(); return; }
  } else {
    G.timer -= dt;
    hud.setTimer(G.timer, false);
    if (G.timer <= 0) { endRound(false, 'Time expired — Ember holds the yard.'); return; }
  }

  // Player.
  player.stepFromKeys(dt, input.state.keys);
  playerView.eyePos.set(body.position.x, body.position.y + body.eye, body.position.z);
  playerView.moving = player.groundSpeed() > 1;
  playerView.alive = G.health > 0;
  hud.setCrosshairGap(6 + player.groundSpeed() * 2.2 + weapon.state.bloom * 300);

  // Plant channel (hold E on a site).
  if (input.state.keys.has('KeyE')) tryPlant(dt);
  else { G.plantProgress = 0; G.planting = false; hud.hidePlant(); }

  // Foe views for the bots (updated once per step, no allocation in the loop).
  for (const view of botViews) {
    const b = view.ref;
    view.eyePos.set(b.mover.state.position.x, b.mover.state.position.y + b.mover.state.eye, b.mover.state.position.z);
    view.moving = b.speed > 1;
    view.alive = b.alive;
  }

  const ctx = {
    sites: SITES,
    bombPlanted: G.bombPlanted,
    bombSite: G.bombSite,
    noise: G.noise,
    foesOf(bot) {
      const out = [];
      if (bot.team === 'ember') {
        if (playerView.alive) out.push(playerView);
        for (const v of botViews) if (v.team === 'vanguard' && v.alive) out.push(v);
      } else {
        for (const v of botViews) if (v.team === 'ember' && v.alive) out.push(v);
      }
      return out;
    },
    onShoot(bot, targetView, err) {
      if (targetView.ref === 'player') botShootPlayer(bot, err);
      else botShoot(bot, targetView, err);
    },
    onDefused(bot) {
      hud.addKill(bot.name, 'SPIKE', false);
      endRound(false, `${bot.name} defused the spike.`);
    },
    onPlanted(bot) {
      G.bombPlanted = true;
      G.bombSite = bot.objective;
      G.bombFuse = BOMB_FUSE;
      const site = SITES[G.bombSite];
      bomb.plant(site.x, site.z);
      hud.banner('SPIKE PLANTED', `Ember planted at site ${G.bombSite} — stop the defuse.`, 2600);
      audio.beep(true);
    },
  };

  for (const bot of allBots()) bots.stepBot(bot, dt, G.elapsed, ctx);
  G.noise = null;

  // Grenades.
  for (const boom of grenades.step(dt)) resolveExplosion(boom);

  // Win / loss by elimination.
  const emberAlive = bots.aliveOf('ember').length;
  const vanguardAlive = bots.aliveOf('vanguard').length + (G.health > 0 ? 1 : 0);
  hud.setAlive(vanguardAlive, emberAlive);
  if (!G.bombPlanted) {
    if (emberAlive === 0) endRound(true, 'Ember squad eliminated.');
    else if (vanguardAlive === 0) endRound(false, 'Vanguard squad eliminated.');
  } else if (emberAlive === 0 && vanguardAlive === 0) {
    // Nobody left to defuse: the fuse decides it.
  } else if (vanguardAlive === 0 && emberAlive > 0) {
    // Ember will defuse; the fuse still ticks, so the round resolves by defuse.
  }

  weapon.step(dt);
  if (boomTtl > 0) {
    boomTtl -= dt;
    const k = 1 - boomTtl / 0.5;
    boomMesh.scale.setScalar(0.5 + k * 7);
    boomMesh.material.opacity = Math.max(0, 0.7 * (1 - k));
    boomLight.intensity = Math.max(0, 60 * (1 - k));
    if (boomTtl <= 0) { boomMesh.visible = false; boomLight.intensity = 0; }
  }
  for (const t of tracers) {
    if (t.ttl <= 0) continue;
    t.ttl -= dt;
    t.line.material.opacity = Math.max(0, t.ttl / 0.09) * 0.9;
    if (t.ttl <= 0) t.line.visible = false;
  }
}

// ---- Frame loop ----
let accumulator = 0;
let lastTime = performance.now();

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!G.frozen) {
    const look = input.takeLook();
    if (G.phase === 'live' && G.health > 0) player.look(look.x, look.y);
    // Fire input (semi-auto weapons fire on press, auto on hold).
    if (G.phase === 'live' && G.health > 0) {
      if (input.state.firing && weapon.ready()) playerShoot();
      if (input.consume('KeyR') && weapon.reload()) audio.reload();
      if (input.consume('KeyG') && G.grenades > 0) {
        G.grenades -= 1;
        hud.setGrenades(G.grenades);
        camera.getWorldDirection(direction);
        grenades.throwGrenade(camera.position, direction, 11);
        audio.shot('smg');
      }
    }
    // Buy-phase keys.
    if (G.phase === 'buy') {
      if (input.consume('Enter')) startLive();
      const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
      for (let i = 0; i < buyKeys.length; i += 1) {
        if (input.consume(buyKeys[i])) buyItem(['pistol', 'smg', 'rifle', 'dmr'][i]);
      }
      if (input.consume('KeyG')) buyItem('grenade');
      if (input.consume('KeyB')) hud.closeBuy();
    }
    if (input.consume('KeyB') && G.phase === 'live') hud.setHint('Buy menu opens between rounds — press B then.');
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    G.started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (G.phase === 'live' && G.health > 0) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (G.matchOver || G.phase === 'menu') {
    restartMatch();
    hud.hideOverlay(); // buy phase needs no pointer lock, so hide the menu here
  } else if (G.phase === 'buy') startLive();
  else input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Mousedown edge for semi-auto fire: input tracks holding; consume via a synthetic press.
window.addEventListener('mousedown', () => input.state.pressed.add('MouseDown'));
window.addEventListener('mouseup', () => input.state.pressed.delete('MouseDown'));

// Test / screenshot hooks: deterministic state inspection without touching the game.
window.__game = {
  get phase() { return G.phase; },
  get round() { return G.round; },
  get score() { return [G.scoreV, G.scoreE]; },
  get money() { return G.money; },
  get health() { return G.health; },
  get alive() { return [bots.aliveOf('vanguard').length + (G.health > 0 ? 1 : 0), bots.aliveOf('ember').length]; },
  get bombPlanted() { return G.bombPlanted; },
  get pos() { return [Number(body.position.x.toFixed(2)), Number(body.position.z.toFixed(2))]; },
  get yaw() { return Number(body.yaw.toFixed(3)); },
  get locked() { return !!document.pointerLockElement; },
  get ammo() { return [weapon.state.mag, weapon.state.reserve]; },
};

// ---- Deterministic screenshot setups ----
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}
function aimAtBot(bot) {
  const p = bot.mover.state.position;
  const dx = p.x - body.position.x;
  const dy = (p.y + 1.2) - (body.position.y + body.eye);
  const dz = p.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      G.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}
function runShot(name) {
  hud.hideOverlay();
  hud.closeBuy();
  if (name === 'start') {
    setupRound();
    G.phase = 'menu';
    body.position.set(0, 0, 13);
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    syncCamera();
    hud.showOverlay('start');
  } else if (name === 'buy') {
    startBuyPhase();
    body.position.set(0, 0, 13);
    body.yaw = 0.3;
    settle(5);
    syncCamera();
  } else if (name === 'play') {
    startBuyPhase();
    startLive();
    body.position.set(0, 0, 6);
    settle(8);
    const foe = emberBots[0];
    foe.mover.state.position.set(-2, 0, -4);
    foe.group.position.set(-2, 0, -4);
    // Drop one bot with the sidearm (4 torso hits) so the frame reads as mid-fight.
    for (let r = 0; r < 4; r += 1) { aimAtBot(foe); playerShoot(); settle(6); }
    aimAtBot(emberBots[1]);
    G.health = 100;
    hud.setHealth(100);
    hud.hideBanner();
    settle(2);
    syncCamera();
  } else if (name === 'end') {
    startBuyPhase();
    startLive();
    body.position.set(-12, 0, -2);
    settle(20);
    for (const b of emberBots) applyDamageToBot(b, 500, 'You', true);
    endRound(true, 'Ember squad eliminated.');
    aimAtBot(emberBots[0]);
    hud.setHint('');
    settle(5);
    syncCamera();
  }
  hud.setScore(G.scoreV, G.scoreE, G.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name);
  paintTwiceThenReady();
}

syncCamera();
if (shot) runShot(shot);
else {
  setupRound();
  G.phase = 'menu';
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
