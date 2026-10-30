import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DYNAMIC_MARKERS,
  DYNAMIC_OBSTACLES,
  DYNAMIC_TRACK,
  attemptDynamicMarkerTouch,
  changeDynamicLane,
  createDynamicTrackState,
  getDynamicMarkerPosition,
  grabDynamicCane,
  laneName,
  releaseDynamicCane,
  stepDynamicTrack,
  toggleDynamicPause,
} from '../src/dynamic-track-engine.js';
import { createGameState, grabCane, stepGame } from '../src/game-engine.js';

function advanceUntil(state, predicate, { maxSteps = 1200, dt = 0.08 } = {}) {
  const events = [];
  for (let index = 0; index < maxSteps && !predicate(); index += 1) {
    events.push(...stepDynamicTrack(state, {}, dt));
  }
  assert.ok(predicate(), 'the expected track state was not reached');
  return events;
}

test('grabbing starts the short track and the finish event is emitted once', () => {
  const state = createDynamicTrackState();
  stepDynamicTrack(state, { forward: 1 }, 0.08);
  assert.equal(state.distance, 0);
  assert.equal(state.phase, 'ready');

  assert.equal(grabDynamicCane(state), true);
  assert.equal(state.phase, 'playing');
  const events = advanceUntil(state, () => state.phase === 'finished');

  assert.equal(state.distance, DYNAMIC_TRACK.finishDistance);
  assert.equal(events.filter((event) => event.type === 'finish').length, 1);
  assert.deepEqual(stepDynamicTrack(state, {}, 0.08), []);
});

test('lane changes move one lane at a time and stay within the three-lane track', () => {
  const state = createDynamicTrackState();
  assert.equal(changeDynamicLane(state, -1).type, 'lane-change-blocked');
  grabDynamicCane(state);

  assert.deepEqual(changeDynamicLane(state, -1), { type: 'lane-change', lane: 0, direction: -1 });
  assert.equal(laneName(state.lane), 'izquierdo');
  assert.equal(changeDynamicLane(state, -1).type, 'lane-change-blocked');
  assert.equal(changeDynamicLane(state, 1).lane, 1);
  assert.equal(changeDynamicLane(state, 1).lane, 2);
  assert.equal(changeDynamicLane(state, 1).type, 'lane-change-blocked');
  stepDynamicTrack(state, {}, 0.08);
  assert.ok(state.lanePosition > 1 && state.lanePosition < 2, 'lane visuals transition smoothly toward the active collision lane');
});

test('changing lanes before an obstacle registers a dodge and no collision', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  changeDynamicLane(state, 1);
  const events = advanceUntil(state, () => state.distance > DYNAMIC_OBSTACLES[0].distance + 0.2);

  assert.equal(events.filter((event) => event.type === 'avoided' && event.id === DYNAMIC_OBSTACLES[0].id).length, 1);
  assert.equal(events.filter((event) => event.type === 'collision').length, 0);
  assert.equal(state.obstaclesAvoided, 1);
  assert.equal(state.collisions, 0);
});

test('a lane change made too close to a cone still collides while the avatar is crossing lanes', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  const obstacle = DYNAMIC_OBSTACLES[0];
  state.distance = obstacle.distance - 0.08;
  const laneChange = changeDynamicLane(state, -1);
  assert.equal(laneChange.type, 'lane-change');
  const events = stepDynamicTrack(state, {}, 0.08);

  assert.equal(events.filter((event) => event.type === 'collision' && event.id === obstacle.id).length, 1);
  assert.equal(state.obstacleResults[obstacle.id], 'hit');
  assert.ok(state.lanePosition > 0, 'the displayed lane transition is still in progress at impact');
});

test('each obstacle collision removes 18 stamina once, separately from movement drain', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  state.stamina = 70;
  const events = advanceUntil(state, () => state.distance > DYNAMIC_OBSTACLES[0].distance + 0.2);
  const collisions = events.filter((event) => event.type === 'collision' && event.id === DYNAMIC_OBSTACLES[0].id);

  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].staminaChange, -DYNAMIC_TRACK.collisionStaminaLoss);
  assert.equal(state.collisions, 1);
  const staminaAfterCollision = state.stamina;
  const additionalEvents = advanceUntil(state, () => state.distance > DYNAMIC_OBSTACLES[0].distance + 1.2);
  assert.equal(additionalEvents.filter((event) => event.type === 'collision').length, 0);
  assert.ok(state.stamina < staminaAfterCollision, 'movement drain continues as a separate effect');
});

test('a marker grants exactly 9 stamina only when the cane tip touches it', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  state.distance = DYNAMIC_MARKERS[0].distance;
  state.stamina = 40;
  const tip = getDynamicMarkerPosition(state, DYNAMIC_MARKERS[0].id);

  const event = attemptDynamicMarkerTouch(state, DYNAMIC_MARKERS[0].id, tip);
  assert.equal(event.type, 'marker');
  assert.equal(event.staminaChange, DYNAMIC_TRACK.markerStaminaReward);
  assert.equal(state.stamina, 49);
  assert.deepEqual(state.markersCompleted, [DYNAMIC_MARKERS[0].id]);
});

test('walking across a visible marker never activates it; a misaligned explicit touch fails', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  state.stamina = 60;
  state.distance = DYNAMIC_MARKERS[0].distance - 0.5;
  const events = advanceUntil(state, () => state.distance > DYNAMIC_MARKERS[0].distance + 0.5, { maxSteps: 20 });

  assert.equal(state.markersCompleted.length, 0);
  assert.equal(events.some((event) => event.type === 'marker'), false);

  const staminaBeforeFailedTouch = state.stamina;
  const target = getDynamicMarkerPosition(state, DYNAMIC_MARKERS[0].id);
  const failed = attemptDynamicMarkerTouch(state, DYNAMIC_MARKERS[0].id, { ...target, z: target.z + 1.1 });
  assert.equal(failed.type, 'touch-failed');
  assert.equal(failed.reason, 'misaligned');
  assert.equal(state.markersCompleted.length, 0);
  assert.equal(state.stamina, staminaBeforeFailedTouch);
});

test('repeated touch actions cannot duplicate a completed marker reward', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  state.distance = DYNAMIC_MARKERS[1].distance;
  state.stamina = 40;
  const tip = getDynamicMarkerPosition(state, DYNAMIC_MARKERS[1].id);

  assert.equal(attemptDynamicMarkerTouch(state, DYNAMIC_MARKERS[1].id, tip).type, 'marker');
  const staminaAfterFirstTouch = state.stamina;
  const repeated = attemptDynamicMarkerTouch(state, DYNAMIC_MARKERS[1].id, tip);

  assert.equal(repeated.type, 'touch-duplicate');
  assert.equal(state.markersCompleted.length, 1);
  assert.equal(state.stamina, staminaAfterFirstTouch);
});

test('movement drain and cane-release rest recovery remain separate from event effects', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  state.stamina = 50;
  state.distance = DYNAMIC_MARKERS[0].distance;
  const markerTip = getDynamicMarkerPosition(state, DYNAMIC_MARKERS[0].id);
  attemptDynamicMarkerTouch(state, DYNAMIC_MARKERS[0].id, markerTip);
  assert.equal(state.stamina, 50 + DYNAMIC_TRACK.markerStaminaReward);

  stepDynamicTrack(state, {}, 0.08);
  const staminaAfterMoving = state.stamina;
  assert.ok(staminaAfterMoving < 50 + DYNAMIC_TRACK.markerStaminaReward);
  releaseDynamicCane(state);
  stepDynamicTrack(state, {}, 0.08);
  assert.ok(state.stamina > staminaAfterMoving, 'rest recovery does not award another marker bonus');
  assert.equal(state.markersCompleted.length, 1);
});

test('pause freezes distance and stamina until the player resumes', () => {
  const state = createDynamicTrackState();
  grabDynamicCane(state);
  stepDynamicTrack(state, {}, 0.08);
  assert.equal(toggleDynamicPause(state), 'paused');
  const snapshot = { distance: state.distance, stamina: state.stamina, elapsed: state.elapsed };
  stepDynamicTrack(state, {}, 0.08);
  assert.deepEqual({ distance: state.distance, stamina: state.stamina, elapsed: state.elapsed }, snapshot);
  assert.equal(toggleDynamicPause(state), 'resumed');
});

test('the free-walk mode keeps its own walk-activated zone behavior and state', () => {
  const freeState = createGameState({ showInstructions: false });
  grabCane(freeState);
  freeState.player.z = -2.1;
  const dynamicState = createDynamicTrackState();
  grabDynamicCane(dynamicState);
  dynamicState.distance = DYNAMIC_MARKERS[0].distance - 0.4;

  const freeEvents = stepGame(freeState, {}, 0.05);
  stepDynamicTrack(dynamicState, {}, 0.08);

  assert.equal(freeEvents.filter((event) => event.type === 'zone').length, 1);
  assert.equal(freeState.zonesCompleted, 1);
  assert.deepEqual(dynamicState.markersCompleted, []);
  assert.equal(DYNAMIC_MARKERS.length, 4);
});
