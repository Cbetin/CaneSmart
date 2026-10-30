export const DYNAMIC_TRACK = Object.freeze({
  laneCount: 3,
  laneSpacing: 1.15,
  finishDistance: 38,
  moderateSpeed: 1.55,
  slowSpeed: 1.02,
  markerTouchRadius: 0.62,
  markerHeight: 0.035,
  laneChangeDurationSeconds: 0.22,
  collisionRadiusMeters: 0.56,
  movementStaminaDrainPerSecond: 0.48,
  restStaminaRecoveryPerSecond: 1.4,
  markerStaminaReward: 9,
  collisionStaminaLoss: 18,
  segmentLength: 6,
});

export const DYNAMIC_MARKERS = Object.freeze([
  { id: 'track-marker-1', distance: 5.8, lane: 1 },
  { id: 'track-marker-2', distance: 13.8, lane: 0 },
  { id: 'track-marker-3', distance: 22.7, lane: 2 },
  { id: 'track-marker-4', distance: 30.4, lane: 1 },
]);

export const DYNAMIC_OBSTACLES = Object.freeze([
  { id: 'track-obstacle-1', distance: 9.5, lane: 1 },
  { id: 'track-obstacle-2', distance: 17.7, lane: 0 },
  { id: 'track-obstacle-3', distance: 26.6, lane: 2 },
  { id: 'track-obstacle-4', distance: 34.2, lane: 1 },
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function laneToX(lane) {
  return (clamp(Number(lane) || 0, 0, DYNAMIC_TRACK.laneCount - 1) - 1) * DYNAMIC_TRACK.laneSpacing;
}

export function laneName(lane) {
  return ['izquierdo', 'central', 'derecho'][clamp(Number(lane) || 0, 0, DYNAMIC_TRACK.laneCount - 1)];
}

export function createDynamicTrackState() {
  return {
    phase: 'ready',
    caneHeld: false,
    elapsed: 0,
    distance: 0,
    lane: 1,
    lanePosition: 1,
    pace: 'moderate',
    speed: 0,
    stamina: 100,
    markersCompleted: [],
    obstacleResults: Object.fromEntries(DYNAMIC_OBSTACLES.map(({ id }) => [id, 'pending'])),
    obstaclesAvoided: 0,
    collisions: 0,
  };
}

export function grabDynamicCane(state) {
  if (state.phase === 'paused' || state.phase === 'finished') return false;
  const newlyHeld = !state.caneHeld;
  state.caneHeld = true;
  if (state.phase === 'ready') state.phase = 'playing';
  return newlyHeld;
}

export function releaseDynamicCane(state) {
  if (!state.caneHeld) return false;
  state.caneHeld = false;
  state.speed = 0;
  return true;
}

export function toggleDynamicPause(state) {
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

export function setDynamicPace(state, pace) {
  if (pace === 'slow' || pace === 'moderate') state.pace = pace;
  return state.pace;
}

export function changeDynamicLane(state, direction) {
  if (state.phase !== 'playing' || !state.caneHeld || ![-1, 1].includes(direction)) {
    return { type: 'lane-change-blocked', lane: state.lane };
  }
  const nextLane = clamp(state.lane + direction, 0, DYNAMIC_TRACK.laneCount - 1);
  if (nextLane === state.lane) return { type: 'lane-change-blocked', lane: state.lane };
  state.lane = nextLane;
  return { type: 'lane-change', lane: state.lane, direction };
}

export function getDynamicMarkerPosition(state, markerId) {
  const marker = DYNAMIC_MARKERS.find(({ id }) => id === markerId);
  if (!marker) return null;
  return {
    x: laneToX(marker.lane),
    y: DYNAMIC_TRACK.markerHeight,
    z: state.distance - marker.distance,
  };
}

export function attemptDynamicMarkerTouch(state, markerId, tipPosition) {
  const marker = DYNAMIC_MARKERS.find(({ id }) => id === markerId);
  if (!marker) return { type: 'touch-failed', id: markerId, reason: 'unknown-marker' };
  if (state.phase !== 'playing' || !state.caneHeld) {
    return { type: 'touch-failed', id: markerId, reason: 'inactive' };
  }
  if (state.markersCompleted.includes(markerId)) {
    return { type: 'touch-duplicate', id: markerId, reason: 'already-completed' };
  }
  if (!tipPosition || !['x', 'y', 'z'].every((axis) => Number.isFinite(Number(tipPosition[axis])))) {
    return { type: 'touch-failed', id: markerId, reason: 'invalid-tip' };
  }

  const target = getDynamicMarkerPosition(state, markerId);
  const distance = Math.hypot(
    Number(tipPosition.x) - target.x,
    Number(tipPosition.y) - target.y,
    Number(tipPosition.z) - target.z,
  );
  if (distance > DYNAMIC_TRACK.markerTouchRadius) {
    return { type: 'touch-failed', id: markerId, reason: 'misaligned', distance };
  }

  state.markersCompleted.push(markerId);
  state.stamina = clamp(state.stamina + DYNAMIC_TRACK.markerStaminaReward, 0, 100);
  return {
    type: 'marker',
    id: markerId,
    staminaChange: DYNAMIC_TRACK.markerStaminaReward,
    stamina: state.stamina,
  };
}

export function attemptNearestDynamicMarkerTouch(state, tipPosition) {
  const pendingMarkers = DYNAMIC_MARKERS
    .filter(({ id }) => !state.markersCompleted.includes(id))
    .map((marker) => ({ marker, position: getDynamicMarkerPosition(state, marker.id) }))
    .sort((a, b) => Math.hypot(
      Number(tipPosition?.x) - a.position.x,
      Number(tipPosition?.y) - a.position.y,
      Number(tipPosition?.z) - a.position.z,
    ) - Math.hypot(
      Number(tipPosition?.x) - b.position.x,
      Number(tipPosition?.y) - b.position.y,
      Number(tipPosition?.z) - b.position.z,
    ));

  if (pendingMarkers.length === 0) {
    const completedMarker = DYNAMIC_MARKERS.find(({ id }) => state.markersCompleted.includes(id));
    return completedMarker
      ? attemptDynamicMarkerTouch(state, completedMarker.id, tipPosition)
      : { type: 'touch-failed', reason: 'no-marker' };
  }
  return attemptDynamicMarkerTouch(state, pendingMarkers[0].marker.id, tipPosition);
}

export function stepDynamicTrack(state, input = {}, deltaSeconds = 1 / 60) {
  const dt = clamp(Number(deltaSeconds) || 0, 0, 0.08);
  const events = [];
  if (state.phase !== 'playing' || dt === 0) return events;

  state.elapsed += dt;
  if (!state.caneHeld) {
    state.speed = 0;
    state.stamina = clamp(state.stamina + DYNAMIC_TRACK.restStaminaRecoveryPerSecond * dt, 0, 100);
    return events;
  }

  const comfortScale = clamp(Number(input.speedScale ?? 1), 0.45, 1);
  const baseSpeed = state.pace === 'slow' ? DYNAMIC_TRACK.slowSpeed : DYNAMIC_TRACK.moderateSpeed;
  const previousDistance = state.distance;
  const previousLanePosition = state.lanePosition;
  const maxLaneStep = dt / DYNAMIC_TRACK.laneChangeDurationSeconds;
  state.lanePosition += clamp(state.lane - state.lanePosition, -maxLaneStep, maxLaneStep);
  state.speed = baseSpeed * comfortScale;
  state.distance = Math.min(DYNAMIC_TRACK.finishDistance, state.distance + state.speed * dt);
  state.stamina = clamp(state.stamina - DYNAMIC_TRACK.movementStaminaDrainPerSecond * dt, 0, 100);

  for (const obstacle of DYNAMIC_OBSTACLES) {
    if (state.obstacleResults[obstacle.id] !== 'pending') continue;
    if (previousDistance >= obstacle.distance || state.distance < obstacle.distance) continue;

    const travel = state.distance - previousDistance;
    const crossingFraction = travel > 0 ? (obstacle.distance - previousDistance) / travel : 1;
    const laneAtCrossing = previousLanePosition + (state.lanePosition - previousLanePosition) * crossingFraction;
    const lateralDistance = Math.abs(laneAtCrossing - obstacle.lane) * DYNAMIC_TRACK.laneSpacing;
    if (lateralDistance <= DYNAMIC_TRACK.collisionRadiusMeters) {
      state.obstacleResults[obstacle.id] = 'hit';
      state.collisions += 1;
      state.stamina = clamp(state.stamina - DYNAMIC_TRACK.collisionStaminaLoss, 0, 100);
      events.push({
        type: 'collision',
        id: obstacle.id,
        staminaChange: -DYNAMIC_TRACK.collisionStaminaLoss,
        stamina: state.stamina,
      });
    } else {
      state.obstacleResults[obstacle.id] = 'avoided';
      state.obstaclesAvoided += 1;
      events.push({ type: 'avoided', id: obstacle.id, lane: state.lane });
    }
  }

  if (state.distance >= DYNAMIC_TRACK.finishDistance) {
    state.phase = 'finished';
    state.speed = 0;
    events.push({
      type: 'finish',
      distance: DYNAMIC_TRACK.finishDistance,
      markersCompleted: state.markersCompleted.length,
      obstaclesAvoided: state.obstaclesAvoided,
      collisions: state.collisions,
    });
  }
  return events;
}
