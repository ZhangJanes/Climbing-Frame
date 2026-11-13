import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { PART_MAP } from '../model/catalog';
import { DIR_VEC, type Dir } from '../model/orient';
import { JOINT_MM, TUBE_MM, tubeRadius } from '../model/metrics';

/** Bore is wide enough to read as a pipe, with a real wall left around it. */
export const BORE_RATIO = 0.68;

function safeMerge(geometries: THREE.BufferGeometry[]) {
  const flat = geometries.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry));
  const merged = mergeGeometries(flat, false);
  const done = new Set<THREE.BufferGeometry>();
  for (const geometry of [...geometries, ...flat]) {
    if (geometry !== merged && !done.has(geometry)) {
      geometry.dispose();
      done.add(geometry);
    }
  }
  return merged;
}
const up = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const quat = new THREE.Quaternion();

function holeMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.beginPath();
      ctx.arc(128 + col * 128, 128 + row * 128, 38, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function honeyMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#000000';
  const r = 28;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const x = 48 + col * 78 + (row % 2 ? 39 : 0);
      const y = 48 + row * 68;
      ctx.beginPath();
      for (let k = 0; k < 6; k += 1) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

let holes: THREE.CanvasTexture | null = null;
let honey: THREE.CanvasTexture | null = null;

export function partGeometry(partId: string, pitch: number, rungMm: number) {
  void rungMm;
  const part = PART_MAP[partId];
  if (!part) return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  if (part.category === 'joint') return jointGeometry(part.ports ?? [], pitch);
  if (part.category === 'tube') {
    const radius = tubeRadius(pitch);
    return hollowPipe(radius, radius * BORE_RATIO, 1, 32);
  }
  if (part.panel === 'wall') return new THREE.BoxGeometry(0.9, 0.9, 0.04);
  if (part.panel === 'pit') return new THREE.BoxGeometry(0.9, 0.48, 0.04);
  if (part.feature === 'tramp') return trampGeometry();
  if (part.feature === 'bridge') return bridgeGeometry();
  if (part.feature === 'slide') return slideGeometry(false);
  if (part.feature === 'curved') return slideGeometry(true);
  const spanW = (part.span?.w ?? 1) === 2 ? 1.86 : 0.9;
  const spanD = 0.9;
  return new THREE.BoxGeometry(spanW, part.panel === 'roof' ? 0.035 : 0.045, spanD);
}

function jointGeometry(ports: Dir[], pitch: number) {
  const size = JOINT_MM / pitch;
  const outer = (TUBE_MM / 2 / pitch) * 1.08;
  return hollowJoint(ports, size, outer, tubeRadius(pitch) * BORE_RATIO);
}

/** Straight pipe: outer wall, inner wall, and both end rims. Local +Y is the axis. */
export function hollowPipe(outer: number, inner: number, height: number, segments = 32) {
  const half = height / 2;
  const points = [
    new THREE.Vector2(inner, -half),
    new THREE.Vector2(outer, -half),
    new THREE.Vector2(outer, half),
    new THREE.Vector2(inner, half),
    new THREE.Vector2(inner, -half),
  ];
  return new THREE.LatheGeometry(points, segments);
}

/** Bent pipe with an open bore and a rim at each end. */
export function hollowSweep(curve: THREE.Curve<THREE.Vector3>, outer: number, inner: number, tubular = 40, radial = 18) {
  const shell = new THREE.TubeGeometry(curve, tubular, outer, radial, false);
  const liner = new THREE.TubeGeometry(curve, tubular, inner, radial, false);
  flipSurface(liner);
  const rings = [0, 1].map((end) => {
    const point = curve.getPoint(end);
    const tangent = curve.getTangent(end).normalize();
    if (end === 0) tangent.negate();
    const ring = new THREE.RingGeometry(inner, outer, radial);
    ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent));
    ring.translate(point.x, point.y, point.z);
    return ring;
  });
  return safeMerge([shell, liner, ...rings]) ?? shell;
}

/** Hub plus sockets, with a bore drilled in from every port so the inside stays open. */
export function hollowJoint(ports: Dir[], hub: number, socketOuter: number, bore: number) {
  const nub = hub * 0.72;
  const body = new RoundedBoxGeometry(hub, hub, hub, 3, hub * 0.22);
  const pieces: THREE.BufferGeometry[] = [body];
  for (const dir of ports) {
    const arm = new THREE.CylinderGeometry(socketOuter, socketOuter, nub, 24);
    arm.translate(0, hub / 2 + nub * 0.28, 0);
    tmp.set(DIR_VEC[dir][0], DIR_VEC[dir][1], DIR_VEC[dir][2]);
    quat.setFromUnitVectors(up, tmp);
    arm.applyQuaternion(quat);
    pieces.push(arm);
  }
  const solid = safeMerge(pieces) ?? body;
  const mouth = hub / 2 + nub * 0.28 + nub / 2;
  return drillBores(solid, ports, mouth, bore);
}

function drillBores(solid: THREE.BufferGeometry, ports: Dir[], mouth: number, bore: number) {
  const reach = [0, 0, 0, 0, 0, 0];
  for (const dir of ports) reach[dir] = mouth;
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  let brush = new Brush(solid);
  brush.updateMatrixWorld(true);
  for (let axis = 0; axis < 3; axis += 1) {
    const front = reach[axis * 2];
    const back = reach[axis * 2 + 1];
    if (front <= 0 && back <= 0) continue;
    const past = bore * 0.9;
    const start = back > 0 ? back + 0.004 : past;
    const end = front > 0 ? front + 0.004 : past;
    const length = start + end;
    const cutterGeo = new THREE.CylinderGeometry(bore, bore, length, 28);
    cutterGeo.translate(0, (end - start) / 2, 0);
    if (axis === 0) cutterGeo.rotateZ(-Math.PI / 2);
    if (axis === 2) cutterGeo.rotateX(Math.PI / 2);
    const cutter = new Brush(cutterGeo);
    cutter.updateMatrixWorld(true);
    const next = evaluator.evaluate(brush, cutter, SUBTRACTION);
    cutterGeo.dispose();
    if (brush.geometry !== solid && brush.geometry !== next.geometry) brush.geometry.dispose();
    brush = next;
  }
  return brush.geometry;
}

function flipSurface(geometry: THREE.BufferGeometry) {
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i += 1) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  const index = geometry.getIndex();
  if (!index) return;
  for (let i = 0; i < index.count; i += 3) {
    const swap = index.getX(i);
    index.setX(i, index.getX(i + 2));
    index.setX(i + 2, swap);
  }
}

function slideGeometry(curved: boolean) {
  const segs = curved ? 18 : 7;
  const half = 0.4;
  const thick = 0.04;
  const top: [number, number][] = [];
  for (let i = 0; i <= segs; i += 1) {
    const t = i / segs;
    const x = t * 2;
    const y = curved ? -Math.sin((t * Math.PI) / 2) : -t * 0.92;
    top.push([x, y]);
  }
  const positions: number[] = [];
  const push = (x: number, y: number, z: number) => positions.push(x, y, z);
  for (const [x, y] of top) {
    push(x, y, -half);
    push(x, y, half);
  }
  for (const [x, y] of top) {
    push(x, y - thick, -half);
    push(x, y - thick, half);
  }
  const indices: number[] = [];
  const n = segs + 1;
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, c, b, b, c, d);
  for (let i = 0; i < segs; i += 1) {
    const a = i * 2;
    quad(a, a + 1, a + 2, a + 3);
    const b = (n + i) * 2;
    quad(b + 1, b, b + 3, b + 2);
    quad(a, a + 2, b, b + 2);
    quad(a + 3, a + 1, b + 3, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function trampGeometry() {
  const bed = new THREE.BoxGeometry(1.86, 0.03, 0.86);
  const straps: THREE.BufferGeometry[] = [bed];
  for (let i = 0; i < 6; i += 1) {
    const strap = new THREE.BoxGeometry(1.86, 0.012, 0.025);
    strap.translate(0, 0.02, -0.36 + i * 0.144);
    straps.push(strap);
  }
  return safeMerge(straps) ?? new THREE.BoxGeometry(1.86, 0.03, 0.86);
}

function bridgeGeometry() {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const slat = new THREE.BoxGeometry(0.16, 0.035, 0.72);
    slat.translate(-0.78 + i * 0.26, 0, 0);
    pieces.push(slat);
  }
  for (const side of [-0.34, 0.34]) {
    const rope = new THREE.CylinderGeometry(0.015, 0.015, 1.7, 8);
    rope.rotateZ(Math.PI / 2);
    rope.translate(0, 0.08, side);
    pieces.push(rope);
  }
  return safeMerge(pieces) ?? new THREE.BoxGeometry(1.6, 0.04, 0.7);
}

export function partMaterial(partId: string) {
  const part = PART_MAP[partId];
  const plastic = part?.category === 'joint' || part?.category === 'tube';
  if (partId === 'hole' || partId === 'honey') {
    if (partId === 'hole' && !holes) holes = holeMap();
    if (partId === 'honey' && !honey) honey = honeyMap();
    return new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.42,
      metalness: 0,
      alphaMap: partId === 'hole' ? holes : honey,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      envMapIntensity: 0.4,
    });
  }
  if (part?.feature === 'tramp') {
    return new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.86, metalness: 0 });
  }
  if (plastic) {
    return new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: part?.category === 'joint' ? 0.2 : 0.11,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.34,
    metalness: 0,
    envMapIntensity: 0.55,
  });
}
