import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_ROUTE,
  STAMINA_EVENT_EFFECTS,
  createGameState,
  dismissInstructions,
  dropCane,
  getJourneyProgress,
  grabCane,
  resetGame,
  setSupport,
  stepGame,
  togglePause,
} from '../src/game-engine.js';
import { keyboardAction, readKeyboardInput, readXRInputSources } from '../src/input-mapping.js';

const tick = (state, input = {}, count = 1) => {
  const events = [];
  for (let index = 0; index < count; index += 1) events.push(...stepGame(state, input, 0.05));
  return events;
};

const safeRouteWaypoints = [
  [0, -2.1], [0.62, -4.55], [0.9, -6.3],
  [0.9, -8.8], [-0.64, -10.05], [0.9, -11.5], [0.9, -13.2], [0.62, -14.85], [-0.9, -15.4], [-0.9, -18.2],
  [0.9, -18.7], [0.62, -21.15], [-0.9, -21.5], [-0.9, -24], [-0.62, -25.05], [0.9, -25.5], [0.9, -28], [0.62, -29.2], [-0.9, -29.5], [-0.9, -32.9], [-0.9, -33.0],
];

function moveComfortably(state, input) {
  return tick(state, { ...input, speedScale: 0.72 });
}

function moveTo(state, x, z) {
  let guard = 0;
  while (Math.abs(state.player.x - x) > 0.025 && guard++ < 600) {
    moveComfortably(state, { moveX: Math.sign(x - state.player.x) });
  }
  assert.ok(guard < 600, `failed to strafe to x=${x} at z=${z}`);

  guard = 0;
  while (Math.abs(state.player.z - z) > 0.025 && guard++ < 1200) {
    moveComfortably(state, { forward: state.player.z > z ? 1 : -1 });
  }
  assert.ok(guard < 1200, `failed to reach z=${z} from z=${state.player.z}`);
}

function followRoute(state, startWaypoint = 0, endWaypoint = safeRouteWaypoints.length) {
  safeRouteWaypoints.slice(startWaypoint, endWaypoint).forEach(([x, z]) => moveTo(state, x, z));
  if (endWaypoint === safeRouteWaypoints.length) moveComfortably(state, { forward: 1 });
}

test('the player cannot advance before taking the cane, and dropping it locks movement', () => {
  const state = createGameState({ showInstructions: false });
  tick(state, { forward: 1 }, 20);
  assert.equal(state.player.z, 0);

  assert.equal(grabCane(state), true);
  tick(state, { forward: 1 }, 20);
  assert.ok(state.player.z < 0);
  const droppedAt = state.player.z;

  assert.equal(dropCane(state), true);
  tick(state, { forward: 1 }, 20);
  assert.equal(state.player.z, droppedAt);
  assert.equal(grabCane(state), true);
  tick(state, { forward: 1 }, 5);
  assert.ok(state.player.z < droppedAt);
});

test('keyboard and Quest gamepad inputs map to the same route controls', () => {
  const keyboard = readKeyboardInput(new Set(['KeyW', 'KeyA', 'ShiftLeft', 'BracketRight']));
  assert.deepEqual(keyboard, { moveX: -1, forward: 1, sprint: true, supportDelta: 1 });
  assert.equal(keyboardAction('KeyE'), 'grab');
  assert.equal(keyboardAction('KeyP'), 'pause');
  assert.equal(keyboardAction('KeyR'), 'restart');
  assert.equal(keyboardAction('KeyF'), 'fall');

  const xr = readXRInputSources([
    {
      handedness: 'left',
      gamepad: {
        mapping: 'xr-standard',
        axes: [0, 0, 0.5, -0.75],
        buttons: [{}, { value: 0.5 }, { pressed: false }, { pressed: true }, { pressed: false }, { pressed: false }],
      },
    },
    {
      handedness: 'right',
      gamepad: { axes: [0, 0, 0, 0], buttons: [{}, {}, {}, {}, { pressed: true }, { pressed: true }] },
    },
  ]);
  assert.ok(xr.moveX > 0.4);
  assert.ok(xr.forward > 0.6);
  assert.equal(xr.sprint, true);
  assert.ok(xr.support > 0.6);
  assert.equal(xr.pause, true);
  assert.equal(xr.restart, true);
});

test('xr-standard gamepads with two axes fall back to axes 0 and 1', () => {
  const xr = readXRInputSources([
    {
      handedness: 'left',
      gamepad: {
        mapping: 'xr-standard',
        axes: [0.5, -0.75],
        buttons: [],
      },
    },
  ]);

  assert.ok(xr.moveX > 0.4);
  assert.ok(xr.forward > 0.6);
});

test('adequate support is faster and steadier than excessive support', () => {
  const balanced = createGameState({ showInstructions: false });
  const excessive = createGameState({ showInstructions: false });
  grabCane(balanced);
  grabCane(excessive);
  setSupport(excessive, 0.95);
  tick(balanced, { forward: 1 }, 40);
  tick(excessive, { forward: 1 }, 40);

  assert.ok(balanced.player.z < excessive.player.z);
  assert.ok(balanced.stamina > excessive.stamina);
  assert.ok(balanced.balance > excessive.balance);
});

test('a zone restores exactly 9 stamina once, separate from safe-zone rest recovery', () => {
  const state = createGameState({ showInstructions: false });
  grabCane(state);
  state.player.x = 0;
  state.player.z = -2.1;
  state.stamina = 40;
  const deltaSeconds = 0.05;
  const startingStamina = state.stamina;
  const events = stepGame(state, {}, deltaSeconds);

  assert.equal(STAMINA_EVENT_EFFECTS.zoneCollected, 9);
  assert.equal(events.filter((event) => event.type === 'zone').length, 1);
  const restRecovery = 13 * deltaSeconds;
  assert.ok(Math.abs(state.stamina - startingStamina - restRecovery - STAMINA_EVENT_EFFECTS.zoneCollected) < 1e-12);

  const staminaAfterPickup = state.stamina;
  const nextEvents = stepGame(state, {}, deltaSeconds);
  assert.equal(nextEvents.filter((event) => event.type === 'zone').length, 0);
  assert.ok(Math.abs(state.stamina - staminaAfterPickup - restRecovery) < 1e-12);
});

test('an obstacle collision costs exactly 18 stamina once, plus continuous movement drain', () => {
  const state = createGameState({ showInstructions: false });
  grabCane(state);
  state.stageIndex = 1;
  state.collectedZones = ['zone-1', 'zone-2'];
  state.player.x = 0;
  state.player.z = -7.5;
  state.stamina = 60;
  const deltaSeconds = 0.05;
  const startingStamina = state.stamina;
  const events = stepGame(state, { forward: 1 }, deltaSeconds);

  assert.equal(STAMINA_EVENT_EFFECTS.obstacleCollision, -18);
  assert.equal(events.filter((event) => event.type === 'collision').length, 1);
  const walkingDrain = 1.65 * deltaSeconds;
  assert.ok(Math.abs(state.stamina - startingStamina + walkingDrain - STAMINA_EVENT_EFFECTS.obstacleCollision) < 1e-12);
});

test('comfortable locomotion is slower without changing route completion logic', () => {
  const standard = createGameState({ showInstructions: false });
  const comfortable = createGameState({ showInstructions: false });
  grabCane(standard);
  grabCane(comfortable);
  stepGame(standard, { forward: 1, speedScale: 1 }, 0.05);
  stepGame(comfortable, { forward: 1, speedScale: 0.72 }, 0.05);
  assert.ok(standard.player.z < comfortable.player.z);
  assert.ok(standard.speed > comfortable.speed);
});

test('a complete three-stage route can be played from start to finish without collisions', () => {
  const state = createGameState({ showInstructions: false });
  assert.equal(GAME_ROUTE.stages.length, 3);
  assert.equal(grabCane(state), true);

  followRoute(state);

  assert.equal(state.phase, 'finished');
  assert.equal(state.stageIndex, 2);
  assert.equal(state.zonesCompleted, 7);
  assert.equal(state.obstaclesAvoided, 7);
  assert.equal(Object.values(state.obstacleResults).filter((result) => result === 'hit').length, 0);
  assert.equal(state.points, 7 * 25 + 7 * 8);
  assert.ok(state.elapsed > 0);
  assert.equal(getJourneyProgress(state), 1);

  const finishedAt = state.elapsed;
  assert.equal(togglePause(state), 'finished');
  assert.equal(resetGame().phase, 'ready');
  assert.ok(finishedAt > 0);
});

test('the route can still be completed after an obstacle collision', () => {
  const state = createGameState({ showInstructions: false });
  grabCane(state);
  followRoute(state, 0, 3);

  moveTo(state, 0, -7.5);
  assert.equal(state.obstacleResults['obstacle-1'], 'hit');
  followRoute(state, 3);

  assert.equal(state.phase, 'finished');
  assert.equal(state.zonesCompleted, 7);
  assert.equal(state.obstacleResults['obstacle-1'], 'hit');
  assert.equal(Object.values(state.obstacleResults).filter((result) => result === 'hit').length, 1);
  assert.equal(getJourneyProgress(state), 1);
});

test('pause freezes movement and the elapsed timer', () => {
  const state = createGameState({ showInstructions: false });
  grabCane(state);
  tick(state, { forward: 1 }, 10);
  const z = state.player.z;
  const elapsed = state.elapsed;
  assert.ok(state.speed > 0);
  assert.equal(togglePause(state), 'paused');
  assert.equal(state.speed, 0);
  tick(state, { forward: 1 }, 20);
  assert.equal(state.player.z, z);
  assert.equal(state.elapsed, elapsed);
  assert.equal(togglePause(state), 'resumed');
  tick(state, { forward: 1 });
  assert.ok(state.player.z < z);
});
