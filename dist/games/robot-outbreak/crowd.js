// Robot root positions stay on the navigation mesh with room for their bodies.
export const ROBOT_SPACING = .94;
const GAP_SQUARED = ROBOT_SPACING ** 2;
const SLOT_CLEARANCE = ROBOT_SPACING + .12;
const REACH = 2.3;
const MIN_PLAYER_GAP = 1.65;
export const PLAYER_GAP = 1.58;
const SIDESTEPS = [0, .55, -.55, 1.07, -1.07];

export function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

export function makeFormation(nav, player, look, marker, cap) {
  const length = Math.hypot(look.x - player.x, look.z - player.z);
  const forward = {x: (look.x - player.x) / length, z: (look.z - player.z) / length};
  const candidates = nav.nearby(player, 7.5)
    .map(point => {
      const distance = Math.sqrt(distanceSquared(point, player));
      const facing = ((point.x - player.x) * forward.x + (point.z - player.z) * forward.z) / (distance || 1);
      return {point, distance, facing};
    })
    .filter(({distance, facing}) => distance >= MIN_PLAYER_GAP && facing >= .24);
  const front = candidates.filter(({distance, facing}) => distance <= REACH && facing >= .55)
    .sort((a, b) => (Math.abs(a.distance - 1.94) + .48 * (1 - a.facing)) - (Math.abs(b.distance - 1.94) + .48 * (1 - b.facing)));
  const reserve = candidates.filter(({distance}) => distance > REACH)
    .sort((a, b) => (a.distance + 1.2 * (1 - a.facing)) - (b.distance + 1.2 * (1 - b.facing)));
  const slots = [];
  for (const [points, attack, limit] of [[front, true, Math.min(cap, 3)], [reserve, false, cap]]) {
    for (const {point} of points) {
      if (slots.length >= limit) break;
      if (slots.some(slot => slot.route.some(tile => distanceSquared(tile, point) < SLOT_CLEARANCE ** 2))) continue;
      const route = nav.path(marker, point, tile => distanceSquared(tile, player) < PLAYER_GAP ** 2 ||
        slots.some(slot => distanceSquared(tile, slot.point) < SLOT_CLEARANCE ** 2));
      if (!route.length) continue;
      slots.push({point, attack, route});
    }
  }
  if (slots.length < cap || !slots.some(slot => slot.attack)) throw new Error('مساحة وقوف الروبوتات غير متاحة في المنطقة.');
  return slots;
}

export function findClearSpawn(nav, marker, enemies) {
  return nav.nearby(marker, 3.6)
    .sort((a, b) => distanceSquared(a, marker) - distanceSquared(b, marker))
    .find(point => isFree(point, enemies, null));
}

function isFree(point, enemies, self) {
  return enemies.every(enemy => enemy === self || enemy.deadAt !== null ||
    distanceSquared(point, enemy.root.position) >= GAP_SQUARED);
}

function canStep(nav, from, to, enemies, moving, player) {
  if (!nav.walkable(to) || distanceSquared(to, player) < PLAYER_GAP ** 2) return false;
  // Check the swept path as well as its end so a long update cannot pass
  // through a robot which already moved in this frame.
  const dx = to.x - from.x, dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  for (const other of enemies) {
    if (other === moving || other.deadAt !== null) continue;
    const center = other.root.position;
    const nearest = Math.max(0, Math.min(1, ((center.x - from.x) * dx + (center.z - from.z) * dz) / lengthSquared));
    const x = from.x + dx * nearest - center.x, z = from.z + dz * nearest - center.z;
    if (x * x + z * z < GAP_SQUARED - 1e-8) return false;
  }
  return true;
}

export function stepAlongRoute(nav, enemies, enemy, player, dt) {
  const position = enemy.root.position;
  while (enemy.pathIndex < enemy.path.length &&
         distanceSquared(position, enemy.path[enemy.pathIndex]) < .085 ** 2) {
    enemy.pathIndex++;
  }
  const target = enemy.path[enemy.pathIndex];
  if (!target || dt <= 0) return null;
  const dx = target.x - position.x, dz = target.z - position.z;
  const angle = Math.atan2(dx, dz);
  const step = Math.min(enemy.speed * dt, Math.hypot(dx, dz), .14);
  for (const side of SIDESTEPS) {
    const heading = angle + side;
    const point = {x: position.x + Math.sin(heading) * step, z: position.z + Math.cos(heading) * step};
    if (!canStep(nav, position, point, enemies, enemy, player)) continue;
    position.x = point.x;
    position.z = point.z;
    return heading;
  }
  return null;
}
