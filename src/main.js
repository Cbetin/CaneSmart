import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import caneModelUrl from '../Baston_2.obj?url';
import sketchUrl from '../BastonBoceto.webp?url';
import {
  GAME_ROUTE,
  createGameState,
  dismissInstructions,
  dropCane,
  getCurrentStageZoneProgress,
  getJourneyProgress,
  grabCane,
  resetGame,
  setSupport,
  stepGame,
  togglePause,
} from './game-engine.js';
import { keyboardAction, movementRelativeToView, readKeyboardInput, readXRInputSources } from './input-mapping.js';
import { translateCameraWithPlayer } from './camera-follow.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const mount = $('#scene');
const viewer = $('#viewer-shell');
const loadingCard = $('#loading-card');
const webglError = $('#webgl-error');
const instructionsScreen = $('#instructions-screen');
const pauseScreen = $('#pause-screen');
const finishScreen = $('#finish-screen');
const takeButton = $('#take-button');
const pauseButton = $('#pause-button');
const supportSlider = $('#support-slider');
const comfortToggle = $('#comfort-toggle');
const xrButton = $('#enter-vr');
const xrButtonLabel = $('#xr-button-label');
const xrSupportNote = $('#xr-support-note');
const xrGuideText = $('#xr-guide-text');
$('#sketch-link').href = sketchUrl;

const MODEL_SCALE = 0.58;
const PLATFORM_TOP = 0.075;
const DEFAULT_YAW = -0.18;
const COURSE_CAMERA_LOOK_AHEAD = 0.8;
const COURSE_CAMERA_TARGET_HEIGHT = 0.95;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fmt = new Intl.NumberFormat('es-CO');

let gameState = createGameState();
let appMode = 'product';
let scene;
let camera;
let renderer;
let controls;
let worldGroup;
let courseGroup;
let productPlatform;
let playerAvatar;
let avatarHead;
let avatarTorso;
let avatarLeftLeg;
let avatarRightLeg;
let caneRoot;
let modelLoaded = false;
let activeController = null;
let activeGripKind = '';
let desktopCamera = null;
let elapsedScene = 0;
let uiAccumulator = 0;
let hudAccumulator = 0;
let toastTimeout = 0;
let lastNoCaneToast = 0;
let soundContext = null;
let comfortEnabled = true;
let vrHud;
let vrHudTexture;
let vrHudContext;
let worldBoard;
let worldBoardTexture;
let worldBoardContext;
let worldBoardCanvas;
let lastWorldBoardSignature = '';
let comfortMask;
let fallDemoState = 'idle';
let fallDemoPausedRun = false;
let zoneVisuals = [];
let obstacleVisuals = [];
const modelMeshes = [];
const pressedKeys = new Set();
const mouseMove = { forward: false, back: false, left: false, right: false, sprint: false };
const controllers = [];
const previousXRButtons = { pause: false, restart: false };
const raycaster = new THREE.Raycaster();
const rayMatrix = new THREE.Matrix4();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const movementForward = new THREE.Vector3();
const cameraFollowPlayerPosition = { x: 0, z: 0 };
const clock = new THREE.Clock();

function setXRMessage(buttonText, note, guideText, disabled = true) {
  xrButton.disabled = disabled;
  xrButtonLabel.textContent = buttonText;
  xrSupportNote.textContent = note;
  xrGuideText.textContent = guideText;
}

function showViewerError(title, message) {
  const strong = webglError.querySelector('strong');
  const detail = webglError.querySelector('span:last-child');
  if (strong) strong.textContent = title;
  if (detail) detail.textContent = message;
  webglError.hidden = false;
  loadingCard.classList.add('is-hidden');
}

function setupThree() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    console.warn('WebGL no está disponible en este navegador.', error);
    showViewerError('El visor 3D no está disponible', 'Prueba con un navegador actualizado y activa la aceleración gráfica.');
    setXRMessage('WebXR no disponible', 'Este navegador no ofrece WebXR inmersivo.', 'El juego sigue disponible en computador con el panel de movimiento.');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  mount.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Visor 3D de CaneSmart: arrastra para rotar el bastón y desplázate para acercar');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x09140f);
  scene.fog = new THREE.Fog(0x09140f, 17, 48);

  camera = new THREE.PerspectiveCamera(36, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.02, 90);
  camera.position.set(1.55, 1.4, 1.83);
  scene.add(camera);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.34, 0.62, -0.42);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.minDistance = 1.35;
  controls.maxDistance = 5.8;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.update();
  controls.saveState();

  addLighting();
  worldGroup = new THREE.Group();
  worldGroup.name = 'Recorrido CaneSmart';
  scene.add(worldGroup);
  courseGroup = new THREE.Group();
  courseGroup.name = 'Geometría de la ruta';
  courseGroup.visible = false;
  worldGroup.add(courseGroup);
  buildCourse();
  createProductPlatform();
  createPlayer();
  createCaneStand();
  createXRHud();
  createWorldBoard();
  createComfortMask();
  addXRControllers();
  activateProductPresentation();
  loadCaneModel();
  setWebXRSupport();

  const resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(mount);
  window.addEventListener('resize', resizeRenderer, { passive: true });

  renderer.xr.addEventListener('sessionstart', onXRSessionStart);
  renderer.xr.addEventListener('sessionend', onXRSessionEnd);
  renderer.setAnimationLoop(renderFrame);
}

function addLighting() {
  scene.add(new THREE.HemisphereLight(0xd9ead9, 0x17241d, 1.55));
  const key = new THREE.DirectionalLight(0xf3f3df, 3.2);
  key.position.set(4, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.0002;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x80c59a, 1.1);
  fill.position.set(-4, 4, -8);
  scene.add(fill);

  const productFill = new THREE.DirectionalLight(0xffe7c4, 1.15);
  productFill.position.set(-2.2, 3.4, 3.1);
  scene.add(productFill);

  const gateLight = new THREE.PointLight(0x8dd6a3, 4.3, 9, 1.7);
  gateLight.position.set(0, 2.1, -33);
  scene.add(gateLight);
}

function createBasicBox(parent, size, position, material, castShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createLabelTexture(title, subtitle, accent = '#a9dfb2') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(9, 23, 15, .94)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(172, 222, 179, .56)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.fillStyle = accent;
  ctx.fillRect(24, 27, 7, 88);
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.fillStyle = '#9cb2a0';
  ctx.fillText('CANESMART · RECORRIDO', 52, 45);
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillStyle = '#ecf3e9';
  ctx.fillText(title, 52, 87);
  ctx.font = '500 18px system-ui, sans-serif';
  ctx.fillStyle = '#a7b8a8';
  ctx.fillText(subtitle, 52, 119);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeCourseGate(z, title, subtitle, { finish = false } = {}) {
  const group = new THREE.Group();
  group.position.z = z;
  const metal = new THREE.MeshStandardMaterial({
    color: finish ? 0x486d4a : 0x263b2e,
    metalness: 0.58,
    roughness: 0.31,
    emissive: finish ? 0x214725 : 0x0d2013,
    emissiveIntensity: 0.58,
  });
  const beamWidth = finish ? 3.7 : 3.5;
  createBasicBox(group, [0.105, 2.2, 0.12], [-1.7, 1.1, 0], metal);
  createBasicBox(group, [0.105, 2.2, 0.12], [1.7, 1.1, 0], metal);
  createBasicBox(group, [beamWidth, 0.12, 0.14], [0, 2.18, 0], metal);

  const texture = createLabelTexture(title, subtitle, finish ? '#e9cb8e' : '#a9dfb2');
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(finish ? 1.75 : 1.48, finish ? 0.5 : 0.42),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, toneMapped: false })
  );
  label.position.set(0, 1.77, 0.085);
  group.add(label);
  if (finish) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 0.16),
      new THREE.MeshBasicMaterial({ color: 0xe8ca86, transparent: true, opacity: 0.84 })
    );
    banner.position.set(0, 2.29, 0.09);
    group.add(banner);
  }
  courseGroup.add(group);
  return group;
}

function buildCourse() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(82, 82),
    new THREE.MeshStandardMaterial({ color: 0x0b1510, roughness: 0.94, metalness: 0.02 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.035, -15.5);
  floor.receiveShadow = true;
  courseGroup.add(floor);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(3.55, 38),
    new THREE.MeshStandardMaterial({ color: 0x17251c, roughness: 0.82, metalness: 0.11 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.012, -15.8);
  road.receiveShadow = true;
  courseGroup.add(road);

  const railMat = new THREE.MeshStandardMaterial({ color: 0x618c6b, emissive: 0x284a32, emissiveIntensity: 0.72, metalness: 0.42, roughness: 0.3 });
  [-1.78, 1.78].forEach((x) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 37.8), railMat);
    rail.position.set(x, 0.012, -15.8);
    courseGroup.add(rail);
  });

  const centerMat = new THREE.MeshBasicMaterial({ color: 0x668c6b, transparent: true, opacity: 0.25 });
  for (let z = -1.2; z > GAME_ROUTE.finishZ + 1; z -= 2.15) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.013, 0.56), centerMat);
    dash.position.set(0, 0.006, z);
    courseGroup.add(dash);
  }

  const segmentTints = [0x1d3023, 0x1a2b20, 0x1c2d21];
  GAME_ROUTE.stages.forEach((stage, index) => {
    const length = Math.abs(stage.startZ - stage.endZ);
    const segment = new THREE.Mesh(
      new THREE.PlaneGeometry(3.42, length),
      new THREE.MeshBasicMaterial({ color: segmentTints[index], transparent: true, opacity: 0.14, depthWrite: false })
    );
    segment.rotation.x = -Math.PI / 2;
    segment.position.set(0, -0.002, (stage.startZ + stage.endZ) / 2);
    courseGroup.add(segment);
  });

  makeCourseGate(-0.85, 'INICIO', 'Toma el bastón', {});
  makeCourseGate(-6, 'TRAMO 02', 'Esquiva y avanza');
  makeCourseGate(-18, 'TRAMO 03', 'Último desafío');
  makeCourseGate(GAME_ROUTE.finishZ - 0.25, 'META', '¡Lo lograste!', { finish: true });

  createTargets();
  createObstacles();
}

function createProductPlatform() {
  productPlatform = new THREE.Group();
  productPlatform.name = 'Plataforma de exhibición del bastón';
  productPlatform.position.set(0.34, 0, -0.42);

  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x17251d, metalness: 0.58, roughness: 0.31 });
  const topMaterial = new THREE.MeshStandardMaterial({ color: 0x263b2e, metalness: 0.48, roughness: 0.3, emissive: 0x0d1c12, emissiveIntensity: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.74, 0.075, 80), baseMaterial);
  base.position.y = 0.0375;
  base.castShadow = true;
  base.receiveShadow = true;
  productPlatform.add(base);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.012, 80), topMaterial);
  top.position.y = 0.078;
  top.castShadow = true;
  top.receiveShadow = true;
  productPlatform.add(top);

  const accent = new THREE.MeshBasicMaterial({ color: 0x8dd6a3, transparent: true, opacity: 0.75 });
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.009, 8, 96), accent);
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.086;
  productPlatform.add(outerRing);
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.004, 6, 96),
    new THREE.MeshBasicMaterial({ color: 0xd6bd82, transparent: true, opacity: 0.38 })
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.086;
  productPlatform.add(innerRing);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.006, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0x8ec99c, transparent: true, opacity: 0.24, depthWrite: false })
  );
  halo.position.set(0, 0.72, -0.32);
  productPlatform.add(halo);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0,0,0,.42)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 1.8),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.085;
  productPlatform.add(shadow);
  worldGroup.add(productPlatform);
}

function createTargets() {
  zoneVisuals = [];
  for (const zone of GAME_ROUTE.zones) {
    const group = new THREE.Group();
    group.position.set(zone.x, 0, zone.z);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.44, 48),
      new THREE.MeshBasicMaterial({ color: 0x58d1b0, transparent: true, opacity: 0.23, depthWrite: false, side: THREE.DoubleSide })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.008;
    group.add(glow);

    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x85f4d1, transparent: true, opacity: 0.94, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.018, 8, 52), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.032;
    group.add(ring);

    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 28),
      new THREE.MeshBasicMaterial({ color: 0xc4ffe3, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.015;
    group.add(inner);

    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.009, 6, 32),
      new THREE.MeshBasicMaterial({ color: 0xd1ffe6, transparent: true, opacity: 0.8, depthWrite: false })
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.y = 0.18;
    group.add(marker);

    group.userData = { id: zone.id, ring, glow, marker };
    courseGroup.add(group);
    zoneVisuals.push(group);
  }
}

function createObstacles() {
  obstacleVisuals = [];
  const coneMaterial = new THREE.MeshStandardMaterial({ color: 0xd98652, roughness: 0.42, metalness: 0.1, emissive: 0x4b2011, emissiveIntensity: 0.26 });
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf2e3c4, roughness: 0.5 });
  for (const obstacle of GAME_ROUTE.obstacles) {
    const group = new THREE.Group();
    group.position.set(obstacle.x, 0, obstacle.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.31, 0.07, 8), coneMaterial);
    base.position.y = 0.04;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.58, 7), coneMaterial);
    cone.position.y = 0.35;
    cone.castShadow = true;
    group.add(cone);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.055, 7), stripeMaterial);
    stripe.position.y = 0.34;
    stripe.castShadow = true;
    group.add(stripe);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.33, 0.009, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xf0aa76, transparent: true, opacity: 0.56, depthWrite: false })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.015;
    group.add(halo);
    group.userData = { id: obstacle.id, halo, cone };
    courseGroup.add(group);
    obstacleVisuals.push(group);
  }
}

function makeCapsule(radius, length, material, position, parent, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 9), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createPlayer() {
  playerAvatar = new THREE.Group();
  playerAvatar.name = 'Personaje virtual';
  playerAvatar.visible = false;
  const jacket = new THREE.MeshStandardMaterial({ color: 0x74b68a, roughness: 0.6, metalness: 0.04 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x243a31, roughness: 0.76 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc59b7b, roughness: 0.72 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0xd4e1d1, roughness: 0.58 });

  avatarTorso = makeCapsule(0.17, 0.34, jacket, [0, 1.12, 0], playerAvatar);
  avatarTorso.scale.set(1.02, 1.05, 0.76);
  avatarHead = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), skin);
  avatarHead.position.set(0, 1.57, -0.01);
  avatarHead.castShadow = true;
  playerAvatar.add(avatarHead);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.127, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.54), new THREE.MeshStandardMaterial({ color: 0x28332b, roughness: 0.93 }));
  hair.position.copy(avatarHead.position);
  hair.position.y += 0.025;
  playerAvatar.add(hair);

  makeCapsule(0.045, 0.27, skin, [-0.245, 1.12, -0.02], playerAvatar, [0, 0, -0.16]);
  makeCapsule(0.045, 0.27, skin, [0.245, 1.12, -0.02], playerAvatar, [0, 0, 0.16]);
  avatarLeftLeg = makeCapsule(0.068, 0.37, pants, [-0.1, 0.51, 0], playerAvatar);
  avatarRightLeg = makeCapsule(0.068, 0.37, pants, [0.1, 0.51, 0], playerAvatar);
  const leftShoe = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), shoes);
  leftShoe.scale.set(0.08, 0.055, 0.14);
  leftShoe.position.set(-0.1, 0.12, -0.055);
  playerAvatar.add(leftShoe);
  const rightShoe = leftShoe.clone();
  rightShoe.position.x = 0.1;
  playerAvatar.add(rightShoe);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x050a07, transparent: true, opacity: 0.34, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  playerAvatar.add(shadow);
  worldGroup.add(playerAvatar);
}

function createCaneStand() {
  caneRoot = new THREE.Group();
  caneRoot.name = 'CaneSmart · Baston_2.obj';
  caneRoot.position.set(0.34, PLATFORM_TOP, -0.42);
  caneRoot.rotation.y = DEFAULT_YAW;
  worldGroup.add(caneRoot);
}

function setProductCamera() {
  if (!camera || !controls || renderer?.xr.isPresenting) return;
  controls.enableDamping = true;
  camera.position.set(1.55, 1.4, 1.83);
  controls.target.set(0.34, 0.62, -0.42);
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.minDistance = 1.35;
  controls.maxDistance = 5.8;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.update();
  controls.saveState();
}

function setCourseCamera() {
  if (!camera || !controls || renderer?.xr.isPresenting) return;
  controls.enableDamping = false;
  controls.update();
  const { x, z } = gameState.player;
  cameraFollowPlayerPosition.x = x;
  cameraFollowPlayerPosition.z = z;
  camera.position.set(x + 0.28, 2.55, z + 4.8);
  controls.target.set(x + 0.28, COURSE_CAMERA_TARGET_HEIGHT, z - COURSE_CAMERA_LOOK_AHEAD);
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.minDistance = 5.1;
  controls.maxDistance = 10.5;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.update();
  controls.saveState();
}

function recenterCamera() {
  if (!controls || renderer?.xr.isPresenting) return;
  controls.enabled = true;
  if (appMode === 'product') setProductCamera();
  else if (appMode === 'game' || appMode === 'instructions') setCourseCamera();
}

function activateProductPresentation() {
  if (courseGroup) courseGroup.visible = false;
  if (playerAvatar) playerAvatar.visible = false;
  if (worldBoard) worldBoard.visible = false;
  if (productPlatform) productPlatform.visible = true;
  viewer.classList.add('is-product-view');
  if (controls && !renderer?.xr.isPresenting) {
    controls.enabled = true;
    setProductCamera();
  }
}

function activateCoursePresentation() {
  if (courseGroup) courseGroup.visible = true;
  if (playerAvatar) playerAvatar.visible = true;
  if (productPlatform) productPlatform.visible = true;
  viewer.classList.remove('is-product-view');
  if (controls && !renderer?.xr.isPresenting) {
    controls.enabled = true;
    setCourseCamera();
  }
}

function createWorldBoard() {
  worldBoardCanvas = document.createElement('canvas');
  worldBoardCanvas.width = 640;
  worldBoardCanvas.height = 320;
  worldBoardContext = worldBoardCanvas.getContext('2d');
  worldBoardTexture = new THREE.CanvasTexture(worldBoardCanvas);
  worldBoardTexture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: worldBoardTexture, transparent: true, side: THREE.DoubleSide, depthTest: false, toneMapped: false });
  worldBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), material);
  worldBoard.position.set(0, 2.28, -1.48);
  worldBoard.renderOrder = 10;
  worldBoard.visible = false;
  worldGroup.add(worldBoard);
  paintWorldBoard('RUTA CANESMART', ['Aprieta el gatillo para tomar el bastón.', 'Joystick izquierdo: muévete según hacia dónde miras.', 'La cabeza gira naturalmente; no necesitas caminar físicamente.']);
}

function paintWorldBoard(title, lines) {
  if (!worldBoardContext || !worldBoardTexture) return;
  const signature = `${title}|${lines.join('|')}`;
  if (signature === lastWorldBoardSignature) return;
  lastWorldBoardSignature = signature;
  const ctx = worldBoardContext;
  ctx.clearRect(0, 0, worldBoardCanvas.width, worldBoardCanvas.height);
  ctx.fillStyle = 'rgba(8, 20, 13, .91)';
  ctx.fillRect(10, 10, 620, 300);
  ctx.strokeStyle = 'rgba(155, 216, 165, .7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, 616, 296);
  ctx.fillStyle = '#a9dfb2';
  ctx.fillRect(32, 37, 6, 34);
  ctx.font = '700 27px system-ui, sans-serif';
  ctx.fillStyle = '#edf4e9';
  ctx.fillText(title, 56, 63);
  ctx.font = '500 19px system-ui, sans-serif';
  ctx.fillStyle = '#c0d1c2';
  lines.slice(0, 4).forEach((line, index) => ctx.fillText(line, 39, 115 + index * 43, 560));
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = '#d6c28b';
  ctx.fillText('Lecturas del personaje: SIMULADAS', 39, 280);
  worldBoardTexture.needsUpdate = true;
}

function createXRHud() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  vrHudContext = canvas.getContext('2d');
  vrHudTexture = new THREE.CanvasTexture(canvas);
  vrHudTexture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: vrHudTexture, transparent: true, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
  vrHud = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), material);
  vrHud.position.set(0.62, 0.08, -1.25);
  vrHud.renderOrder = 20;
  vrHud.visible = false;
  camera.add(vrHud);
  paintXRHud();
}

function paintXRHud() {
  if (!vrHudContext || !vrHudTexture) return;
  const ctx = vrHudContext;
  ctx.clearRect(0, 0, 512, 320);
  ctx.fillStyle = 'rgba(8, 21, 13, .83)';
  ctx.fillRect(4, 4, 504, 312);
  ctx.strokeStyle = 'rgba(165, 218, 171, .5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 500, 308);
  const stage = GAME_ROUTE.stages[gameState.stageIndex];
  ctx.font = '700 23px system-ui, sans-serif';
  ctx.fillStyle = '#a8dcb0';
  ctx.fillText(`TRAMO ${String(gameState.stageIndex + 1).padStart(2, '0')} / 03`, 28, 42);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e8f2e7';
  ctx.fillText(`${Math.round(getJourneyProgress(gameState) * 100)}%`, 480, 42);
  ctx.textAlign = 'left';
  ctx.font = '700 27px system-ui, sans-serif';
  ctx.fillStyle = '#eef4e9';
  ctx.fillText(stage?.title ?? 'Meta', 28, 82);
  ctx.font = '500 19px system-ui, sans-serif';
  ctx.fillStyle = '#c1d0c1';
  ctx.fillText(gameState.caneHeld ? stage?.goal ?? 'Cruza la meta.' : 'Toma el bastón para avanzar.', 28, 117, 445);
  ctx.fillStyle = '#233c2b';
  ctx.fillRect(28, 139, 450, 12);
  ctx.fillStyle = '#9ad6a4';
  ctx.fillRect(28, 139, 450 * gameState.stamina / 100, 12);
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillStyle = '#d8e4d7';
  ctx.fillText(`ESTAMINA SIMULADA  ${Math.round(gameState.stamina)}%`, 28, 180);
  ctx.fillText(`APOYO SIMULADO  ${Math.round(gameState.support * 100)}%`, 28, 212);
  ctx.fillStyle = '#a6b6a6';
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.fillText(`PUNTOS ${gameState.points}  ·  ZONAS ${gameState.zonesCompleted}/7  ·  EVITADOS ${gameState.obstaclesAvoided}/7`, 28, 256);
  ctx.fillText('Pulso y respiración del personaje: simulados.', 28, 287);
  vrHudTexture.needsUpdate = true;
}

function createComfortMask() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 38, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.52, 'rgba(0,0,0,.03)');
  gradient.addColorStop(1, 'rgba(0,0,0,.74)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  comfortMask = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.5),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.78, depthTest: false, toneMapped: false })
  );
  comfortMask.position.set(0, 0, -1.03);
  comfortMask.renderOrder = 30;
  comfortMask.visible = false;
  camera.add(comfortMask);
}

function addXRControllers() {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const material = new THREE.LineBasicMaterial({ color: 0xa6f0bd, transparent: true, opacity: 0.54, depthWrite: false });
    const ray = new THREE.Line(geometry, material);
    ray.scale.z = 2.35;
    ray.visible = false;
    controller.add(ray);
    controller.userData.ray = ray;
    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data?.handedness ?? '';
    });
    controller.addEventListener('disconnected', () => {
      controller.userData.handedness = '';
    });
    controller.addEventListener('selectstart', () => tryGrabWithController(controller, 'trigger'));
    controller.addEventListener('selectend', () => releaseFromController(controller, 'trigger'));
    controller.addEventListener('squeezestart', () => tryGrabWithController(controller, 'grip'));
    controller.addEventListener('squeezeend', () => releaseFromController(controller, 'grip'));
    scene.add(controller);
    controllers.push(controller);
  }
}

function applyProductMaterial(object, bounds) {
  const minY = bounds.min.y;
  const height = Math.max(bounds.max.y - bounds.min.y, 0.001);
  const stops = [
    [0, 0x27302c], [0.105, 0x1f2824], [0.16, 0x59665f], [0.27, 0xa0aaa0],
    [0.43, 0x69786f], [0.57, 0x9ba79d], [0.76, 0x65746b], [0.84, 0x29312d], [1, 0x1a211e],
  ].map(([at, hex]) => [at, new THREE.Color(hex)]);
  const sampleColor = (t) => {
    for (let index = 0; index < stops.length - 1; index += 1) {
      const [start, from] = stops[index];
      const [end, to] = stops[index + 1];
      if (t <= end) return from.clone().lerp(to, THREE.MathUtils.clamp((t - start) / Math.max(end - start, 0.0001), 0, 1));
    }
    return stops.at(-1)[1].clone();
  };

  object.traverse((child) => {
    if (!child.isMesh) return;
    const positions = child.geometry.getAttribute('position');
    if (positions && !child.geometry.getAttribute('color')) {
      const colors = new Float32Array(positions.count * 3);
      const color = new THREE.Color();
      for (let index = 0; index < positions.count; index += 1) {
        color.copy(sampleColor(THREE.MathUtils.clamp((positions.getY(index) - minY) / height, 0, 1)));
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
      }
      child.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    child.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.54,
      roughness: 0.34,
      clearcoat: 0.28,
      clearcoatRoughness: 0.33,
    });
    child.castShadow = true;
    child.receiveShadow = true;
    modelMeshes.push(child);
  });
}

function loadCaneModel() {
  new OBJLoader().load(
    caneModelUrl,
    (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      applyProductMaterial(object, bounds);
      object.position.set(-center.x, -bounds.min.y, -center.z);
      object.scale.setScalar(MODEL_SCALE);
      caneRoot.add(object);
      modelLoaded = true;
      const positions = modelMeshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count ?? 0), 0);
      $('#model-status').textContent = `Baston_2.obj · ${fmt.format(positions)} posiciones`;
      $('#loading-message').textContent = 'Modelo listo · toma el bastón para empezar';
      $('#loading-percent').textContent = 'OK';
      takeButton.disabled = false;
      window.setTimeout(() => loadingCard.classList.add('is-hidden'), 260);
      renderUI();
    },
    (event) => {
      if (event.total > 0) {
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
        $('#loading-percent').textContent = `${percent}%`;
        $('#loading-message').textContent = `Descargando Baston_2.obj · ${percent}%`;
      } else if (event.loaded > 0) {
        $('#loading-message').textContent = `Descargando Baston_2.obj · ${(event.loaded / 1048576).toFixed(1)} MB`;
      }
    },
    (error) => {
      console.error('No se pudo cargar Baston_2.obj.', error);
      showViewerError('No se pudo cargar el modelo 3D', 'Comprueba que Baston_2.obj esté disponible y vuelve a cargar la página.');
      $('#model-status').textContent = 'Error al cargar Baston_2.obj';
      takeButton.disabled = true;
    }
  );
}

function grabForDesktop() {
  if (!modelLoaded || gameState.phase === 'instructions' || gameState.phase === 'paused' || gameState.phase === 'finished') return;
  if (gameState.caneHeld) {
    if (activeController) return;
    releaseCaneToCourse();
    return;
  }
  playerAvatar.attach(caneRoot);
  caneRoot.position.set(0.3, 0.03, 0.05);
  caneRoot.rotation.set(0, DEFAULT_YAW, 0);
  grabCane(gameState);
  if (controls && !renderer?.xr.isPresenting) controls.enabled = true;
  setMessage('Agarre listo · avanza a ritmo moderado.', 'good');
  ensureAudio();
  renderUI();
}

function releaseCaneToCourse() {
  if (!gameState.caneHeld) return;
  if (activeController) {
    releaseFromController(activeController, activeGripKind);
    return;
  }
  worldGroup.attach(caneRoot);
  caneRoot.position.set(gameState.player.x + 0.38, PLATFORM_TOP, gameState.player.z + 0.12);
  caneRoot.rotation.set(0, DEFAULT_YAW, 0);
  dropCane(gameState);
  setMessage('Bastón suelto · recógelo antes de seguir avanzando.', 'warning');
  renderUI();
}

function controllerRayHitsCane(controller) {
  controller.updateWorldMatrix(true, false);
  rayMatrix.identity().extractRotation(controller.matrixWorld);
  rayOrigin.setFromMatrixPosition(controller.matrixWorld);
  rayDirection.set(0, 0, -1).applyMatrix4(rayMatrix).normalize();
  raycaster.set(rayOrigin, rayDirection);
  raycaster.far = 2.6;
  caneRoot.updateWorldMatrix(true, true);
  return raycaster.intersectObject(caneRoot, true).length > 0;
}

function tryGrabWithController(controller, gripKind) {
  if (!renderer?.xr.isPresenting || !modelLoaded || gameState.phase === 'instructions' || gameState.phase === 'paused' || gameState.phase === 'finished' || gameState.caneHeld) return;
  if (!controllerRayHitsCane(controller)) {
    setMessage('Apunta el mando al bastón y mantén gatillo o grip.', 'warning');
    return;
  }
  controller.attach(caneRoot);
  caneRoot.position.set(0, -1.65 * MODEL_SCALE, -0.1);
  caneRoot.rotation.set(0, 0, 0);
  activeController = controller;
  activeGripKind = gripKind;
  grabCane(gameState);
  setMessage('Bastón sujeto · usa el joystick izquierdo para avanzar.', 'good');
  ensureAudio();
  renderUI();
}

function releaseFromController(controller, gripKind) {
  if (activeController !== controller || activeGripKind !== gripKind || !gameState.caneHeld) return;
  worldGroup.attach(caneRoot);
  caneRoot.position.set(gameState.player.x + 0.38, PLATFORM_TOP, gameState.player.z + 0.12);
  caneRoot.rotation.set(0, DEFAULT_YAW, 0);
  activeController = null;
  activeGripKind = '';
  dropCane(gameState);
  setMessage('Bastón suelto · agárralo para seguir.', 'warning');
  renderUI();
}

function createAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!soundContext) soundContext = new AudioContextConstructor();
  return soundContext;
}

function ensureAudio() {
  try {
    const context = createAudioContext();
    if (context?.state === 'suspended') context.resume();
  } catch (error) {
    console.info('Audio de juego no disponible.', error);
  }
}

function tone(frequency, duration, type = 'sine', volume = 0.035, delay = 0) {
  try {
    const context = createAudioContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  } catch (error) {
    console.info('No se pudo reproducir el efecto de audio.', error);
  }
}

function playFeedback(type) {
  if (type === 'zone') {
    tone(660, 0.09, 'sine', 0.035);
    tone(880, 0.12, 'sine', 0.028, 0.075);
  } else if (type === 'collision') {
    tone(180, 0.12, 'triangle', 0.06);
    tone(115, 0.16, 'sawtooth', 0.025, 0.07);
    viewer.classList.add('is-hit');
    window.setTimeout(() => viewer.classList.remove('is-hit'), 300);
    const sources = renderer?.xr.getSession()?.inputSources ?? [];
    for (const source of sources) {
      const actuator = source.gamepad?.hapticActuators?.[0] ?? source.gamepad?.vibrationActuator;
      actuator?.pulse?.(0.45, 120);
    }
  } else if (type === 'stage' || type === 'finish') {
    tone(type === 'finish' ? 740 : 520, 0.13, 'sine', 0.04);
    tone(type === 'finish' ? 990 : 720, 0.17, 'sine', 0.03, 0.1);
  } else if (type === 'grab') {
    tone(410, 0.07, 'sine', 0.025);
  }
}

function setMessage(text, kind = 'good', duration = 2200) {
  const toast = $('#game-toast');
  toast.textContent = text;
  toast.classList.toggle('is-warning', kind === 'warning');
  toast.hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { toast.hidden = true; }, duration);
}

function handleGameEvents(events) {
  for (const event of events) {
    if (event.type === 'zone') {
      setMessage(`+${event.points} puntos · zona segura · estamina recuperada`, 'good');
      playFeedback('zone');
    } else if (event.type === 'collision') {
      setMessage('¡Contacto! −15 puntos y estamina. Reduce el ritmo y esquiva el siguiente.', 'warning', 2600);
      playFeedback('collision');
    } else if (event.type === 'avoided') {
      setMessage(`Bien esquivado · +${event.points} puntos`, 'good', 1200);
    } else if (event.type === 'gate') {
      const noun = event.remaining === 1 ? 'zona objetivo' : 'zonas objetivo';
      setMessage(`Completa ${event.remaining} ${noun} del tramo antes de seguir hacia la meta.`, 'warning', 3200);
    } else if (event.type === 'stage') {
      const stage = GAME_ROUTE.stages[event.stage];
      setMessage(`Tramo ${event.stage + 1}: ${stage.title}`, 'good', 2400);
      playFeedback('stage');
    } else if (event.type === 'finish') {
      setMessage('¡Meta alcanzada!', 'good', 4000);
      playFeedback('finish');
      showFinishScreen();
    }
  }
}

function renderUI() {
  const stage = GAME_ROUTE.stages[gameState.stageIndex] ?? GAME_ROUTE.stages.at(-1);
  const stageProgress = getCurrentStageZoneProgress(gameState);
  const journey = Math.round(getJourneyProgress(gameState) * 100);
  const isProductView = appMode === 'product';
  const isInstructions = appMode === 'instructions';
  const isResetChoice = appMode === 'reset-choice';
  const statusText = isProductView
    ? 'INSPECCIÓN 3D'
    : isResetChoice
      ? 'RECORRIDO REINICIADO'
      : isInstructions
        ? 'INSTRUCCIONES'
        : gameState.phase === 'ready'
          ? (gameState.caneHeld ? 'LISTO' : 'TOMA EL BASTÓN')
          : gameState.phase === 'paused'
            ? 'EN PAUSA'
            : gameState.phase === 'finished'
              ? 'EN LA META'
              : gameState.caneHeld
                ? 'RECORRIDO ACTIVO'
                : 'BASTÓN SUELTO';
  const panelStatus = $('#panel-status');
  panelStatus.classList.toggle('is-playing', appMode === 'game' && gameState.phase === 'playing' && gameState.caneHeld);
  panelStatus.classList.toggle('is-paused', appMode === 'game' && gameState.phase === 'paused');
  panelStatus.classList.toggle('is-finished', appMode === 'game' && gameState.phase === 'finished');
  $('#panel-status-text').textContent = appMode === 'game' && gameState.phase === 'playing' && !gameState.caneHeld ? 'AGARRA EL BASTÓN' : statusText;
  $('#viewer-status').textContent = statusText;
  $('#state-dot').classList.toggle('is-paused', appMode === 'game' && gameState.phase === 'paused');
  $('#panel-kicker').textContent = isProductView ? 'MODELO INTERACTIVO' : 'TU RECORRIDO';
  $('#stage-title').textContent = isProductView ? 'Vista del bastón' : stage.title;
  $('#product-panel-card').hidden = !isProductView;
  $('#game-panel-content').hidden = isProductView;
  $('#route-markers').hidden = isProductView;
  $('#begin-route').hidden = !isProductView;
  $('#begin-route').disabled = !modelLoaded;
  $('#xr-wrap').hidden = appMode !== 'game';
  takeButton.hidden = appMode !== 'game';
  pauseButton.hidden = appMode !== 'game';
  $('#reset-button').hidden = appMode !== 'game';
  $('#recenter-camera').hidden = !controls || appMode !== 'game' || Boolean(renderer?.xr.isPresenting);
  $('#stage-number').textContent = `TRAMO ${String(gameState.stageIndex + 1).padStart(2, '0')} / 03`;
  $('#stage-goal').textContent = !gameState.caneHeld && gameState.phase !== 'instructions'
    ? 'Toma el bastón para desbloquear el movimiento; después completa las zonas de este tramo.'
    : stage.goal;
  $('#stage-progress-text').textContent = `${stageProgress.done} / ${stageProgress.total} zonas`;
  $('#stage-progress-bar').style.width = `${stageProgress.total ? (stageProgress.done / stageProgress.total) * 100 : 0}%`;
  $('#journey-progress-text').textContent = String(journey);
  $('#journey-progress-bar').style.width = `${journey}%`;
  $('#score-value').textContent = fmt.format(gameState.points);
  $('#timer-value').textContent = formatTime(gameState.elapsed);
  $('#zones-value').textContent = `${gameState.zonesCompleted} / ${GAME_ROUTE.zones.length}`;
  $('#obstacles-value').textContent = `${gameState.obstaclesAvoided} / ${GAME_ROUTE.obstacles.length}`;
  $('#support-value').textContent = String(Math.round(gameState.support * 100));
  $('#support-meter').style.left = `${gameState.support * 100}%`;
  if (document.activeElement !== supportSlider) supportSlider.value = String(Math.round(gameState.support * 100));
  $('#heart-rate').textContent = String(gameState.heartRate);
  $('#breathing-rate').textContent = String(gameState.breathingRate);
  $('#stamina-value').textContent = String(Math.round(gameState.stamina));
  $('#stamina-bar').style.width = `${gameState.stamina}%`;
  $('#stamina-bar').classList.toggle('is-low', gameState.stamina < 28);

  const supportStatus = $('#support-status');
  supportStatus.classList.toggle('is-high', gameState.support > 0.72);
  supportStatus.classList.toggle('is-low', gameState.support < 0.25);
  supportStatus.textContent = gameState.support > 0.72
    ? 'Exceso · avanzas más lento'
    : gameState.support < 0.25
      ? 'Apoyo bajo · equilibrio inestable'
      : gameState.support < 0.3 || gameState.support > 0.67
        ? 'Ajusta hacia el centro'
        : 'Apoyo moderado · estable';
  $('#support-hint').textContent = gameState.support > 0.72
    ? 'Apoyo excesivo reduce velocidad y gasta estamina; baja el valor.'
    : gameState.support < 0.25
      ? 'Un apoyo muy bajo hace más difícil mantener el equilibrio.'
      : 'Mantén el indicador en la zona verde para avanzar con equilibrio.';
  $('#effort-title').textContent = `Esfuerzo ${gameState.effort > 0.66 ? 'alto' : gameState.effort > 0.33 ? 'moderado' : 'suave'}`;
  document.querySelectorAll('.stage-step').forEach((step) => {
    const index = Number(step.dataset.stage);
    step.classList.toggle('is-current', index === gameState.stageIndex && gameState.phase !== 'finished');
    step.classList.toggle('is-done', index < gameState.stageIndex || gameState.phase === 'finished');
  });

  const isPlaying = gameState.phase === 'playing';
  takeButton.disabled = !modelLoaded || gameState.phase === 'instructions' || gameState.phase === 'paused' || gameState.phase === 'finished' || Boolean(activeController);
  takeButton.classList.toggle('is-held', gameState.caneHeld);
  $('#take-button-label').textContent = gameState.caneHeld ? 'Soltar bastón' : 'Tomar bastón';
  pauseButton.disabled = !isPlaying;
  pauseButton.setAttribute('aria-label', gameState.phase === 'paused' ? 'Reanudar recorrido' : 'Pausar recorrido');
  $('#pause-screen').hidden = appMode !== 'game' || gameState.phase !== 'paused' || fallDemoState !== 'idle';
  $('#finish-screen').hidden = appMode !== 'game' || gameState.phase !== 'finished';
  $('#instructions-screen').hidden = appMode !== 'instructions';
  $('#reset-choice-screen').hidden = appMode !== 'reset-choice';
  $('#return-product-from-game').hidden = appMode !== 'game';
  $('#canvas-objective').textContent = isProductView
    ? 'Arrastra para girar · rueda para acercar'
    : isInstructions
      ? 'Lee las instrucciones y prepara el recorrido'
      : gameState.phase === 'ready' || !gameState.caneHeld
        ? 'Sin bastón no puedes avanzar'
        : gameState.phase === 'finished'
          ? 'Recorrido completo · puedes volver a jugar'
          : stage.goal;
  $('#canvas-objective-label').textContent = isProductView
    ? 'INSPECCIÓN DEL MODELO 3D'
    : gameState.phase === 'finished'
      ? 'META'
      : `TRAMO ${String(gameState.stageIndex + 1).padStart(2, '0')} · OBJETIVO`;
  updateFallDemoUI();
  updateWorldBoard();
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const remainder = String(total % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function updateWorldBoard() {
  if (!worldBoard) return;
  if (appMode === 'product') {
    worldBoard.visible = false;
    return;
  }
  if (fallDemoState === 'alerting') {
    worldBoard.visible = true;
    paintWorldBoard('ALERTA SIMULADA', ['La caída y la respuesta ocurren solo en esta demo.', 'No se enviaron llamadas ni mensajes.', 'Responde o cierra la prueba desde el panel.']);
  } else if (fallDemoState === 'responded') {
    worldBoard.visible = true;
    paintWorldBoard('RESPUESTA FICTICIA', ['El contacto no fue notificado.', 'Esta respuesta solo cambia la pantalla.', 'Cierra la prueba cuando quieras.']);
  } else if (gameState.phase === 'instructions' || gameState.phase === 'ready') {
    worldBoard.visible = true;
    paintWorldBoard('RUTA CANESMART', ['Aprieta el gatillo para tomar el bastón.', 'Joystick izquierdo: dirección horizontal del visor.', 'Apoyo moderado: avanzas con más equilibrio.']);
  } else if (gameState.phase === 'paused') {
    worldBoard.visible = true;
    paintWorldBoard('PAUSA', ['Pulso y ritmo: simulados.', 'Pulsa A / X para continuar.', 'Usa Y / B para reiniciar.']);
  } else if (gameState.phase === 'finished') {
    worldBoard.visible = true;
    paintWorldBoard('¡META!', [`Puntuación: ${gameState.points}`, `Zonas: ${gameState.zonesCompleted}/7 · Evitados: ${gameState.obstaclesAvoided}/7`, 'Pulsa A / X para volver a jugar.']);
  } else if (!gameState.caneHeld) {
    worldBoard.visible = true;
    paintWorldBoard('BASTÓN SUELTO', ['Apunta y mantén el gatillo o grip.', 'Sin agarre el personaje no avanza.', 'El recorrido y sus datos son simulados.']);
  } else {
    worldBoard.visible = false;
  }
}

function showFinishScreen() {
  $('#final-time').textContent = formatTime(gameState.elapsed);
  $('#final-score').textContent = fmt.format(gameState.points);
  $('#final-obstacles').textContent = `${gameState.obstaclesAvoided} / ${GAME_ROUTE.obstacles.length}`;
  $('#final-zones').textContent = `${gameState.zonesCompleted} / ${GAME_ROUTE.zones.length}`;
  if (controls) controls.enabled = false;
  renderUI();
}

function resetRun({ showChoices = false } = {}) {
  if (activeController && worldGroup && caneRoot) {
    worldGroup.attach(caneRoot);
    activeController = null;
    activeGripKind = '';
  } else if (playerAvatar && caneRoot?.parent === playerAvatar) {
    worldGroup.attach(caneRoot);
  }
  gameState = resetGame({ showInstructions: false });
  appMode = showChoices ? 'reset-choice' : 'game';
  fallDemoState = 'idle';
  fallDemoPausedRun = false;
  viewer.classList.remove('is-alerting');
  if (caneRoot) {
    caneRoot.visible = true;
    caneRoot.position.set(0.34, PLATFORM_TOP, -0.42);
    caneRoot.rotation.set(0, DEFAULT_YAW, 0);
  }
  if (worldGroup) worldGroup.position.set(0, 0, 0);
  if (playerAvatar) {
    playerAvatar.position.set(0, 0, 0);
    playerAvatar.rotation.set(0, 0, 0);
  }
  pressedKeys.clear();
  Object.keys(mouseMove).forEach((key) => { mouseMove[key] = false; });
  activateCoursePresentation();
  const immersive = Boolean(renderer?.xr.isPresenting);
  if (controls) controls.enabled = !immersive;
  renderUI();
  if (showChoices) $('#game-toast').hidden = true;
  else setMessage('Recorrido reiniciado · toma el bastón para empezar.', 'good');
}

function showRouteInstructions() {
  if (appMode !== 'product' || !modelLoaded) return;
  appMode = 'instructions';
  pressedKeys.clear();
  Object.keys(mouseMove).forEach((key) => { mouseMove[key] = false; });
  activateCoursePresentation();
  renderUI();
}

function returnToProductView() {
  if (activeController && worldGroup && caneRoot) {
    worldGroup.attach(caneRoot);
    activeController = null;
    activeGripKind = '';
  } else if (playerAvatar && caneRoot?.parent === playerAvatar) {
    worldGroup.attach(caneRoot);
  }
  gameState = createGameState();
  appMode = 'product';
  fallDemoState = 'idle';
  fallDemoPausedRun = false;
  viewer.classList.remove('is-alerting');
  if (worldGroup) worldGroup.position.set(0, 0, 0);
  if (playerAvatar) {
    playerAvatar.position.set(0, 0, 0);
    playerAvatar.rotation.set(0, 0, 0);
  }
  if (caneRoot) {
    caneRoot.visible = true;
    caneRoot.position.set(0.34, PLATFORM_TOP, -0.42);
    caneRoot.rotation.set(0, DEFAULT_YAW, 0);
  }
  pressedKeys.clear();
  Object.keys(mouseMove).forEach((key) => { mouseMove[key] = false; });
  activateProductPresentation();
  if (controls) controls.enabled = !renderer?.xr.isPresenting;
  $('#game-toast').hidden = true;
  renderUI();
}

function startFromInstructions() {
  if (appMode !== 'instructions') return;
  dismissInstructions(gameState);
  appMode = 'game';
  pressedKeys.clear();
  Object.keys(mouseMove).forEach((key) => { mouseMove[key] = false; });
  instructionsScreen.hidden = true;
  activateCoursePresentation();
  if (controls) controls.enabled = !renderer?.xr.isPresenting;
  setMessage('Toma el bastón para desbloquear el recorrido.', 'good', 2800);
  ensureAudio();
  renderUI();
}

function pauseOrResume() {
  const outcome = togglePause(gameState);
  if (outcome === 'paused') {
    setMessage('Recorrido en pausa.', 'warning');
    paintWorldBoard('PAUSA', ['Pulso y ritmo: simulados.', 'Pulsa A / X para continuar.', 'Usa Y / B para reiniciar.']);
  } else if (outcome === 'resumed') {
    setMessage('Seguimos · mantén un ritmo cómodo.', 'good');
  }
  renderUI();
}

function setSupportByStep(amount) {
  setSupport(gameState, gameState.support + amount);
  renderUI();
  const advice = gameState.support > 0.72 ? 'Exceso de apoyo: reduce la fuerza para recuperar velocidad.' : gameState.support < 0.25 ? 'Apoyo bajo: sube un poco para mejorar el equilibrio.' : 'Apoyo moderado: buen equilibrio.';
  setMessage(advice, gameState.support > 0.72 || gameState.support < 0.25 ? 'warning' : 'good', 1800);
}

function updateFallDemoUI() {
  const card = $('#alert-demo-card');
  const status = $('#alert-status');
  const title = $('#alert-title');
  const description = $('#alert-description');
  const meta = $('#alert-meta');
  const actions = $('#alert-actions');
  const button = $('#simulate-fall');
  const replyButton = $('#reply-contact');
  const resolveButton = $('#resolve-alert');
  const active = fallDemoState !== 'idle';
  card.classList.toggle('is-alerting', fallDemoState === 'alerting');
  card.classList.toggle('is-responded', fallDemoState === 'responded');
  button.disabled = active || gameState.phase === 'instructions' || gameState.phase === 'finished';
  actions.hidden = !active;
  replyButton.hidden = fallDemoState !== 'alerting';
  resolveButton.textContent = fallDemoState === 'responded' ? 'Cerrar prueba' : 'Estoy bien · cerrar prueba';

  if (fallDemoState === 'alerting') {
    status.textContent = 'ALERTA SIMULADA';
    title.textContent = 'Caída simulada detectada';
    description.textContent = 'En un sistema real se mostraría una opción para responder. Esta demostración ocurre solo en esta pantalla.';
    meta.textContent = 'No se enviaron llamadas, mensajes ni datos.';
  } else if (fallDemoState === 'responded') {
    status.textContent = 'RESPUESTA SIMULADA';
    title.textContent = 'El contacto respondió';
    description.textContent = 'La respuesta es ficticia y solo cambia la interfaz; no se contactó a ninguna persona.';
    meta.textContent = 'Sin llamadas, mensajes ni ubicación compartida.';
  } else {
    status.textContent = 'DEMO · SIMULADA';
    title.textContent = 'Respuesta ante una caída';
    description.textContent = 'Muestra una caída del personaje y una opción de respuesta. La prueba es local: no envía alertas ni se comunica con nadie.';
    meta.textContent = 'Sin llamadas, mensajes ni ubicación real.';
  }
}

function startFallDemo() {
  if (fallDemoState !== 'idle' || gameState.phase === 'instructions' || gameState.phase === 'finished') return;
  fallDemoPausedRun = gameState.phase === 'playing';
  if (fallDemoPausedRun && gameState.caneHeld) releaseCaneToCourse();
  if (fallDemoPausedRun) togglePause(gameState);
  fallDemoState = 'alerting';
  viewer.classList.add('is-alerting');
  updateFallDemoUI();
  renderUI();
  tone(290, 0.14, 'triangle', 0.045);
  setMessage('Caída de demostración · alerta solo local; no se contacta a nadie.', 'warning', 4200);
}

function simulateContactResponse() {
  if (fallDemoState !== 'alerting') return;
  fallDemoState = 'responded';
  updateFallDemoUI();
  renderUI();
  tone(540, 0.09, 'sine', 0.035);
  setMessage('Respuesta ficticia recibida en la pantalla; no se envió ningún mensaje.', 'good', 3000);
}

function resolveFallDemo() {
  if (fallDemoState === 'idle') return;
  fallDemoState = 'idle';
  viewer.classList.remove('is-alerting');
  if (fallDemoPausedRun && gameState.phase === 'paused') togglePause(gameState);
  fallDemoPausedRun = false;
  updateFallDemoUI();
  renderUI();
  setMessage('Prueba local cerrada. Si soltaste el bastón, tómalo para seguir.', 'good', 2500);
}

function handleKeyboardAction(action) {
  if (action === 'start') {
    if (appMode === 'product') showRouteInstructions();
    else if (appMode === 'instructions') startFromInstructions();
    else if (gameState.phase === 'paused') pauseOrResume();
    else if (gameState.phase === 'finished') resetRun();
  } else if (action === 'grab') {
    if (appMode !== 'game' || gameState.phase === 'instructions') return;
    if (gameState.caneHeld) releaseCaneToCourse();
    else grabForDesktop();
  } else if (action === 'pause') {
    if (appMode !== 'game') return;
    if (fallDemoState !== 'idle') resolveFallDemo();
    else pauseOrResume();
  } else if (action === 'restart') {
    if (appMode === 'game') resetRun({ showChoices: true });
  } else if (action === 'recenter') {
    recenterCamera();
  } else if (action === 'fall') {
    if (appMode === 'game') startFallDemo();
  }
}

function setupDesktopControls() {
  $('#begin-route').addEventListener('click', showRouteInstructions);
  $('#recenter-camera').addEventListener('click', recenterCamera);
  $('#start-game').addEventListener('click', startFromInstructions);
  $('#take-button').addEventListener('click', () => {
    if (gameState.caneHeld) releaseCaneToCourse();
    else grabForDesktop();
  });
  $('#pause-button').addEventListener('click', pauseOrResume);
  $('#reset-button').addEventListener('click', () => resetRun({ showChoices: true }));
  $('#resume-game').addEventListener('click', pauseOrResume);
  $('#reset-from-pause').addEventListener('click', () => resetRun({ showChoices: true }));
  $('#replay-game').addEventListener('click', () => resetRun());
  $('#reset-play-again').addEventListener('click', () => resetRun());
  $('#reset-return-product').addEventListener('click', returnToProductView);
  $('#finish-return-product').addEventListener('click', returnToProductView);
  $('#return-product-from-game').addEventListener('click', returnToProductView);
  $('#simulate-fall').addEventListener('click', startFallDemo);
  $('#reply-contact').addEventListener('click', simulateContactResponse);
  $('#resolve-alert').addEventListener('click', resolveFallDemo);

  supportSlider.addEventListener('input', () => {
    setSupport(gameState, Number(supportSlider.value) / 100);
    renderUI();
  });
  $('#support-down').addEventListener('click', () => setSupportByStep(-0.05));
  $('#support-up').addEventListener('click', () => setSupportByStep(0.05));
  comfortToggle.addEventListener('change', () => {
    comfortEnabled = comfortToggle.checked;
    setMessage(comfortEnabled ? 'Desplazamiento cómodo activado.' : 'Velocidad estándar activada.', 'good', 1600);
  });

  const moveNames = { forward: 'forward', back: 'back', left: 'left', right: 'right' };
  document.querySelectorAll('.dpad-button').forEach((button) => {
    const direction = moveNames[button.dataset.move];
    const release = () => {
      mouseMove[direction] = false;
      button.classList.remove('is-pressed');
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      mouseMove[direction] = true;
      button.classList.add('is-pressed');
      button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });

  const sprintButton = $('#sprint-button');
  const releaseSprint = () => {
    mouseMove.sprint = false;
    sprintButton.classList.remove('is-pressed');
  };
  sprintButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    mouseMove.sprint = true;
    sprintButton.classList.add('is-pressed');
    sprintButton.setPointerCapture?.(event.pointerId);
  });
  sprintButton.addEventListener('pointerup', releaseSprint);
  sprintButton.addEventListener('pointercancel', releaseSprint);
  sprintButton.addEventListener('lostpointercapture', releaseSprint);

  window.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if ((event.code === 'Enter' || event.code === 'Space') && event.target?.closest?.('button, a')) return;
    const action = keyboardAction(event.code);
    if (action) {
      event.preventDefault();
      if (!event.repeat || action === 'start') handleKeyboardAction(action);
      return;
    }
    const isMovement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'BracketLeft', 'BracketRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(event.code);
    if (isMovement) {
      event.preventDefault();
      pressedKeys.add(event.code);
    }
  });
  window.addEventListener('keyup', (event) => pressedKeys.delete(event.code));
  window.addEventListener('blur', () => {
    pressedKeys.clear();
    Object.keys(mouseMove).forEach((key) => { mouseMove[key] = false; });
    document.querySelectorAll('.is-pressed').forEach((element) => element.classList.remove('is-pressed'));
  });
}

function setWebXRSupport() {
  if (!renderer || !('xr' in navigator)) {
    setXRMessage('WebXR no disponible', 'Este navegador no ofrece WebXR inmersivo.', 'En computador: W/S, A/D y cámara con el ratón. Usa C para recentrar.');
    return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) {
      setXRMessage('WebXR no disponible', 'Este dispositivo no informa compatibilidad con WebXR.', 'Usa el mismo recorrido en computador; WebXR se activa solo en navegadores compatibles.');
      return;
    }
    setXRMessage('Entrar en Meta Quest', 'Joystick izquierdo: muévete según el giro horizontal del visor. La cabeza conserva su seguimiento natural; no necesitas caminar físicamente.', 'Quest: joystick izquierdo según hacia dónde miras; L3 acelera; gatillo sujeta; grip ajusta apoyo.', false);
    xrButton.addEventListener('click', enterImmersiveMode);
  }).catch((error) => {
    console.info('No se pudo consultar WebXR.', error);
    setXRMessage('WebXR no disponible', 'No se pudo consultar compatibilidad WebXR.', 'El juego sigue disponible en computador.');
  });
}

async function enterImmersiveMode() {
  if (!renderer || !navigator.xr || renderer.xr.isPresenting) return;
  desktopCamera = { position: camera.position.clone(), rotation: camera.rotation.clone(), target: controls.target.clone() };
  controls.enabled = false;
  xrButton.disabled = true;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await renderer.xr.setSession(session);
  } catch (error) {
    console.warn('No se pudo iniciar WebXR.', error);
    if (desktopCamera) {
      camera.position.copy(desktopCamera.position);
      camera.rotation.copy(desktopCamera.rotation);
      controls.target.copy(desktopCamera.target);
      desktopCamera = null;
    }
    controls.enabled = true;
    setXRMessage('Reintentar Meta Quest', 'No se pudo iniciar la sesión; revisa permisos y vuelve a probar.', 'WebXR no inició. El recorrido en computador sigue disponible.', false);
    xrButton.disabled = false;
  }
}

function onXRSessionStart() {
  document.body.classList.add('is-immersive');
  renderer.shadowMap.enabled = false;
  previousXRButtons.pause = false;
  previousXRButtons.restart = false;
  if (gameState.caneHeld && !activeController && caneRoot.parent === playerAvatar) {
    worldGroup.attach(caneRoot);
    caneRoot.position.set(gameState.player.x + 0.38, PLATFORM_TOP, gameState.player.z + 0.12);
    caneRoot.rotation.set(0, DEFAULT_YAW, 0);
    dropCane(gameState);
  }
  controls.enabled = false;
  vrHud.visible = true;
  if (comfortMask) comfortMask.visible = false;
  controllers.forEach((controller) => { if (controller.userData.ray) controller.userData.ray.visible = true; });
  if (gameState.phase === 'instructions') {
    dismissInstructions(gameState);
    appMode = 'game';
    activateCoursePresentation();
    instructionsScreen.hidden = true;
  }
  setXRMessage('En Meta Quest', 'Joystick izquierdo: avanza, retrocede y desplázate respecto a la dirección horizontal del visor. Gira la cabeza naturalmente; no necesitas caminar físicamente.', 'A/X pausa; Y/B reinicia. El desplazamiento se controla con el joystick; no camines por la habitación.', true);
  renderUI();
}

function onXRSessionEnd() {
  document.body.classList.remove('is-immersive');
  if (renderer) renderer.shadowMap.enabled = true;
  if (activeController) releaseFromController(activeController, activeGripKind);
  controllers.forEach((controller) => { if (controller.userData.ray) controller.userData.ray.visible = false; });
  if (vrHud) vrHud.visible = false;
  if (comfortMask) comfortMask.visible = false;
  if (desktopCamera) {
    camera.position.copy(desktopCamera.position);
    camera.rotation.copy(desktopCamera.rotation);
    controls.target.copy(desktopCamera.target);
    controls.enabled = gameState.phase !== 'finished';
    desktopCamera = null;
  }
  setXRMessage('Entrar en Meta Quest', 'Joystick izquierdo: muévete según el giro horizontal del visor. La cabeza conserva su seguimiento natural; no necesitas caminar físicamente.', 'Quest: joystick izquierdo según hacia dónde miras; L3 acelera; gatillo sujeta; grip ajusta apoyo.', false);
  renderUI();
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  const width = Math.max(mount.clientWidth, 1);
  const height = Math.max(mount.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}

function getHorizontalViewForward() {
  const viewCamera = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
  if (!viewCamera) return { x: 0, z: -1 };
  viewCamera.getWorldDirection(movementForward);
  movementForward.y = 0;
  if (movementForward.lengthSq() < 1e-8) movementForward.set(0, 0, -1);
  else movementForward.normalize();
  return { x: movementForward.x, z: movementForward.z };
}

function updateDesktopCameraFollow() {
  const playerPosition = gameState.player;
  if (appMode === 'game') {
    if (renderer?.xr.isPresenting) {
      // Keep the saved desktop view aligned while leaving the tracked XR camera untouched.
      if (desktopCamera) {
        translateCameraWithPlayer(
          desktopCamera.position,
          desktopCamera.target,
          cameraFollowPlayerPosition,
          playerPosition,
        );
      }
    } else if (camera && controls) {
      // Applying the same world-space delta preserves the user's orbit and zoom exactly.
      translateCameraWithPlayer(camera.position, controls.target, cameraFollowPlayerPosition, playerPosition);
    }
  }
  cameraFollowPlayerPosition.x = playerPosition.x;
  cameraFollowPlayerPosition.z = playerPosition.z;
}

function activeGameInput(delta) {
  if (appMode !== 'game') return { moveX: 0, forward: 0, sprint: false, speedScale: 1 };
  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    const sources = session ? Array.from(session.inputSources) : [];
    const xrInput = readXRInputSources(sources);
    const left = sources.find((source) => source.handedness === 'left');
    const holdingByLeftGrip = activeController?.userData?.handedness === 'left' && activeGripKind === 'grip';
    if (left && !holdingByLeftGrip) setSupport(gameState, xrInput.support);

    if (xrInput.pause && !previousXRButtons.pause) {
      if (fallDemoState !== 'idle') resolveFallDemo();
      else if (gameState.phase === 'finished') resetRun();
      else pauseOrResume();
    }
    if (xrInput.restart && !previousXRButtons.restart) resetRun();
    previousXRButtons.pause = xrInput.pause;
    previousXRButtons.restart = xrInput.restart;
    const relativeMovement = movementRelativeToView(xrInput, getHorizontalViewForward());
    return { ...xrInput, ...relativeMovement, speedScale: comfortEnabled ? 0.72 : 1 };
  }

  const keyboard = readKeyboardInput(pressedKeys);
  const moveX = clamp(keyboard.moveX + Number(mouseMove.right) - Number(mouseMove.left), -1, 1);
  const forward = clamp(keyboard.forward + Number(mouseMove.forward) - Number(mouseMove.back), -1, 1);
  if (keyboard.supportDelta) setSupport(gameState, gameState.support + keyboard.supportDelta * delta * 0.42);
  const relativeMovement = movementRelativeToView({ moveX, forward }, getHorizontalViewForward());
  return {
    ...relativeMovement,
    sprint: keyboard.sprint || mouseMove.sprint,
    speedScale: comfortEnabled ? 0.72 : 1,
  };
}

function updateSceneFromGame() {
  if (!worldGroup || !playerAvatar) return;
  if (renderer.xr.isPresenting) worldGroup.position.set(-gameState.player.x, 0, -gameState.player.z);
  else worldGroup.position.set(0, 0, 0);
  const isFallDemoActive = fallDemoState !== 'idle';
  playerAvatar.position.set(gameState.player.x, isFallDemoActive ? -0.34 : 0, gameState.player.z);
  const stride = gameState.speed > 0.05 ? Math.sin(elapsedScene * (gameState.speed > 1.55 ? 11 : 7.2)) : 0;
  avatarLeftLeg.rotation.x = stride * 0.32;
  avatarRightLeg.rotation.x = -stride * 0.32;
  avatarTorso.position.y = 1.12 + (gameState.speed > 0.05 ? Math.abs(stride) * 0.025 : 0);
  playerAvatar.rotation.x = isFallDemoActive ? 1.12 : 0;
  playerAvatar.rotation.z = isFallDemoActive ? -0.1 : gameState.balance < 0.45 ? Math.sin(elapsedScene * 2.4) * 0.045 : 0;
  avatarHead.visible = !renderer.xr.isPresenting;

  const collected = new Set(gameState.collectedZones);
  for (const zone of zoneVisuals) {
    const done = collected.has(zone.userData.id);
    const wave = Math.sin(elapsedScene * 3.1 + zone.position.z) * 0.025;
    zone.userData.ring.scale.setScalar(done ? 0.82 : 1 + wave);
    zone.userData.ring.material.color.setHex(done ? 0x8be19b : 0x85f4d1);
    zone.userData.ring.material.opacity = done ? 0.43 : 0.84 + Math.sin(elapsedScene * 4 + zone.position.z) * 0.12;
    zone.userData.marker.position.y = 0.17 + (done ? 0 : Math.sin(elapsedScene * 2.8 + zone.position.z) * 0.035);
    zone.userData.glow.material.opacity = done ? 0.08 : 0.18 + (Math.sin(elapsedScene * 4 + zone.position.z) + 1) * 0.045;
  }
  const results = gameState.obstacleResults;
  for (const obstacle of obstacleVisuals) {
    const result = results[obstacle.userData.id];
    obstacle.userData.halo.material.opacity = result === 'avoided' ? 0.14 : result === 'hit' ? 0.22 : 0.56;
    obstacle.userData.cone.material.emissiveIntensity = result === 'hit' ? 0.08 : 0.26;
  }
}

function showNoCaneReminder(input) {
  if (gameState.caneHeld || !input || (Math.abs(input.moveX) < 0.08 && Math.abs(input.forward) < 0.08)) return;
  if (gameState.phase !== 'ready' && gameState.phase !== 'playing') return;
  const now = performance.now();
  if (now - lastNoCaneToast < 2400) return;
  lastNoCaneToast = now;
  setMessage('Primero toma el bastón: sin agarre no puedes avanzar.', 'warning');
}

function updateComfortEffects(input) {
  const moving = Math.abs(input.moveX) + Math.abs(input.forward) > 0.12 && gameState.caneHeld && gameState.phase === 'playing';
  const immersive = renderer.xr.isPresenting;
  if (comfortMask) comfortMask.visible = immersive && comfortEnabled && moving;
  $('#comfort-vignette').classList.toggle('is-on', immersive && comfortEnabled && moving);
}

function renderFrame() {
  if (!renderer || !scene || !camera) return;
  const delta = Math.min(clock.getDelta(), 0.06);
  elapsedScene += delta;
  const input = activeGameInput(delta);
  if (gameState.phase === 'playing') {
    const events = stepGame(gameState, input, delta);
    handleGameEvents(events);
    showNoCaneReminder(input);
  }
  updateSceneFromGame();
  updateComfortEffects(input);
  updateDesktopCameraFollow();
  if (controls?.enabled && !renderer.xr.isPresenting) controls.update();

  uiAccumulator += delta;
  if (uiAccumulator >= 0.1) {
    renderUI();
    uiAccumulator = 0;
  }
  hudAccumulator += delta;
  if (hudAccumulator >= 0.18 && renderer.xr.isPresenting) {
    paintXRHud();
    hudAccumulator = 0;
  }
  renderer.render(scene, camera);
}

setupDesktopControls();
setupThree();
renderUI();
