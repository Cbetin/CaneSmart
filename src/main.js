import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import caneModelUrl from '../Baston_2.obj?url';
import sketchUrl from '../BastonBoceto.webp?url';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const mount = $('#scene');
const viewer = $('#viewer-shell');
const panel = $('.control-panel');
const loadingCard = $('#loading-card');
const webglError = $('#webgl-error');
const xrButton = $('#enter-vr');
const xrButtonLabel = $('#xr-button-label');
const xrSupportNote = $('#xr-support-note');
const xrGuideText = $('#xr-guide-text');
const sketchLink = $('#sketch-link');

sketchLink.href = sketchUrl;

const PLATFORM_TOP = 0.072;
const MODEL_SCALE = 0.58;
const DEFAULT_YAW = -0.34;
const MODES = ['inspect', 'grip', 'walk', 'fall'];
const modeCopy = {
  inspect: { kicker: '01 / INSPECCIÓN', caption: 'Baston_2.obj · vista libre', status: 'VISUALIZACIÓN LISTA', panel: 'LISTO' },
  grip: { kicker: '02 / AGARRE', caption: 'Contacto de mano · simulación', status: 'AGARRE SIMULADO', panel: 'AGARRE DEMO' },
  walk: { kicker: '03 / MARCHA', caption: 'Movimiento · escenario simulado', status: 'MARCHA SIMULADA', panel: 'MARCHA DEMO' },
  fall: { kicker: '04 / RESPUESTA', caption: 'Detección de caída · simulación', status: 'ALERTA SIMULADA', panel: 'CAÍDA DEMO' },
};

let mode = 'inspect';
let alertState = 'idle';
let walkStartedAt = 0;
let scene;
let camera;
let renderer;
let controls;
let caneRoot;
let modelObject;
let handGroup;
let gripRing;
let gripRingMaterial;
let alertRing;
let alertRingMaterial;
let alertPointLight;
let modelLoaded = false;
let heldInVR = false;
let activeController = null;
let elapsed = 0;
let initialCamera = null;
const xrControllers = [];
const modelMeshes = [];
const vrRaycaster = new THREE.Raycaster();
const vrDirection = new THREE.Vector3();
const vrOrigin = new THREE.Vector3();
const vrMatrix = new THREE.Matrix4();
const clock = new THREE.Clock();

function setWebXRMessage(buttonText, note, guideText, disabled = true) {
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
    setWebXRMessage('WebXR no disponible', 'Este navegador no ofrece WebXR inmersivo.', 'Abre la experiencia desde un navegador compatible con Meta Quest.');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Modelo tridimensional interactivo de CaneSmart');
  mount.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1511);
  scene.fog = new THREE.Fog(0x0b1511, 8, 19);

  camera = new THREE.PerspectiveCamera(35, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.02, 70);
  camera.position.set(1.45, 1.48, 2.42);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.56, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 2.1;
  controls.maxDistance = 7.2;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.update();
  controls.saveState();
  initialCamera = { position: camera.position.clone(), target: controls.target.clone() };

  addLighting();
  addStage();
  caneRoot = new THREE.Group();
  caneRoot.name = 'CaneSmart · Baston_2';
  caneRoot.position.set(0, PLATFORM_TOP, 0);
  caneRoot.rotation.y = DEFAULT_YAW;
  scene.add(caneRoot);
  addGripOverlay();
  addXRControllers();
  loadCaneModel();
  setupXRSupport();

  const resizeObserver = new ResizeObserver(() => resizeRenderer());
  resizeObserver.observe(mount);
  window.addEventListener('resize', resizeRenderer, { passive: true });

  renderer.xr.addEventListener('sessionstart', () => {
    if (controls) controls.enabled = false;
    document.body.classList.add('is-immersive');
    setWebXRMessage('Salir del modo inmersivo', 'Pulsa para terminar la sesión o usa el botón de sistema del visor.', 'Dentro del visor: apunta el mando al bastón y pulsa el gatillo para tomarlo.', false);
  });
  renderer.xr.addEventListener('sessionend', () => {
    if (controls) controls.enabled = true;
    document.body.classList.remove('is-immersive');
    heldInVR = false;
    activeController = null;
    if (modelLoaded) {
      scene.attach(caneRoot);
      caneRoot.position.set(0, PLATFORM_TOP, 0);
      caneRoot.rotation.set(0, DEFAULT_YAW, 0);
    }
    setWebXRMessage('Entrar en Meta Quest', 'Para Meta Quest, abre esta página en el navegador del visor.', 'Si WebXR está disponible, entra desde un navegador compatible con Meta Quest.', false);
    setMode('inspect');
  });

  renderer.setAnimationLoop(renderFrame);
}

function addLighting() {
  const hemi = new THREE.HemisphereLight(0xd7edda, 0x1b2921, 1.7);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xf3f3df, 3.1);
  key.position.set(3.6, 5.7, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 4.5;
  key.shadow.camera.bottom = -1.5;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.025;
  scene.add(key);

  const edge = new THREE.SpotLight(0x7bd3ae, 25, 10, Math.PI * 0.24, 0.7, 1.6);
  edge.position.set(-3.0, 3.8, -1.6);
  edge.target.position.set(0, 1, 0);
  scene.add(edge, edge.target);

  const front = new THREE.PointLight(0xc8e0ca, 4.2, 8, 2);
  front.position.set(1.8, 2.2, 3.6);
  scene.add(front);
  alertPointLight = new THREE.PointLight(0xef9d70, 0, 4, 2);
  alertPointLight.position.set(0, 0.4, 0);
  scene.add(alertPointLight);
}

function addStage() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshStandardMaterial({ color: 0x0b1511, roughness: 0.92, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.016;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(16, 44, 0x305242, 0x1c352a);
  grid.position.y = -0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.23;
  grid.material.depthWrite = false;
  scene.add(grid);

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.82, 0.075, 72, 1, false),
    new THREE.MeshStandardMaterial({ color: 0x16231c, metalness: 0.58, roughness: 0.34 })
  );
  podium.position.y = 0.025;
  podium.castShadow = true;
  podium.receiveShadow = true;
  scene.add(podium);

  const podiumTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.78, 0.009, 72),
    new THREE.MeshStandardMaterial({ color: 0x24372b, metalness: 0.48, roughness: 0.44 })
  );
  podiumTop.position.y = 0.067;
  podiumTop.receiveShadow = true;
  scene.add(podiumTop);

  const edgeRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.765, 0.008, 8, 90),
    new THREE.MeshBasicMaterial({ color: 0x71bb8b, transparent: true, opacity: 0.42 })
  );
  edgeRing.rotation.x = Math.PI / 2;
  edgeRing.position.y = 0.072;
  scene.add(edgeRing);

  const backHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.86, 0.006, 6, 96),
    new THREE.MeshBasicMaterial({ color: 0x8ec99c, transparent: true, opacity: 0.15, depthWrite: false })
  );
  backHalo.position.set(0, 0.66, -0.38);
  scene.add(backHalo);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0, 0, 0, .54)');
  gradient.addColorStop(0.38, 'rgba(0, 0, 0, .24)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 1.8),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.78 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.84, 0.84, 1);
  shadow.position.y = 0.078;
  scene.add(shadow);

  alertRingMaterial = new THREE.MeshBasicMaterial({ color: 0xf0a274, transparent: true, opacity: 0, depthWrite: false });
  alertRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.009, 8, 64), alertRingMaterial);
  alertRing.rotation.x = Math.PI / 2;
  alertRing.position.y = 0.079;
  alertRing.visible = false;
  scene.add(alertRing);
}

function addGripOverlay() {
  handGroup = new THREE.Group();
  handGroup.name = 'Visualización conceptual de agarre';
  handGroup.scale.setScalar(MODEL_SCALE);
  handGroup.visible = false;

  const glove = new THREE.MeshPhysicalMaterial({
    color: 0xd4e7d5,
    metalness: 0.08,
    roughness: 0.46,
    transparent: true,
    opacity: 0.88,
    emissive: 0x1a3b25,
    emissiveIntensity: 0.22,
    clearcoat: 0.12,
  });
  const addEllipsoid = (scale, position) => {
    const part = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glove);
    part.scale.set(...scale);
    part.position.set(...position);
    part.castShadow = true;
    handGroup.add(part);
    return part;
  };
  const addCapsule = (radius, length, position, rotation = [0, 0, 0]) => {
    const part = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 9), glove);
    part.position.set(...position);
    part.rotation.set(...rotation);
    part.castShadow = true;
    handGroup.add(part);
    return part;
  };

  // Una mano simplificada, solo para explicar el punto de contacto; no es un escaneo anatómico.
  addEllipsoid([0.095, 0.063, 0.16], [0.082, 1.69, 0.012]);
  addCapsule(0.039, 0.105, [0.126, 1.56, 0.015], [0, 0, -0.12]);
  [-0.112, -0.038, 0.038, 0.112].forEach((z, index) => {
    const spread = index === 0 || index === 3 ? 0.012 : 0;
    addCapsule(0.019, 0.073, [0.02 + spread, 1.625, z], [0, 0, -0.14]);
    addEllipsoid([0.021, 0.025, 0.022], [-0.006 + spread, 1.565, z + (z > 0 ? -0.01 : 0.01)]);
  });
  const thumb = addCapsule(0.024, 0.095, [-0.066, 1.66, 0.135], [0.1, 0, 0.68]);
  thumb.scale.set(1, 1.08, 1);

  caneRoot.add(handGroup);

  gripRingMaterial = new THREE.MeshBasicMaterial({ color: 0x9cebb0, transparent: true, opacity: 0, depthWrite: false });
  gripRing = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.008, 8, 48), gripRingMaterial);
  gripRing.rotation.x = Math.PI / 2;
  gripRing.position.set(0, 1.48, 0);
  gripRing.scale.setScalar(MODEL_SCALE);
  gripRing.visible = false;
  caneRoot.add(gripRing);
}

function applyProductMaterial(object, bounds) {
  const minY = bounds.min.y;
  const height = Math.max(bounds.max.y - bounds.min.y, 0.001);
  const stops = [
    [0.00, 0x27302c],
    [0.105, 0x1f2824],
    [0.16, 0x59665f],
    [0.27, 0xa0aaa0],
    [0.43, 0x69786f],
    [0.57, 0x9ba79d],
    [0.76, 0x65746b],
    [0.84, 0x29312d],
    [1.00, 0x1a211e],
  ].map(([at, hex]) => [at, new THREE.Color(hex)]);

  const sampleColor = (t) => {
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [a, ca] = stops[i];
      const [b, cb] = stops[i + 1];
      if (t <= b) return ca.clone().lerp(cb, THREE.MathUtils.clamp((t - a) / Math.max(b - a, 0.0001), 0, 1));
    }
    return stops[stops.length - 1][1].clone();
  };

  object.traverse((child) => {
    if (!child.isMesh) return;
    const position = child.geometry.getAttribute('position');
    if (position && !child.geometry.getAttribute('color')) {
      const colors = new Float32Array(position.count * 3);
      const color = new THREE.Color();
      for (let i = 0; i < position.count; i += 1) {
        const normalizedY = THREE.MathUtils.clamp((position.getY(i) - minY) / height, 0, 1);
        color.copy(sampleColor(normalizedY));
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
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
      envMapIntensity: 0.8,
    });
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
    modelMeshes.push(child);
  });
}

function loadCaneModel() {
  const loader = new OBJLoader();
  loader.load(
    caneModelUrl,
    (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      applyProductMaterial(object, bounds);
      object.position.set(-center.x, -bounds.min.y, -center.z);
      object.scale.setScalar(MODEL_SCALE);
      object.name = 'Baston_2.obj';
      modelObject = object;
      caneRoot.add(object);
      modelLoaded = true;

      const vertexCount = modelMeshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count || 0), 0);
      const formattedVertices = new Intl.NumberFormat('es-CO').format(vertexCount);
      $('#model-status').textContent = `OBJ · ${formattedVertices} vértices`;
      $('#loading-message').textContent = 'Geometría lista · puedes explorar el objeto';
      $('#loading-percent').textContent = 'OK';
      window.setTimeout(() => loadingCard.classList.add('is-hidden'), 260);
      updateModeUI();
    },
    (event) => {
      if (event.total > 0) {
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
        $('#loading-percent').textContent = `${percent}%`;
        $('#loading-message').textContent = `Descargando Baston_2.obj · ${percent}%`;
      } else if (event.loaded > 0) {
        $('#loading-message').textContent = `Descargando Baston_2.obj · ${(event.loaded / 1024 / 1024).toFixed(1)} MB`;
      }
    },
    (error) => {
      console.error('No se pudo cargar Baston_2.obj.', error);
      showViewerError('No se pudo cargar el modelo 3D', 'Comprueba que Baston_2.obj esté disponible y vuelve a cargar la página.');
      $('#model-status').textContent = 'No se pudo cargar Baston_2.obj';
    }
  );
}

function addXRControllers() {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const rayMaterial = new THREE.LineBasicMaterial({ color: 0xa5efbd, transparent: true, opacity: 0.48, depthWrite: false });
    const ray = new THREE.Line(rayGeometry, rayMaterial);
    ray.scale.z = 1.65;
    controller.add(ray);
    controller.userData.caneRay = ray;

    controller.addEventListener('selectstart', () => {
      if (!modelLoaded || heldInVR || !renderer.xr.isPresenting) return;
      vrMatrix.identity().extractRotation(controller.matrixWorld);
      vrOrigin.setFromMatrixPosition(controller.matrixWorld);
      vrDirection.set(0, 0, -1).applyMatrix4(vrMatrix).normalize();
      vrRaycaster.set(vrOrigin, vrDirection);
      vrRaycaster.far = 2.4;
      const hit = vrRaycaster.intersectObject(caneRoot, true).length > 0;
      if (!hit) return;

      scene.attach(caneRoot);
      controller.attach(caneRoot);
      caneRoot.position.set(0, -1.65 * MODEL_SCALE, -0.08);
      caneRoot.rotation.set(0, 0, 0);
      heldInVR = true;
      activeController = controller;
      setMode('grip');
    });

    controller.addEventListener('selectend', () => {
      if (activeController !== controller || !heldInVR) return;
      scene.attach(caneRoot);
      caneRoot.position.set(0, PLATFORM_TOP, 0);
      caneRoot.rotation.set(0, DEFAULT_YAW, 0);
      heldInVR = false;
      activeController = null;
      setMode('inspect');
    });

    scene.add(controller);
    xrControllers.push(controller);
  }
}

async function setupXRSupport() {
  if (!renderer || !('xr' in navigator)) {
    setWebXRMessage('WebXR no disponible', 'Este navegador no ofrece WebXR inmersivo.', 'WebXR no está disponible aquí. Puedes explorar toda la escena en computador o móvil.');
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    if (!supported) {
      setWebXRMessage('WebXR no disponible', 'Este dispositivo no informa compatibilidad con WebXR inmersivo.', 'En Meta Quest, abre esta página desde el navegador del visor para comprobar WebXR.');
      return;
    }

    setWebXRMessage('Entrar en Meta Quest', 'WebXR disponible. Usa el navegador del visor para entrar en modo inmersivo.', 'Compatible con WebXR: apunta el mando al bastón y pulsa el gatillo para tomarlo.', false);
    xrButton.addEventListener('click', async () => {
      if (renderer.xr.isPresenting) {
        await renderer.xr.getSession()?.end();
        return;
      }
      try {
        const session = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
        await renderer.xr.setSession(session);
      } catch (error) {
        console.warn('No fue posible iniciar la sesión WebXR.', error);
        setWebXRMessage('No se pudo iniciar WebXR', 'No se pudo iniciar la sesión. Verifica los permisos del navegador y vuelve a intentarlo.', 'La sesión inmersiva no se pudo iniciar en este momento.', false);
      }
    });
  } catch (error) {
    console.info('No fue posible consultar compatibilidad WebXR.', error);
    setWebXRMessage('WebXR no disponible', 'No se pudo consultar la compatibilidad WebXR en este navegador.', 'La disponibilidad depende del navegador, el dispositivo y una conexión segura.');
  }
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

function renderFrame() {
  if (!renderer || !scene || !camera) return;
  const delta = Math.min(clock.getDelta(), 0.05);
  elapsed += delta;

  if (modelLoaded && caneRoot && !heldInVR) {
    let targetX = 0;
    let targetY = DEFAULT_YAW;
    let targetZ = 0;
    let targetHeight = PLATFORM_TOP;
    let bob = 0;

    if (mode === 'grip') {
      targetX = -0.018;
      targetY = DEFAULT_YAW * 0.55;
      targetZ = -0.025;
    } else if (mode === 'walk') {
      const pace = 84 / 60;
      targetX = 0.035 + Math.sin(elapsed * pace * Math.PI * 2) * 0.035;
      targetY = DEFAULT_YAW + Math.sin(elapsed * pace * Math.PI) * 0.075;
      targetZ = Math.cos(elapsed * pace * Math.PI) * 0.045;
      bob = Math.abs(Math.sin(elapsed * pace * Math.PI * 2)) * 0.017;
    } else if (mode === 'fall') {
      targetX = 0.035;
      targetY = DEFAULT_YAW + 0.12;
      targetZ = -1.48;
      targetHeight = PLATFORM_TOP + 0.008;
    }

    const smoothing = 1 - Math.exp(-4.8 * delta);
    caneRoot.rotation.x += (targetX - caneRoot.rotation.x) * smoothing;
    caneRoot.rotation.y += (targetY - caneRoot.rotation.y) * smoothing;
    caneRoot.rotation.z += (targetZ - caneRoot.rotation.z) * smoothing;
    caneRoot.position.y += (targetHeight + bob - caneRoot.position.y) * Math.min(1, smoothing * 1.45);

    if (handGroup) {
      handGroup.visible = mode === 'grip';
      if (mode === 'grip') {
        const breathe = 1 + Math.sin(elapsed * 4.5) * 0.012;
        handGroup.scale.setScalar(MODEL_SCALE * breathe);
      } else {
        handGroup.scale.setScalar(MODEL_SCALE);
      }
    }
    if (gripRing) {
      gripRing.visible = mode === 'grip';
      gripRingMaterial.opacity = mode === 'grip' ? 0.68 + Math.sin(elapsed * 4) * 0.15 : 0;
      const pulse = mode === 'grip' ? 1 + Math.sin(elapsed * 4) * 0.035 : 1;
      gripRing.scale.setScalar(MODEL_SCALE * pulse);
    }
  }

  if (alertRing) {
    alertRing.visible = mode === 'fall';
    if (mode === 'fall') {
      const pulse = (Math.sin(elapsed * 4.7) + 1) / 2;
      alertRingMaterial.opacity = 0.25 + pulse * 0.38;
      const scale = 1 + pulse * 0.1;
      alertRing.scale.setScalar(scale);
      alertPointLight.intensity = 1.3 + pulse * 2.0;
    } else {
      alertRingMaterial.opacity = 0;
      alertRing.scale.setScalar(1);
      alertPointLight.intensity += (0 - alertPointLight.intensity) * Math.min(1, delta * 4);
    }
  }

  if (controls && controls.enabled) controls.update();
  renderer.render(scene, camera);
}

const readings = {
  inspect: { pressure: 0, cadence: 0, impact: 0.00, pressureBar: 0, cadenceBar: 0, impactBar: 0 },
  grip: { pressure: 76, cadence: 0, impact: 0.03, pressureBar: 76, cadenceBar: 0, impactBar: 4 },
  walk: { pressure: 58, cadence: 84, impact: 0.14, pressureBar: 58, cadenceBar: 67, impactBar: 9 },
  fall: { pressure: 0, cadence: 0, impact: 2.48, pressureBar: 0, cadenceBar: 0, impactBar: 88 },
};

function updateReadings(nextMode) {
  const data = readings[nextMode];
  $('#pressure-value').innerHTML = `${data.pressure}<span>%</span>`;
  $('#cadence-value').innerHTML = `${data.cadence}<span>pasos/min</span>`;
  $('#impact-value').innerHTML = `${data.impact.toFixed(2)}<span>g</span>`;
  $('#pressure-meter').style.width = `${data.pressureBar}%`;
  $('#cadence-meter').style.width = `${data.cadenceBar}%`;
  $('#impact-meter').style.width = `${data.impactBar}%`;
}

function renderAlertCard() {
  const card = $('#alert-card');
  const status = $('#alert-status');
  const title = $('#alert-title');
  const description = $('#alert-description');
  const meta = $('#alert-meta');
  const actions = $('#alert-actions');
  const reply = $('#reply-contact');
  const resolve = $('#resolve-alert');

  card.classList.remove('is-alert', 'is-responded');
  actions.hidden = mode !== 'fall';
  reply.hidden = false;
  resolve.hidden = false;
  reply.disabled = false;
  resolve.disabled = false;

  if (mode !== 'fall') {
    status.textContent = 'RUTA DE RESPUESTA';
    title.textContent = 'Si detecta una caída…';
    description.textContent = 'El prototipo mostraría una alerta para un contacto de confianza. Prueba el escenario para ver el flujo.';
    meta.textContent = 'Sin llamadas, mensajes ni ubicación real.';
    return;
  }

  if (alertState === 'responded') {
    card.classList.add('is-responded');
    status.textContent = 'RESPUESTA SIMULADA';
    title.textContent = 'Lucía respondió';
    description.textContent = '“Estoy pendiente. Te llamo ahora para confirmar que estás bien.”';
    meta.textContent = 'Contacto de prueba · llamada no realizada';
    reply.textContent = 'Respuesta recibida · simulada';
    reply.disabled = true;
    resolve.textContent = 'Estoy bien · cerrar prueba';
    return;
  }

  if (alertState === 'resolved') {
    card.classList.add('is-responded');
    status.textContent = 'ESCENARIO CERRADO';
    title.textContent = 'Prueba finalizada';
    description.textContent = 'La persona usuaria indicó que está bien. El flujo de alerta de demostración queda cerrado.';
    meta.textContent = 'No se envió ninguna notificación real.';
    reply.textContent = 'Repetir escenario';
    resolve.hidden = true;
    return;
  }

  card.classList.add('is-alert');
  status.textContent = 'CAÍDA DETECTADA · DEMO';
  title.textContent = 'Alerta de caída';
  description.textContent = 'Un impacto simulado de 2,48 g activa la ruta de aviso y espera confirmación de movimiento.';
  meta.textContent = 'Contacto de prueba: Lucía · sin ubicación consultada';
  reply.textContent = 'Simular respuesta del contacto';
  resolve.textContent = 'Estoy bien · cerrar prueba';
}

function updateModeUI() {
  const copy = modeCopy[mode];
  $('#caption-kicker').textContent = copy.kicker;
  $('#caption-title').textContent = copy.caption;
  $('#mode-status').textContent = copy.status;
  $('#panel-status').lastChild.textContent = copy.panel;
  $('#panel-status').classList.toggle('is-alert-mode', mode === 'fall');
  panel.classList.toggle('is-falling', mode === 'fall');
  viewer.classList.toggle('is-alerting', mode === 'fall');
  $('#take-button').classList.toggle('is-held', mode === 'grip');
  $('#take-button-label').textContent = mode === 'grip' ? 'Soltar bastón' : 'Tomar bastón';
  document.querySelectorAll('.scenario-card').forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateReadings(mode);
  renderAlertCard();
}

function setMode(nextMode) {
  if (!MODES.includes(nextMode)) return;
  const changed = mode !== nextMode;
  mode = nextMode;
  if (nextMode === 'fall' && changed) alertState = 'pending';
  if (nextMode !== 'fall') alertState = 'idle';
  if (nextMode === 'walk' && changed) walkStartedAt = elapsed;
  updateModeUI();
}

function resetExperience() {
  if (heldInVR && activeController) {
    scene.attach(caneRoot);
    heldInVR = false;
    activeController = null;
  }
  setMode('inspect');
  if (controls) {
    controls.reset();
    if (initialCamera) {
      camera.position.copy(initialCamera.position);
      controls.target.copy(initialCamera.target);
      controls.update();
    }
  }
  if (caneRoot && !heldInVR) {
    caneRoot.position.set(0, PLATFORM_TOP, 0);
    caneRoot.rotation.set(0, DEFAULT_YAW, 0);
  }
}

document.querySelectorAll('.scenario-card').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

$('#take-button').addEventListener('click', () => {
  if (mode === 'grip') setMode('inspect');
  else setMode('grip');
});

$('#reset-button').addEventListener('click', resetExperience);

$('#reply-contact').addEventListener('click', () => {
  if (mode !== 'fall') return;
  if (alertState === 'resolved') {
    alertState = 'pending';
  } else if (alertState === 'pending') {
    alertState = 'responded';
  }
  renderAlertCard();
});

$('#resolve-alert').addEventListener('click', () => {
  if (mode !== 'fall') return;
  alertState = 'resolved';
  renderAlertCard();
});

window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button, a, input, textarea, select')) return;
  const shortcuts = { Digit1: 'inspect', Digit2: 'grip', Digit3: 'walk', Digit4: 'fall' };
  if (shortcuts[event.code]) {
    setMode(shortcuts[event.code]);
  } else if (event.code === 'KeyR') {
    resetExperience();
  }
});

setupThree();
updateModeUI();
