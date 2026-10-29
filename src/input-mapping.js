const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function axisValue(value) {
  const deadZone = 0.14;
  const magnitude = Math.abs(value || 0);
  if (magnitude <= deadZone) return 0;
  return Math.sign(value) * clamp((magnitude - deadZone) / (1 - deadZone), 0, 1);
}

export function readKeyboardInput(keys = new Set()) {
  const has = (...codes) => codes.some((code) => keys.has(code));
  return {
    moveX: Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft')),
    forward: Number(has('KeyW', 'ArrowUp')) - Number(has('KeyS', 'ArrowDown')),
    sprint: has('ShiftLeft', 'ShiftRight'),
    supportDelta: Number(has('BracketRight', 'Equal', 'NumpadAdd')) - Number(has('BracketLeft', 'Minus', 'NumpadSubtract')),
  };
}

export function keyboardAction(code) {
  if (code === 'Space' || code === 'KeyE') return 'grab';
  if (code === 'KeyP' || code === 'Escape') return 'pause';
  if (code === 'KeyR') return 'restart';
  if (code === 'KeyF') return 'fall';
  if (code === 'Enter') return 'start';
  return '';
}

function axesFor(inputSource) {
  const gamepad = inputSource?.gamepad;
  const axes = gamepad?.axes ?? [];
  // xr-standard uses axes 0/1 for the touchpad and axes 2/3 for the thumbstick.
  const stickIndex = gamepad?.mapping === 'xr-standard' || axes.length >= 4 ? 2 : 0;
  return { x: axisValue(axes[stickIndex] ?? 0), y: axisValue(axes[stickIndex + 1] ?? 0) };
}

function buttonPressed(inputSource, index) {
  return Boolean(inputSource?.gamepad?.buttons?.[index]?.pressed);
}

export function readXRInputSources(inputSources = []) {
  const left = inputSources.find((source) => source.handedness === 'left');
  const right = inputSources.find((source) => source.handedness === 'right');
  const mover = left ?? right;
  const movement = axesFor(mover);
  const squeeze = clamp(left?.gamepad?.buttons?.[1]?.value ?? 0, 0, 1);

  return {
    moveX: movement.x,
    forward: -movement.y,
    sprint: buttonPressed(left, 3), // L3 press in xr-standard mapping.
    support: 0.42 + squeeze * 0.48,
    pause: buttonPressed(left, 4) || buttonPressed(right, 4),
    restart: buttonPressed(left, 5) || buttonPressed(right, 5),
  };
}
