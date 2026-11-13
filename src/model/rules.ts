import { PART_MAP, jointOrients, type Part } from './catalog';
import { deriveJoints, structuralPlacements } from './joints';
import { AXIS_NEG, AXIS_POS, maskHas, type Dir } from './orient';
import { inNode } from './metrics';
import type { Placement } from './types';

export type Axis = 0 | 1 | 2;
export type Normal = 'x' | 'y' | 'z';

export function nodeKey(x: number, y: number, z: number) {
  return `n:${x}:${y}:${z}`;
}

export function edgeKey(x: number, y: number, z: number, axis: Axis) {
  return `e:${axis}:${x}:${y}:${z}`;
}

export function faceKey(normal: Normal, x: number, y: number, z: number) {
  return `f:${normal}:${x}:${y}:${z}`;
}

export function cellKey(x: number, y: number, z: number) {
  return `c:${x}:${y}:${z}`;
}

type Coverage = {
  nodes: string[];
  edges: string[];
  faces: string[];
  cells: string[];
};

function add(list: string[], key: string) {
  list.push(key);
}

/** Facing for flat parts: 0 long-X / normal Y, 1 long-Z / normal Y, 2 normal X, 3 normal Z. */
export function facingNormal(ori: number): Normal {
  if (ori <= 1) return 'y';
  return ori === 2 ? 'x' : 'z';
}

export function spanOf(part: Part, ori: number) {
  const w = part.span?.w ?? 1;
  const d = part.span?.d ?? 1;
  if (ori === 1) return { w: d, d: w };
  return { w, d };
}

function edgesOfFace(normal: Normal, x: number, y: number, z: number, w: number, d: number): string[] {
  const edges: string[] = [];
  if (normal === 'y') {
    for (let i = 0; i < w; i += 1) {
      add(edges, edgeKey(x + i, y, z, 0));
      add(edges, edgeKey(x + i, y, z + d, 0));
    }
    for (let i = 0; i < d; i += 1) {
      add(edges, edgeKey(x, y, z + i, 2));
      add(edges, edgeKey(x + w, y, z + i, 2));
    }
  } else if (normal === 'x') {
    for (let i = 0; i < w; i += 1) {
      add(edges, edgeKey(x, y, z + i, 2));
      add(edges, edgeKey(x, y + d, z + i, 2));
    }
    for (let i = 0; i < d; i += 1) {
      add(edges, edgeKey(x, y + i, z, 1));
      add(edges, edgeKey(x, y + i, z + w, 1));
    }
  } else {
    for (let i = 0; i < w; i += 1) {
      add(edges, edgeKey(x + i, y, z, 0));
      add(edges, edgeKey(x + i, y + d, z, 0));
    }
    for (let i = 0; i < d; i += 1) {
      add(edges, edgeKey(x, y + i, z, 1));
      add(edges, edgeKey(x + w, y + i, z, 1));
    }
  }
  return edges;
}

function facesOf(normal: Normal, x: number, y: number, z: number, w: number, d: number) {
  const faces: string[] = [];
  const n = normal === 'y' ? w : normal === 'x' ? w : w;
  const m = d;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (normal === 'y') add(faces, faceKey('y', x + i, y, z + j));
      else if (normal === 'x') add(faces, faceKey('x', x, y + j, z + i));
      else add(faces, faceKey('z', x + i, y + j, z));
    }
  }
  return faces;
}

function slideCorners(placement: Placement) {
  const { x, y, z, ori } = placement;
  const dir = ori % 4;
  const step: [number, number] = dir === 0 ? [1, 0] : dir === 1 ? [-1, 0] : dir === 2 ? [0, 1] : [0, -1];
  const across: [number, number] = step[0] === 0 ? [1, 0] : [0, 1];
  const high: [number, number, number][] = [
    [x, y, z],
    [x + across[0], y, z + across[1]],
  ];
  const low: [number, number, number][] = [
    [x + step[0] * 2, y - 1, z + step[1] * 2],
    [x + step[0] * 2 + across[0], y - 1, z + step[1] * 2 + across[1]],
  ];
  return { high, low, step, across };
}

export function coverage(placement: Placement): Coverage {
  const part = PART_MAP[placement.partId];
  const cov: Coverage = { nodes: [], edges: [], faces: [], cells: [] };
  if (!part) return cov;
  const { x, y, z, ori } = placement;

  if (part.category === 'joint') {
    add(cov.nodes, nodeKey(x, y, z));
    return cov;
  }

  if (part.category === 'tube') {
    const axis = (ori % 3) as Axis;
    const modules = part.modules ?? 1;
    for (let i = 0; i < modules; i += 1) {
      const ax = axis === 0 ? x + i : x;
      const ay = axis === 1 ? y + i : y;
      const az = axis === 2 ? z + i : z;
      add(cov.edges, edgeKey(ax, ay, az, axis));
    }
    return cov;
  }

  if (part.category === 'panel' || part.feature === 'tramp' || part.feature === 'bridge') {
    const normal = facingNormal(ori);
    const span = spanOf(part, ori);
    cov.faces.push(...facesOf(normal, x, y, z, span.w, span.d));
    return cov;
  }

  if (part.feature === 'wheel') {
    const normal = facingNormal(ori);
    add(cov.faces, `wheel:${faceKey(normal, x, y, z)}`);
    return cov;
  }

  if (part.feature === 'capsule') {
    add(cov.cells, cellKey(x, y, z));
    return cov;
  }

  if (part.feature === 'slide' || part.feature === 'curved') {
    const { step } = slideCorners(placement);
    add(cov.cells, cellKey(x, y, z));
    add(cov.cells, cellKey(x + step[0], Math.max(0, y - 1), z + step[1]));
    add(cov.cells, `ramp:${ori % 4}:${x}:${y}:${z}`);
    return cov;
  }

  if (part.feature === 'swing') {
    const alongX = ori % 2 === 0;
    add(cov.cells, cellKey(x, y, z));
    add(cov.cells, cellKey(x, y + 1, z));
    if (alongX) add(cov.cells, cellKey(x, y, z));
    return cov;
  }

  return cov;
}

export function requiredEdges(placement: Placement): string[] {
  const part = PART_MAP[placement.partId];
  if (!part) return [];
  const { x, y, z, ori } = placement;

  if (part.category === 'panel' || part.feature === 'tramp' || part.feature === 'bridge' || part.feature === 'wheel') {
    const normal = facingNormal(ori);
    const span = part.feature === 'wheel' ? { w: 1, d: 1 } : spanOf(part, ori);
    const edges = edgesOfFace(normal, x, y, z, span.w, span.d);
    if (part.feature === 'tramp' || part.feature === 'bridge') {
      if (ori === 0) edges.push(edgeKey(x + 1, y, z, 2));
      else edges.push(edgeKey(x, y, z + 1, 0));
    }
    return edges;
  }

  if (part.feature === 'capsule') {
    return [
      edgeKey(x, y, z, 0),
      edgeKey(x, y, z + 1, 0),
      edgeKey(x, y, z, 2),
      edgeKey(x + 1, y, z, 2),
    ];
  }

  if (part.feature === 'swing') {
    const alongX = ori % 2 === 0;
    if (alongX) {
      return [
        edgeKey(x, y, z, 1),
        edgeKey(x, y + 1, z, 1),
        edgeKey(x + 1, y, z, 1),
        edgeKey(x + 1, y + 1, z, 1),
        edgeKey(x, y + 2, z, 0),
      ];
    }
    return [
      edgeKey(x, y, z, 1),
      edgeKey(x, y + 1, z, 1),
      edgeKey(x, y, z + 1, 1),
      edgeKey(x, y + 1, z + 1, 1),
      edgeKey(x, y + 2, z, 2),
    ];
  }

  if (part.feature === 'slide' || part.feature === 'curved') {
    const { high, low } = slideCorners(placement);
    return high.concat(low).map(([px, py, pz]) => nodeKey(px, py, pz));
  }

  return [];
}

export type Indexes = {
  nodes: Map<string, Placement>;
  edges: Map<string, Placement>;
  faces: Map<string, Placement>;
  cells: Map<string, Placement>;
  jointMask: Map<string, number>;
};

export function buildIndex(placements: Placement[], skipUid?: string): Indexes {
  const indexes: Indexes = {
    nodes: new Map(),
    edges: new Map(),
    faces: new Map(),
    cells: new Map(),
    jointMask: new Map(),
  };
  for (const placement of placements) {
    if (placement.uid === skipUid) continue;
    const part = PART_MAP[placement.partId];
    const cov = coverage(placement);
    for (const key of cov.nodes) indexes.nodes.set(key, placement);
    for (const key of cov.edges) indexes.edges.set(key, placement);
    for (const key of cov.faces) indexes.faces.set(key, placement);
    for (const key of cov.cells) indexes.cells.set(key, placement);
    if (part?.category === 'joint') {
      const ori = jointOrients(part)[placement.ori] ?? jointOrients(part)[0];
      indexes.jointMask.set(nodeKey(placement.x, placement.y, placement.z), ori?.mask ?? 0);
    }
  }
  return indexes;
}

function withinTube(placement: Placement, part: Part) {
  const axis = (placement.ori % 3) as Axis;
  const end = (part.modules ?? 1);
  const x = placement.x + (axis === 0 ? end : 0);
  const y = placement.y + (axis === 1 ? end : 0);
  const z = placement.z + (axis === 2 ? end : 0);
  return inNode(placement.x, placement.y, placement.z) && inNode(x, y, z);
}

function withinFace(placement: Placement, part: Part) {
  const normal = facingNormal(placement.ori);
  const span = part.feature === 'wheel' ? { w: 1, d: 1 } : spanOf(part, placement.ori);
  const { x, y, z } = placement;
  if (normal === 'y') return inNode(x, y, z) && inNode(x + span.w, y, z + span.d);
  if (normal === 'x') return inNode(x, y, z) && inNode(x, y + span.d, z + span.w);
  return inNode(x, y, z) && inNode(x + span.w, y + span.d, z);
}

function portsNeeded(x: number, y: number, z: number, indexes: Indexes): Dir[] {
  const needed: Dir[] = [];
  ([0, 1, 2] as Axis[]).forEach((axis) => {
    const prev = axis === 0 ? [x - 1, y, z] : axis === 1 ? [x, y - 1, z] : [x, y, z - 1];
    if (indexes.edges.has(edgeKey(x, y, z, axis))) needed.push(AXIS_POS[axis]);
    if (indexes.edges.has(edgeKey(prev[0], prev[1], prev[2], axis))) needed.push(AXIS_NEG[axis]);
  });
  return needed;
}

export function placementIssue(placement: Placement, placements: Placement[], ready?: Indexes): string | null {
  const part = PART_MAP[placement.partId];
  if (!part) return '没有这种零件';
  const indexes = ready ?? buildIndex(placements, placement.uid);

  if (part.category === 'joint') {
    if (!inNode(placement.x, placement.y, placement.z)) return '超出格子范围';
    if (indexes.nodes.has(nodeKey(placement.x, placement.y, placement.z))) return '这里已经有接头';
    const ori = jointOrients(part)[placement.ori] ?? jointOrients(part)[0];
    const needed = portsNeeded(placement.x, placement.y, placement.z, indexes);
    if (needed.some((dir) => !maskHas(ori.mask, dir))) return '这个朝向盖不住已经接上的管子';
    return null;
  }

  if (part.category === 'tube') {
    if (!withinTube(placement, part)) return '超出格子范围';
    const axis = (placement.ori % 3) as Axis;
    for (let i = 0; i < (part.modules ?? 1); i += 1) {
      const ax = axis === 0 ? placement.x + i : placement.x;
      const ay = axis === 1 ? placement.y + i : placement.y;
      const az = axis === 2 ? placement.z + i : placement.z;
      if (indexes.edges.has(edgeKey(ax, ay, az, axis))) return '这根棱上已经有管子';
    }
    return null;
  }

  if (part.feature === 'slide' || part.feature === 'curved') {
    const { high, low } = slideCorners(placement);
    const points = high.concat(low);
    if (points.some(([px, py, pz]) => !inNode(px, py, pz))) return '滑梯会伸出格子，或落到地面以下';
    if (indexes.cells.has(`ramp:${placement.ori % 4}:${placement.x}:${placement.y}:${placement.z}`)) return '这里已经有滑梯';
    for (const [px, py, pz] of points) {
      if (!portsNeeded(px, py, pz, indexes).length) return '滑梯的角要先有管子接过来';
    }
    return null;
  }

  if (part.feature === 'swing') {
    const alongX = placement.ori % 2 === 0;
    const far = alongX ? [placement.x + 1, placement.y + 2, placement.z] : [placement.x, placement.y + 2, placement.z + 1];
    if (!inNode(placement.x, placement.y, placement.z) || !inNode(far[0], far[1], far[2])) return '秋千架超出格子范围';
    const edges = requiredEdges(placement);
    if (edges.some((key) => !indexes.edges.has(key))) return '先搭好两根立柱和上面的横杆';
    return null;
  }

  if (part.category === 'panel' || part.feature === 'tramp' || part.feature === 'bridge' || part.feature === 'wheel' || part.feature === 'capsule') {
    if (!withinFace(placement, part) && part.feature !== 'capsule') return '超出格子范围';
    if (part.feature === 'capsule' && (!inNode(placement.x, placement.y, placement.z) || !inNode(placement.x + 1, placement.y + 1, placement.z + 1))) {
      return '超出格子范围';
    }
    const cov = coverage(placement);
    if (cov.faces.some((key) => indexes.faces.has(key))) return '这块面已经被占了';
    if (cov.cells.some((key) => indexes.cells.has(key))) return '这个格子里已经有东西';
    const edges = requiredEdges(placement);
    if (edges.some((key) => !indexes.edges.has(key))) {
      if (part.feature === 'capsule') return '太空舱下面要先有一圈管子';
      return '四周要先有管子';
    }
    return null;
  }

  return null;
}

export function stockIssue(partId: string, placements: Placement[], stock: Record<string, number>, adding = 1) {
  const used = placements.filter((item) => item.partId === partId).length;
  const have = stock[partId] ?? 0;
  if (used + adding > have) {
    const name = PART_MAP[partId]?.name ?? '零件';
    return have === 0 ? `${name}还没有数量` : `${name}只剩 ${Math.max(0, have - used)} 个`;
  }
  return null;
}

export type Issue = { text: string };

export function audit(placements: Placement[], stock: Record<string, number>): Issue[] {
  const issues: Issue[] = [];
  const base = structuralPlacements(placements);
  const counted = base.concat(deriveJoints(base));
  for (const part of Object.values(PART_MAP)) {
    const used = counted.filter((item) => item.partId === part.id).length;
    const have = stock[part.id] ?? 0;
    if (used > have) issues.push({ text: `${part.name}多用了 ${used - have} 个` });
  }
  base.forEach((placement) => {
    const problem = placementIssue(placement, placements);
    if (problem) {
      const name = PART_MAP[placement.partId]?.name ?? '零件';
      issues.push({ text: `${name}（${placement.x},${placement.y},${placement.z}）${problem}` });
    }
  });
  return issues.slice(0, 14);
}

export function usedCount(placements: Placement[], partId: string) {
  const base = structuralPlacements(placements);
  const source = PART_MAP[partId]?.category === 'joint' ? deriveJoints(base) : base;
  let n = 0;
  for (const item of source) if (item.partId === partId) n += 1;
  return n;
}

export type CellBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export function occupiedCells(placements: Placement[]): CellBox | null {
  if (!placements.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const touch = (x: number, y: number, z: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  };
  for (const placement of placements) {
    const part = PART_MAP[placement.partId];
    touch(placement.x, placement.y, placement.z);
    if (!part) continue;
    if (part.category === 'tube') {
      const axis = placement.ori % 3;
      const end = part.modules ?? 1;
      touch(placement.x + (axis === 0 ? end : 0), placement.y + (axis === 1 ? end : 0), placement.z + (axis === 2 ? end : 0));
    } else if (part.category === 'panel' || part.feature === 'tramp' || part.feature === 'bridge') {
      const span = spanOf(part, placement.ori);
      const normal = facingNormal(placement.ori);
      if (normal === 'y') touch(placement.x + span.w, placement.y, placement.z + span.d);
      else if (normal === 'x') touch(placement.x, placement.y + span.d, placement.z + span.w);
      else touch(placement.x + span.w, placement.y + span.d, placement.z);
    } else if (part.feature === 'capsule') {
      touch(placement.x + 1, placement.y + 1, placement.z + 1);
    } else if (part.feature === 'swing') {
      touch(placement.x + (placement.ori % 2 === 0 ? 1 : 0), placement.y + 2, placement.z + (placement.ori % 2 === 0 ? 0 : 1));
    } else if (part.feature === 'slide' || part.feature === 'curved') {
      slideCorners(placement).low.forEach(([x, y, z]) => touch(x, y, z));
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function boundsMm(placements: Placement[], pitch: number) {
  const cells = occupiedCells(placements);
  if (!cells) return null;
  const joint = 52;
  return {
    w: Math.round(Math.max(0, cells.maxX - cells.minX) * pitch + joint),
    d: Math.round(Math.max(0, cells.maxZ - cells.minZ) * pitch + joint),
    h: Math.round(Math.max(0, cells.maxY - cells.minY) * pitch + joint),
  };
}

