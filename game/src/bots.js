// Bots: 4 Ember attackers + 2 Vanguard allies. Each bot has a body (shared mover),
// a simple visible body (torso + head hit meshes), and a state machine:
//   advance — walk the waypoint graph toward its objective site
//   hold    — guard a site, scanning
//   engage  — line of sight to an enemy: stop, aim, burst fire
//   defuse  — bomb planted: rush the site and channel a defuse
//   plant   — (Ember carrier) channel a plant on the site
// Bots react to what they see (raycast line of sight, range, field of view) and
// what they hear (gunfire alerts enemies within 25 m). Accuracy falls with range,
// target speed and while the bot itself moves; fire comes in bursts with pauses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './player.js';
import { WAYPOINTS } from './world.js';

const BOT_HEALTH = 100;
const SIGHT_RANGE = 42;
const HEAR_RANGE = 25;
const BURST_MIN = 3;
const BURST_MAX = 6;

export function createBots(scene, colliders, shootables, random) {
  const bots = [];
  const hitMeshes = [];
  const ray = new THREE.Raycaster();
  ray.far = SIGHT_RANGE;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  const bodyMatV = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.6 });
  const bodyMatE = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 16, 12);
  const legGeo = new THREE.BoxGeometry(0.42, 0.55, 0.26);

  function makeBot({ name, team, spawn, objective, carrier = false, skill = 1 }) {
    const mover = createMover(colliders, { spawn, walkSpeed: team === 'ember' ? 4.4 : 4.0 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, team === 'ember' ? bodyMatE : bodyMatV);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legs = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 }));
    legs.position.y = 0.28;
    // A short gun barrel so the bot reads as armed at a glance.
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.6), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.5 }));
    gun.position.set(0.2, 1.15, -0.35);
    group.add(torso, head, legs, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(group);
    const bot = {
      name, team, mover, group, torso, head, objective, carrier, skill,
      health: BOT_HEALTH, alive: true, state: 'advance', target: null,
      waypoint: 0, route: [], holdTime: 0, burstLeft: 0, burstPause: 0,
      aimError: 0, alerted: false, alertPos: null, plantProgress: 0, defuseProgress: 0,
      speed: 0, lastShot: 0, flash: null,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (const w of WAYPOINTS) {
      const d = (w.x - x) ** 2 + (w.z - z) ** 2;
      if (d < bestD) { bestD = d; best = w.id; }
    }
    return best;
  }

  // Breadth-first route over the waypoint graph.
  function planRoute(fromId, toId) {
    if (fromId === toId) return [toId];
    const prev = new Map([[fromId, -1]]);
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of WAYPOINTS[cur].links) {
        if (prev.has(next)) continue;
        prev.set(next, cur);
        if (next === toId) {
          const path = [toId];
          let node = cur;
          while (node !== -1) { path.unshift(node); node = prev.get(node); }
          return path;
        }
        queue.push(next);
      }
    }
    return [toId];
  }

  function hasLineOfSight(from, to) {
    tmpDir.copy(to).sub(from);
    const dist = tmpDir.length();
    if (dist > SIGHT_RANGE) return false;
    tmpDir.normalize();
    ray.set(from, tmpDir);
    ray.far = dist;
    scene.updateMatrixWorld(true);
    const hits = ray.intersectObjects(shootables, false);
    return hits.length === 0;
  }

  function resetBot(bot, spawn) {
    bot.health = BOT_HEALTH;
    bot.alive = true;
    bot.state = 'advance';
    bot.target = null;
    bot.route = [];
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    bot.alerted = false;
    bot.group.visible = true;
    bot.group.rotation.set(0, 0, 0);
    bot.mover.state.position.set(spawn[0], 0, spawn[1]);
    bot.mover.state.velocity.set(0, 0, 0);
    bot.mover.state.yaw = bot.team === 'ember' ? Math.PI : 0;
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.group.rotation.x = -1.45;
    bot.group.position.y = -0.1;
    return true;
  }

  // One bot's decisions for a fixed step. `foes` are live targets with eye
  // positions; `onShoot` fires a hitscan from the bot; `world` carries sites.
  function stepBot(bot, dt, time, ctx) {
    if (!bot.alive) return;
    const body = bot.mover.state;
    const eye = tmpA.set(body.position.x, body.position.y + body.eye, body.position.z);

    // Pick the nearest visible foe inside sight range and roughly ahead.
    let visible = null;
    let visibleDist = Infinity;
    for (const foe of ctx.foesOf(bot)) {
      if (!foe.alive) continue;
      tmpB.copy(foe.eyePos);
      const dist = eye.distanceTo(tmpB);
      if (dist > SIGHT_RANGE || dist >= visibleDist) continue;
      if (!hasLineOfSight(eye, tmpB)) continue;
      visible = foe;
      visibleDist = dist;
    }
    if (visible) {
      bot.target = visible;
      bot.state = 'engage';
      bot.alerted = true;
    } else if (bot.state === 'engage') {
      bot.target = null;
      bot.state = bot.objective ? 'advance' : 'hold';
    }

    // Heard gunfire: turn toward it and advance.
    if (!visible && ctx.noise && bot.team !== ctx.noise.team) {
      const d = Math.hypot(ctx.noise.x - body.position.x, ctx.noise.z - body.position.z);
      if (d < HEAR_RANGE) {
        bot.alerted = true;
        bot.alertPos = { x: ctx.noise.x, z: ctx.noise.z };
        if (bot.state !== 'engage') bot.state = 'advance';
      }
    }

    // Bomb planted: Ember rushes to defuse, Vanguard holds the site.
    if (ctx.bombPlanted) {
      if (bot.team === 'ember' && bot.state !== 'engage') {
        bot.state = 'defuse';
        bot.objective = ctx.bombSite;
      } else if (bot.team === 'vanguard' && bot.state !== 'engage') {
        bot.state = 'hold';
        bot.objective = ctx.bombSite;
      }
    }

    let wish = { forward: 0, strafe: 0 };
    let crouch = false;
    const targetSite = bot.objective === 'A' ? ctx.sites.A : bot.objective === 'B' ? ctx.sites.B : null;

    if (bot.state === 'engage' && bot.target) {
      // Face the target, strafe a little, fire in bursts.
      tmpTarget.copy(bot.target.eyePos);
      const dx = tmpTarget.x - body.position.x;
      const dz = tmpTarget.z - body.position.z;
      body.yaw = Math.atan2(-dx, -dz);
      const moving = bot.target.moving ? 1 : 0;
      wish.strafe = Math.sin(time * 1.3 + bot.waypoint) > 0.4 ? 0.5 : -0.5;
      if (visibleDist < 6) wish.strafe = 0;
      bot.burstPause -= dt;
      if (bot.burstPause <= 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
          bot.burstPause = 0.7 + random() * 0.8;
        } else if (time - bot.lastShot > 0.11) {
          bot.lastShot = time;
          bot.burstLeft -= 1;
          const rangeFactor = Math.min(1, visibleDist / 30);
          const err = (0.012 + rangeFactor * 0.03 + moving * 0.015) * (2 - bot.skill);
          ctx.onShoot(bot, bot.target, err);
        }
      }
    } else if (bot.state === 'defuse' && targetSite) {
      const d = Math.hypot(targetSite.x - body.position.x, targetSite.z - body.position.z);
      if (d < 1.6) {
        bot.defuseProgress += dt;
        if (bot.defuseProgress >= 4) ctx.onDefused(bot);
        wish = { forward: 0, strafe: 0 };
      } else {
        wish = walkToward(bot, targetSite.x, targetSite.z);
      }
    } else if (bot.state === 'plant' && targetSite) {
      const d = Math.hypot(targetSite.x - body.position.x, targetSite.z - body.position.z);
      if (d < 1.6) {
        bot.plantProgress += dt;
        if (bot.plantProgress >= 3) ctx.onPlanted(bot);
      } else wish = walkToward(bot, targetSite.x, targetSite.z);
    } else if (bot.state === 'hold') {
      bot.holdTime += dt;
      body.yaw += Math.sin(time * 0.25 + bot.waypoint * 2) * dt * 0.4;
      if (bot.holdTime > 14) { bot.holdTime = 0; bot.state = 'advance'; }
    } else {
      // Advance along the waypoint route toward the objective site.
      if (!bot.route.length) {
        const from = nearestWaypoint(body.position.x, body.position.z);
        const dest = WAYPOINTS.find((w) => w.hold === bot.objective)?.id ?? 6;
        bot.route = planRoute(from, dest);
        bot.route.shift();
      }
      const next = WAYPOINTS[bot.route[0]];
      if (!next) {
        bot.state = bot.objective ? 'hold' : 'advance';
      } else {
        const d = Math.hypot(next.x - body.position.x, next.z - body.position.z);
        if (d < 0.9) bot.route.shift();
        else wish = walkToward(bot, next.x, next.z);
      }
      // Ember carrier plants when it reaches its site.
      if (bot.carrier && targetSite && Math.hypot(targetSite.x - body.position.x, targetSite.z - body.position.z) < 1.6) {
        bot.state = 'plant';
      }
    }

    bot.mover.step(dt, wish, crouch, false);
    bot.speed = bot.mover.groundSpeed();
    bot.group.position.set(body.position.x, body.position.y + (bot.alive ? 0 : -0.1), body.position.z);
    if (bot.alive) bot.group.rotation.y = body.yaw + Math.PI;
  }

  function walkToward(bot, x, z) {
    const body = bot.mover.state;
    const dx = x - body.position.x;
    const dz = z - body.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += Math.max(-2.4 * 0.016, Math.min(2.4 * 0.016, diff));
    return { forward: Math.abs(diff) < 0.6 ? 1 : 0.2, strafe: Math.max(-1, Math.min(1, diff * 1.2)) };
  }

  return {
    bots,
    hitMeshes,
    makeBot,
    resetBot,
    damage,
    stepBot,
    hasLineOfSight,
    aliveOf(team) { return bots.filter((b) => b.team === team && b.alive); },
  };
}
