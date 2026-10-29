export const STAMINA_EVENT_EFFECTS = Object.freeze({
  zoneCollected: 9,
  obstacleCollision: -18,
});

export const GAME_ROUTE = Object.freeze({
  startZ: 0,
  finishZ: -33,
  minX: -1.3,
  maxX: 1.3,
  playerRadius: 0.22,
  zoneRadius: 0.5,
  stages: [
    {
      id: 'learn',
      title: 'Agarre y equilibrio',
      shortTitle: 'Aprende el agarre',
      startZ: 0,
      endZ: -6,
      zoneIds: ['zone-1', 'zone-2'],
      goal: 'Toma el bastón y pisa las dos zonas iluminadas.',
    },
    {
      id: 'slalom',
      title: 'Esquiva los obstáculos',
      shortTitle: 'Recorrido con obstáculos',
      startZ: -6,
      endZ: -18,
      zoneIds: ['zone-3', 'zone-4'],
      goal: 'Esquiva los topes y completa dos zonas seguras.',
    },
    {
      id: 'finish',
      title: 'Rumbo a la meta',
      shortTitle: 'Tramo final',
      startZ: -18,
      endZ: -33,
      zoneIds: ['zone-5', 'zone-6', 'zone-7'],
      goal: 'Combina el zigzag y las zonas objetivo hasta la meta.',
    },
  ],
  zones: [
    { id: 'zone-1', x: 0, z: -2.1, stage: 0 },
    { id: 'zone-2', x: 0.62, z: -4.55, stage: 0 },
    { id: 'zone-3', x: -0.64, z: -10.05, stage: 1 },
    { id: 'zone-4', x: 0.62, z: -14.85, stage: 1 },
    { id: 'zone-5', x: 0.62, z: -21.15, stage: 2 },
    { id: 'zone-6', x: -0.62, z: -25.05, stage: 2 },
    { id: 'zone-7', x: 0.62, z: -29.2, stage: 2 },
  ],
  obstacles: [
    { id: 'obstacle-1', x: 0, z: -7.8, stage: 1 },
    { id: 'obstacle-2', x: -0.68, z: -12.35, stage: 1 },
    { id: 'obstacle-3', x: 0.68, z: -16.2, stage: 1 },
    { id: 'obstacle-4', x: -0.68, z: -19.7, stage: 2 },
    { id: 'obstacle-5', x: 0.68, z: -23.45, stage: 2 },
    { id: 'obstacle-6', x: -0.68, z: -27.15, stage: 2 },
    { id: 'obstacle-7', x: 0, z: -31.05, stage: 2 },
  ],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createGameState({ showInstructions = true } = {}) {
  return {
    phase: showInstructions ? 'instructions' : 'ready',
    caneHeld: false,
    elapsed: 0,
    player: { x: 0, z: GAME_ROUTE.startZ },
    stageIndex: 0,
    points: 0,
    stamina: 100,
    support: 0.45,
    balance: 0.92,
    effort: 0.08,
    heartRate: 73,
    breathingRate: 13,
    speed: 0,
    zonesCompleted: 0,
    obstaclesAvoided: 0,
    collectedZones: [],
    obstacleResults: Object.fromEntries(GAME_ROUTE.obstacles.map(({ id }) => [id, 'pending'])),
    collisionLock: 0,
    safeZone: false,
    gateNotifiedFor: '',
    hasStarted: false,
  };
}

export function dismissInstructions(state) {
  if (state.phase === 'instructions') state.phase = 'ready';
  return state;
}

export function grabCane(state) {
  if (state.phase === 'instructions' || state.phase === 'paused' || state.phase === 'finished') return false;
  const wasHeld = state.caneHeld;
  state.caneHeld = true;
  if (state.phase === 'ready') {
    state.phase = 'playing';
    state.hasStarted = true;
  }
  return !wasHeld;
}

export function dropCane(state) {
  if (!state.caneHeld) return false;
  state.caneHeld = false;
  state.speed = 0;
  return true;
}

export function togglePause(state) {
  if (state.phase === 'playing') {
    state.phase = 'paused';
    state.speed = 0;
    return 'paused';
  }
  if (state.phase === 'paused') {
    state.phase = 'playing';
    return 'resumed';
  }
  return state.phase;
}

export function setSupport(state, value) {
  state.support = clamp(Number(value) || 0, 0, 1);
  return state.support;
}

export function resetGame({ showInstructions = false } = {}) {
  return createGameState({ showInstructions });
}

function isStageComplete(state, stage) {
  return stage.zoneIds.every((id) => state.collectedZones.includes(id));
}

function collectZones(state, events) {
  const player = state.player;
  state.safeZone = false;

  for (const zone of GAME_ROUTE.zones) {
    const distance = distance2d(player, zone);
    if (distance <= GAME_ROUTE.zoneRadius + 0.12) state.safeZone = true;
    if (distance > GAME_ROUTE.zoneRadius || state.collectedZones.includes(zone.id)) continue;

    state.collectedZones.push(zone.id);
    state.zonesCompleted += 1;
    state.points += 25;
    events.push({ type: 'zone', id: zone.id, points: 25 });
  }
}

function checkObstacleCollisions(state, previousZ, events) {
  for (const obstacle of GAME_ROUTE.obstacles) {
    if (state.obstacleResults[obstacle.id] !== 'pending') continue;
    const lateralDistance = Math.abs(state.player.x - obstacle.x);
    const zDistance = Math.abs(state.player.z - obstacle.z);
    const crossedPlane = previousZ > obstacle.z && state.player.z <= obstacle.z;

    if (lateralDistance < 0.47 && zDistance < 0.43) {
      state.obstacleResults[obstacle.id] = 'hit';
      state.points = Math.max(0, state.points - 15);
      state.balance = clamp(state.balance - 0.24, 0, 1);
      state.collisionLock = 0.36;
      state.player.x = clamp(state.player.x + (state.player.x <= obstacle.x ? -0.38 : 0.38), GAME_ROUTE.minX, GAME_ROUTE.maxX);
      state.player.z = Math.min(state.player.z + 0.16, obstacle.z + 0.38);
      events.push({ type: 'collision', id: obstacle.id, points: -15 });
      continue;
    }

    if (crossedPlane && lateralDistance >= 0.47) {
      state.obstacleResults[obstacle.id] = 'avoided';
      state.obstaclesAvoided += 1;
      state.points += 8;
      events.push({ type: 'avoided', id: obstacle.id, points: 8 });
    }
  }
}

function progressStages(state, events) {
  for (;;) {
    const stage = GAME_ROUTE.stages[state.stageIndex];
    if (!stage || state.player.z > stage.endZ) return;

    if (!isStageComplete(state, stage)) {
      state.player.z = stage.endZ + 0.16;
      if (state.gateNotifiedFor !== stage.id) {
        state.gateNotifiedFor = stage.id;
        const remaining = stage.zoneIds.filter((id) => !state.collectedZones.includes(id)).length;
        events.push({ type: 'gate', stage: state.stageIndex, remaining });
      }
      return;
    }

    if (state.stageIndex === GAME_ROUTE.stages.length - 1) {
      state.player.z = GAME_ROUTE.finishZ;
      state.phase = 'finished';
      state.caneHeld = true;
      state.speed = 0;
      events.push({ type: 'finish' });
      return;
    }

    state.stageIndex += 1;
    state.gateNotifiedFor = '';
    events.push({ type: 'stage', stage: state.stageIndex });
  }
}

export function stepGame(state, input = {}, deltaSeconds = 1 / 60) {
  const dt = clamp(Number(deltaSeconds) || 0, 0, 0.08);
  const events = [];
  if (state.phase !== 'playing' || dt === 0) return events;

  state.elapsed += dt;
  state.collisionLock = Math.max(0, state.collisionLock - dt);
  const previousZ = state.player.z;
  const moveX = clamp(Number(input.moveX) || 0, -1, 1);
  const forward = clamp(Number(input.forward) || 0, -1, 1);
  const magnitude = Math.min(1, Math.hypot(moveX, forward));
  const hasInput = magnitude > 0.04;
  const hasCane = state.caneHeld;
  const support = state.support;
  const supportFactor = support > 0.72 ? 0.56 : support < 0.2 ? 0.66 : support < 0.3 ? 0.82 : 1;
  const staminaFactor = state.stamina < 12 ? 0.56 : state.stamina < 28 ? 0.78 : 1;
  const balanceFactor = state.balance < 0.28 ? 0.68 : state.balance < 0.52 ? 0.84 : 1;
  const pace = input.sprint ? 2.05 : 1.28;
  const speedScale = clamp(Number(input.speedScale ?? 1), 0.45, 1.6);
  const speed = hasCane && hasInput && state.collisionLock <= 0
    ? pace * speedScale * supportFactor * staminaFactor * balanceFactor * magnitude
    : 0;
  state.speed = speed;

  if (speed > 0) {
    const divisor = Math.max(magnitude, 0.001);
    const nextX = clamp(state.player.x + (moveX / divisor) * speed * dt, GAME_ROUTE.minX, GAME_ROUTE.maxX);
    const nextZ = state.player.z - (forward / divisor) * speed * dt;
    state.player.x = nextX;
    state.player.z = nextZ;
  }

  collectZones(state, events);
  checkObstacleCollisions(state, previousZ, events);
  progressStages(state, events);

  const moving = speed > 0.08;
  const excessSupport = support > 0.72;
  let staminaDelta = 0;
  if (moving) staminaDelta -= input.sprint ? 8.5 * dt : 1.65 * dt;
  if (excessSupport) staminaDelta -= (moving ? 5.5 : 2.2) * dt;
  if (!moving) staminaDelta += state.safeZone ? 13 * dt : 2.2 * dt;
  const eventStaminaDelta = events.reduce((total, event) => {
    if (event.type === 'collision') return total + STAMINA_EVENT_EFFECTS.obstacleCollision;
    if (event.type === 'zone') return total + STAMINA_EVENT_EFFECTS.zoneCollected;
    return total;
  }, 0);
  staminaDelta += eventStaminaDelta;
  state.stamina = clamp(state.stamina + staminaDelta, 0, 100);

  if (!hasCane) state.balance = clamp(state.balance - 0.24 * dt, 0, 1);
  else if (support >= 0.3 && support <= 0.67) state.balance = clamp(state.balance + 0.11 * dt, 0, 1);
  else state.balance = clamp(state.balance - (excessSupport ? 0.24 : 0.13) * dt, 0, 1);

  const effortTarget = events.some((event) => event.type === 'collision')
    ? 1
    : excessSupport
      ? 0.82
      : moving && input.sprint
        ? 0.78
        : moving
          ? 0.34
          : state.safeZone
            ? 0.08
            : 0.16;
  state.effort += (effortTarget - state.effort) * Math.min(1, dt * (moving ? 0.55 : 0.36));
  state.effort = clamp(state.effort, 0, 1);
  state.heartRate = Math.round(68 + state.effort * 66);
  state.breathingRate = Math.round(12 + state.effort * 15);
  return events;
}

export function getStageProgress(state) {
  const stage = GAME_ROUTE.stages[state.stageIndex];
  if (!stage) return 1;
  const length = stage.startZ - stage.endZ;
  return clamp((stage.startZ - state.player.z) / length, 0, 1);
}

export function getJourneyProgress(state) {
  return clamp((GAME_ROUTE.startZ - state.player.z) / (GAME_ROUTE.startZ - GAME_ROUTE.finishZ), 0, 1);
}

export function getCurrentStageZoneProgress(state) {
  const stage = GAME_ROUTE.stages[state.stageIndex];
  if (!stage) return { done: 0, total: 0 };
  const done = stage.zoneIds.filter((id) => state.collectedZones.includes(id)).length;
  return { done, total: stage.zoneIds.length };
}
