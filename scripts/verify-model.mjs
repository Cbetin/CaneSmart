import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const assetsDirectory = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const modelFiles = fs.readdirSync(assetsDirectory).filter((name) => /^Baston_2-.*\.obj$/i.test(name));

if (modelFiles.length !== 1) {
  throw new Error(`Se esperaba un Baston_2.obj en dist/assets; encontrados: ${modelFiles.length}.`);
}

const modelFile = modelFiles[0];
const modelPath = path.join(assetsDirectory, modelFile);
const model = new OBJLoader().parse(fs.readFileSync(modelPath, 'utf8'));
let meshes = 0;
let positions = 0;
let triangles = 0;

model.traverse((part) => {
  if (!part.isMesh) return;
  meshes += 1;
  const count = part.geometry.getAttribute('position')?.count ?? 0;
  positions += count;
  triangles += count / 3;
});

const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
if (meshes === 0 || positions === 0 || triangles < 1 || !Number.isFinite(size.y) || size.y <= 0) {
  throw new Error('Baston_2.obj no contiene geometría 3D válida.');
}

const bundles = fs.readdirSync(assetsDirectory).filter((name) => /^index-.*\.js$/i.test(name));
const hasBaseUrl = bundles.some((name) => {
  const source = fs.readFileSync(path.join(assetsDirectory, name), 'utf8');
  return source.includes(`/CaneSmart/assets/${modelFile}`);
});

if (!hasBaseUrl) {
  throw new Error(`El bundle no referencia el modelo bajo /CaneSmart/assets/: ${modelFile}`);
}

console.log(
  `Baston_2.obj OK: ${meshes} mesh, ${positions.toLocaleString('es-CO')} posiciones, ` +
    `${Math.round(triangles).toLocaleString('es-CO')} triángulos; incluido bajo /CaneSmart/.`
);
