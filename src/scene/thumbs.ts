import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { type Dir } from '../model/orient';
import { BORE_RATIO, hollowJoint, hollowPipe, hollowSweep } from './geometries';
import { PICK_ITEMS, type PickItem, type ThumbKind } from './pickerParts';

const SIZE = 360;
const TUBE_R = 20;
const HUB = 52;

let cache: Promise<Map<string, HTMLCanvasElement>> | null = null;

export function loadThumbs() {
  if (!cache) cache = Promise.resolve().then(() => renderAll());
  return cache;
}

function renderAll() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const scene = new THREE.Scene();
  scene.environment = env;

  const hemi = new THREE.HemisphereLight('#F4F8FC', '#8EA0B0', 0.22);
  const key = new THREE.DirectionalLight('#FFF8F2', 2.15);
  key.position.set(140, 260, 180);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 1200;
  key.shadow.camera.left = -280;
  key.shadow.camera.right = 280;
  key.shadow.camera.top = 280;
  key.shadow.camera.bottom = -280;
  key.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight('#D5E4F2', 0.28);
  fill.position.set(-260, 40, -120);
  const rim = new THREE.DirectionalLight('#FFFFFF', 0.85);
  rim.position.set(-40, 180, -220);
  scene.add(hemi, key, fill, rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 4000);
  const out = new Map<string, HTMLCanvasElement>();

  for (const item of PICK_ITEMS) {
    const root = new THREE.Group();
    root.add(build(item));
    settle(root);
    const box = new THREE.Box3().setFromObject(root);
    const span = box.getSize(new THREE.Vector3());
    const blob = contact(Math.max(70, span.x * 0.92), Math.max(48, span.z * 0.92));
    blob.position.y = 1;
    root.add(blob);
    scene.add(root);
    frame(camera, root, item.kind);
    key.target.position.set(0, 20, 0);
    key.target.updateMatrixWorld();
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
    out.set(item.id, canvas);
    scene.remove(root);
    dispose(root);
  }

  renderer.dispose();
  env.dispose();
  pmrem.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  return out;
}

function build(item: PickItem) {
  const color = item.colors?.[0] ?? '#F21D1D';
  const kind = item.kind;
  if (kind.type === 'tube') return tube(kind, color);
  if (kind.type === 'panel') return panel(kind, color);
  if (kind.type === 'joint') return joint(kind.ports);
  if (kind.type === 'rings') return rings();
  if (kind.type === 'net') return flatNet(kind.w, kind.d);
  if (kind.type === 'rope') return rope();
  if (kind.type === 'archNet') return archNet(kind.w, kind.h);
  return cloth(kind.w, kind.d);
}

function tube(kind: Extract<ThumbKind, { type: 'tube' }>, color: string) {
  const mat = kind.metal ? metal() : gloss(color, 0.16, 1);
  const group = new THREE.Group();
  if (kind.bend) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(160, 0, 0),
      new THREE.Vector3(160, 0, 160),
      new THREE.Vector3(0, 0, 160),
    );
    const outer = TUBE_R + 2;
    const geo = hollowSweep(curve, outer, outer * BORE_RATIO);
    group.add(shade(geo, mat));
    return group;
  }
  const outer = kind.metal ? 16 : TUBE_R;
  const geo = hollowPipe(outer, outer * BORE_RATIO, kind.length, 48);
  geo.rotateZ(Math.PI / 2);
  const mesh = shade(geo, mat);
  mesh.rotation.y = 0.42;
  group.add(mesh);
  return group;
}

function panel(kind: Extract<ThumbKind, { type: 'panel' }>, color: string) {
  const mat = gloss(color, 0.34, 0.65);
  const group = new THREE.Group();
  if (kind.face === 'solid') {
    const geo = new RoundedBoxGeometry(kind.w, 18, kind.d, 5, 14);
    group.add(shade(geo, mat));
    return group;
  }
  const shape = kind.face === 'quarter' ? quarter(kind.w) : roundedBoard(kind.w, kind.d, 16);
  if (kind.face === 'hole') punchCircles(shape, kind.w, kind.d);
  if (kind.face === 'honey') punchHex(shape, kind.w, kind.d);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 16,
    bevelEnabled: kind.face === 'quarter',
    bevelThickness: 1.4,
    bevelSize: 1.4,
    bevelSegments: 2,
    curveSegments: kind.face === 'quarter' ? 40 : 8,
  });
  geo.rotateX(Math.PI / 2);
  group.add(shade(geo, mat));
  return group;
}

function quarter(radius: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.absarc(0, 0, radius, 0, Math.PI / 2, false);
  shape.closePath();
  return shape;
}

function roundedBoard(w: number, d: number, r: number) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + d - r);
  shape.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + d);
  shape.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function punchCircles(shape: THREE.Shape, w: number, d: number) {
  const r = Math.min(w, d) * 0.105;
  const step = Math.min(w, d) * 0.28;
  for (const row of [-1, 0, 1]) {
    for (const col of [-1, 0, 1]) {
      const hole = new THREE.Path();
      hole.absarc(col * step, row * step, r, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
}

function punchHex(shape: THREE.Shape, w: number, d: number) {
  const r = 22;
  const dx = r * 2.05;
  const dy = r * 1.78;
  for (let row = -4; row <= 4; row += 1) {
    for (let col = -5; col <= 5; col += 1) {
      const x = col * dx + (row % 2 ? dx / 2 : 0);
      const y = row * dy;
      if (Math.abs(x) > w / 2 - 40 || Math.abs(y) > d / 2 - 40) continue;
      const hole = new THREE.Path();
      for (let k = 0; k < 6; k += 1) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (k === 0) hole.moveTo(px, py);
        else hole.lineTo(px, py);
      }
      hole.closePath();
      shape.holes.push(hole);
    }
  }
}

function joint(ports: Dir[]) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#3A4048',
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.65,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.add(shade(hollowJoint(ports, HUB, TUBE_R * 1.08, TUBE_R * BORE_RATIO), mat));
  const turn = JOINT_TURN[ports.join('')] ?? [0.4, 0.6, 0];
  group.rotation.set(turn[0], turn[1], turn[2]);
  return group;
}

const JOINT_TURN: Record<string, [number, number, number]> = {
  '01245': [0.28, 0.5, 0],
  '0124': [0.48, 0.15, 0],
  '024': [0.2, -0.7, 0],
  '0145': [1.02, 0.18, 0],
  '012': [0.12, 0.02, 0],
  '02': [0.18, 0.42, 0],
  '01': [0.5, 0.72, 0],
};

function rings() {
  const mat = metal();
  const geo = new THREE.TorusGeometry(28, 6.2, 28, 64);
  const a = shade(geo, mat);
  const b = shade(geo, mat);
  b.rotation.x = Math.PI / 2;
  a.position.x = -12;
  b.position.x = 12;
  const group = new THREE.Group();
  group.add(a, b);
  return group;
}

function flatNet(w: number, d: number) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshPhysicalMaterial({ color: '#2C3138', roughness: 0.46, clearcoat: 0.2, envMapIntensity: 0.5 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: '#1A1C1F', roughness: 0.78 });
  const edge = (x: number, z: number, len: number, alongX: boolean) => {
    const geo = new THREE.CylinderGeometry(7, 7, len, 16);
    if (alongX) geo.rotateZ(Math.PI / 2);
    else geo.rotateX(Math.PI / 2);
    const mesh = shade(geo, frameMat);
    mesh.position.set(x, 8, z);
    group.add(mesh);
  };
  edge(0, -d / 2, w, true);
  edge(0, d / 2, w, true);
  edge(-w / 2, 0, d, false);
  edge(w / 2, 0, d, false);
  for (let i = 1; i <= 6; i += 1) {
    const x = -w / 2 + (w * i) / 7;
    const z = -d / 2 + (d * i) / 7;
    const vx = new THREE.CylinderGeometry(1.7, 1.7, d * 0.92, 6);
    vx.rotateX(Math.PI / 2);
    const hx = new THREE.CylinderGeometry(1.7, 1.7, w * 0.92, 6);
    hx.rotateZ(Math.PI / 2);
    const a = shade(vx, ropeMat);
    const b = shade(hx, ropeMat);
    a.position.set(x, 4, 0);
    b.position.set(0, 4, z);
    group.add(a, b);
  }
  return group;
}

function rope() {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 90; i += 1) {
    const t = i / 90;
    const a = t * Math.PI * 5.5;
    const rad = 22 + t * 26;
    points.push(new THREE.Vector3(Math.cos(a) * rad, t * 10, Math.sin(a) * rad));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 140, 3.4, 8, false);
  return shade(geo, new THREE.MeshStandardMaterial({ color: '#E7E1D6', roughness: 0.82 }));
}

function archNet(w: number, h: number) {
  const group = new THREE.Group();
  const tubeMat = gloss('#F21D1D', 0.16, 1);
  const ropeMat = new THREE.MeshStandardMaterial({ color: '#17181A', roughness: 0.8 });
  const radius = w / 2;
  const leg = h - radius;
  const post = (x: number) => {
    const geo = hollowPipe(TUBE_R, TUBE_R * BORE_RATIO, leg, 28);
    const mesh = shade(geo, tubeMat);
    mesh.position.set(x, leg / 2, 0);
    group.add(mesh);
  };
  post(-radius);
  post(radius);
  const arc = new ArchCurve(radius, leg);
  group.add(shade(hollowSweep(arc, TUBE_R, TUBE_R * BORE_RATIO, 36, 16), tubeMat));
  for (let i = 1; i <= 5; i += 1) {
    const y = (h * i) / 6;
    const half = y > leg ? Math.sqrt(Math.max(0, radius * radius - (y - leg) * (y - leg))) : radius;
    const geo = new THREE.CylinderGeometry(1.6, 1.6, half * 1.7, 6);
    geo.rotateZ(Math.PI / 2);
    const mesh = shade(geo, ropeMat);
    mesh.position.set(0, y, 0);
    group.add(mesh);
  }
  for (let i = -2; i <= 2; i += 1) {
    const geo = new THREE.CylinderGeometry(1.6, 1.6, h * 0.86, 6);
    const mesh = shade(geo, ropeMat);
    mesh.position.set((i * radius) / 3, h * 0.42, 0);
    group.add(mesh);
  }
  return group;
}

class ArchCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private radius: number, private leg: number) {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    const a = Math.PI * (1 - t);
    return target.set(Math.cos(a) * this.radius, this.leg + Math.sin(a) * this.radius, 0);
  }
}

function cloth(w: number, d: number) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, d, 28, 28);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) / (w / 2);
    const y = pos.getY(i) / (d / 2);
    const sag = -22 * (1 - x * x) * (1 - y * y);
    pos.setZ(i, sag);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const map = weave();
  const mesh = shade(geo, new THREE.MeshStandardMaterial({ map, color: '#14161A', roughness: 0.9, metalness: 0 }));
  group.add(mesh);
  const rim = new THREE.MeshStandardMaterial({ color: '#2A2E33', roughness: 0.6 });
  const border = (x: number, z: number, len: number, alongX: boolean) => {
    const bar = new THREE.BoxGeometry(alongX ? len : 18, 10, alongX ? 18 : len);
    const piece = shade(bar, rim);
    piece.position.set(x, 2, z);
    group.add(piece);
  };
  border(0, -d / 2, w, true);
  border(0, d / 2, w, true);
  border(-w / 2, 0, d, false);
  border(w / 2, 0, d, false);
  return group;
}

function weave() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#16181C';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i += 6) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 6);
  return map;
}

function gloss(color: string, roughness: number, clearcoat: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat,
    clearcoatRoughness: 0.05,
    envMapIntensity: 0.72,
    side: THREE.DoubleSide,
    sheen: 0.15,
    sheenColor: new THREE.Color('#ffffff'),
    sheenRoughness: 0.4,
  });
}

function contact(w: number, d: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMat());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.6;
  return mesh;
}

let shadowTexture: THREE.CanvasTexture | null = null;

function shadowMat() {
  if (!shadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const wash = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
      wash.addColorStop(0, 'rgba(30, 42, 54, 0.42)');
      wash.addColorStop(1, 'rgba(30, 42, 54, 0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, 128, 128);
    }
    shadowTexture = new THREE.CanvasTexture(canvas);
  }
  return new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
}

function metal() {
  return new THREE.MeshPhysicalMaterial({
    color: '#D7DEE4',
    metalness: 1,
    roughness: 0.26,
    envMapIntensity: 1.35,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    side: THREE.DoubleSide,
  });
}

function shade(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function settle(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
}

function frame(camera: THREE.PerspectiveCamera, root: THREE.Object3D, kind: ThumbKind) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const shared = kind.type === 'tube' && !kind.bend ? 420 : Math.max(size.x, size.y, size.z) * 1.28;
  const fit = kind.type === 'tube' && !kind.bend ? Math.max(shared, size.x) : shared;
  const dist = fit / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const eye = new THREE.Vector3(0.45, 0.7, 1).normalize().multiplyScalar(dist * 1.42);
  if (kind.type === 'panel') eye.set(0.62, 0.78, 1).normalize().multiplyScalar(dist * 1.55);
  if (kind.type === 'joint') eye.set(0.9, 0.58, 0.95).normalize().multiplyScalar(dist * 1.7);
  if (kind.type === 'tube' && !kind.bend) eye.set(0.22, 0.72, 1).normalize().multiplyScalar(dist * 1.22);
  camera.position.copy(center).add(eye);
  camera.near = dist / 30;
  camera.far = dist * 8;
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
}

function dispose(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material) materials.add(material);
  });
  materials.forEach((material) => {
    const mapped = material as THREE.MeshStandardMaterial;
    mapped.map?.dispose();
    material.dispose();
  });
}
