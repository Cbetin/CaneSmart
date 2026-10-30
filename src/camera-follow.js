export function translateCameraWithPlayer(cameraPosition, targetPosition, previousPlayer, playerPosition) {
  const deltaX = playerPosition.x - previousPlayer.x;
  const deltaZ = playerPosition.z - previousPlayer.z;

  cameraPosition.x += deltaX;
  cameraPosition.z += deltaZ;
  targetPosition.x += deltaX;
  targetPosition.z += deltaZ;
}
