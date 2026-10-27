import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_ROUTE,
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
        axes: [0.5, -0.75, 0, 0],
        buttons: [{}, { value: 0.5 }, { pressed: true }, {}, { pressed: false }, { pressed: false }],
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

  const move = (input) => tick(state, { ...input, speedScale: 0.72 });
  const moveTo = (x, z) => {
    let guard = 0;
    while (Math.abs(state.player.x - x) > 0.025 && guard++ < 600) {
      move({ moveX: Math.sign(x - state.player.x) });
    }
    assert.ok(guard < 600, `failed to strafe to x=${x} at z=${z}`);

    guard = 0;
    while (Math.abs(state.player.z - z) > 0.025 && guard++ < 1200) {
      move({ forward: state.player.z > z ? 1 : -1 });
    }
    assert.ok(guard < 1200, `failed to reach z=${z} from z=${state.player.z}`);
  };

  [
    [0, -2.1], [0.62, -4.55], [0.9, -6.3],
    [0.9, -8.8], [-0.64, -10.05], [0.9, -11.5], [0.9, -13.2], [0.62, -14.85], [-0.9, -15.4], [-0.9, -18.2],
    [0.9, -18.7], [0.62, -21.15], [-0.9, -21.5], [-0.9, -24], [-0.62, -25.05], [0.9, -25.5], [0.9, -28], [0.62, -29.2], [-0.9, -29.5], [-0.9, -32.9], [-0.9, -33.0],
  ].forEach(([x, z]) => moveTo(x, z));
  move({ forward: 1 });

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
