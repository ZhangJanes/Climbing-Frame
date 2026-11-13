/** Port index: +X -X +Y -Y +Z -Z */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5;

export const DIR_VEC: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const AXIS_POS: Dir[] = [0, 2, 4];
export const AXIS_NEG: Dir[] = [1, 3, 5];

const WORLD: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** 24 right-handed cube rotations, row-major 3×3, columns are images of local axes. */
function cubeRotations(): number[][] {
  const out: number[][] = [];
  for (const x of WORLD) {
    for (const y of WORLD) {
      if (dot(x, y) !== 0) continue;
      const z = cross(x, y);
      out.push([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]);
    }
  }
  return out;
}

export const ROTATIONS = cubeRotations();

export function applyDir(matrix: number[], local: Dir): Dir {
  const v = DIR_VEC[local];
  const w = [
    matrix[0] * v[0] + matrix[1] * v[1] + matrix[2] * v[2],
    matrix[3] * v[0] + matrix[4] * v[1] + matrix[5] * v[2],
    matrix[6] * v[0] + matrix[7] * v[1] + matrix[8] * v[2],
  ];
  let best: Dir = 0;
  let score = -Infinity;
  for (let i = 0; i < 6; i += 1) {
    const d = DIR_VEC[i];
    const s = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
    if (s > score) {
      score = s;
      best = i as Dir;
    }
  }
  return best;
}

export type Orientation = { mask: number; matrix: number[] };

export function orientationsFor(ports: Dir[]): Orientation[] {
  const seen = new Set<number>();
  const list: Orientation[] = [];
  for (const matrix of ROTATIONS) {
    let mask = 0;
    for (const port of ports) mask |= 1 << applyDir(matrix, port);
    if (seen.has(mask)) continue;
    seen.add(mask);
    list.push({ mask, matrix });
  }
  return list;
}

export function maskHas(mask: number, dir: Dir) {
  return (mask & (1 << dir)) !== 0;
}
