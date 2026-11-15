// Movement shared by the player and the bots: acceleration, friction, gravity,
// crouch and jump, resolved as a box against the world's colliders one axis at a
// time, so a wall never swallows a body. One mover factory, no duplicated code.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;

export function createMover(colliders, opts) {
  const height = opts.standHeight ?? 1.72;
  const crouchHeight = opts.crouchHeight ?? 1.12;
  const standEye = opts.standEye ?? 1.6;
  const crouchEye = opts.crouchEye ?? 1.02;
  const walkSpeed = opts.walkSpeed ?? 5.2;
  const crouchSpeed = opts.crouchSpeed ?? 2.4;
  const groundAccel = opts.groundAccel ?? 42;
  const airAccel = opts.airAccel ?? 9;
  const friction = opts.friction ?? 9;
  const jumpSpeed = opts.jumpSpeed ?? 6.2;

  const body = {
    position: new THREE.Vector3(...(opts.spawn ?? [0, 0, 0])),
    velocity: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    pitch: 0,
    eye: standEye,
    onGround: true,
    crouching: false,
    height,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, h, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + h - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // wishDir: {forward, strafe} in [-1,1]; crouch and jump are booleans.
  function step(dt, wishDir, crouch, jump) {
    if (crouch && !body.crouching) {
      body.crouching = true;
      body.height = crouchHeight;
    } else if (!crouch && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, height, 0.02)) {
      body.crouching = false;
      body.height = height;
    }
    const eyeTarget = body.crouching ? crouchEye : standEye;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    wish.set(0, 0, 0);
    const fwd = wishDir.forward || 0;
    const str = wishDir.strafe || 0;
    if (fwd || str) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * fwd + cos * str, 0, -cos * fwd - sin * str).normalize();
    }
    const speed = body.crouching ? crouchSpeed : walkSpeed;
    const blend = Math.min(1, (body.onGround ? groundAccel : airAccel) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (jump && body.onGround) {
      body.velocity.y = jumpSpeed;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return {
    state: body,
    step,
    look,
    recoil,
    groundSpeed() { return Math.hypot(body.velocity.x, body.velocity.z); },
    eyePos(out) {
      out.set(body.position.x, body.position.y + body.eye, body.position.z);
      return out;
    },
  };
}

// Player wrapper: reads the keyboard set into a wish direction.
export function createPlayer(colliders, spawn) {
  const mover = createMover(colliders, { spawn });
  return {
    ...mover,
    stepFromKeys(dt, keys) {
      const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
      mover.step(dt, {
        forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
        strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      }, crouch, keys.has('Space'));
    },
  };
}
