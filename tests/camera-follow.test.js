import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCameraWithPlayer } from '../src/camera-follow.js';

const closeTo = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: expected ${expected}, got ${actual}`);
};

test('desktop camera follow translates camera and target together without changing a mouse-chosen view', () => {
  // This offset represents an orbit/zoomed view the player has chosen with the mouse.
  const camera = { x: 5.0, y: 4.2, z: 3.4 };
  const target = { x: 0.28, y: 0.88, z: -3.8 };
  let previousPlayer = { x: 0, z: 0 };
  const viewOffset = {
    x: camera.x - target.x,
    y: camera.y - target.y,
    z: camera.z - target.z,
  };
  const targetOffsetFromPlayer = {
    x: target.x - previousPlayer.x,
    y: target.y,
    z: target.z - previousPlayer.z,
  };
  const startDistance = Math.hypot(viewOffset.x, viewOffset.y, viewOffset.z);
  const routeSamples = [
    { x: 0, z: 0 },
    { x: 0.42, z: -4.5 },
    { x: -0.2, z: -12 },
    { x: 0.8, z: -18 },
    { x: 0.62, z: -25 },
    { x: -0.6, z: -33 }, // finish
    { x: 0.1, z: -25 }, // reverse from the finish
    { x: -0.4, z: -16 },
    { x: 0.4, z: -7 },
    { x: 0, z: 0 }, // return to the start
  ];

  for (const player of routeSamples) {
    translateCameraWithPlayer(camera, target, previousPlayer, player);

    closeTo(camera.x - target.x, viewOffset.x, 'horizontal view offset');
    closeTo(camera.y - target.y, viewOffset.y, 'vertical view offset');
    closeTo(camera.z - target.z, viewOffset.z, 'depth view offset');
    closeTo(Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z), startDistance, 'camera-to-target distance');
    closeTo(target.x - player.x, targetOffsetFromPlayer.x, 'target stays beside the player');
    closeTo(target.y, targetOffsetFromPlayer.y, 'target height remains unchanged');
    closeTo(target.z - player.z, targetOffsetFromPlayer.z, 'target stays at the same route-relative position');

    previousPlayer = { ...player };
  }

  closeTo(camera.x, 5.0, 'camera returns to its start x after a full out-and-back path');
  closeTo(camera.z, 3.4, 'camera returns to its start z after a full out-and-back path');
  closeTo(target.x, 0.28, 'target returns to its start x after a full out-and-back path');
  closeTo(target.z, -3.8, 'target returns to its start z after a full out-and-back path');
});
