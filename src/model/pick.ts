import { PART_MAP, jointOrients, type Part } from './catalog';
import { nodePos } from './metrics';
import { tubeGuides } from './guides';
import { tubeNodeTouches } from './joints';
import { tubeCenter } from './layout';
import { maskHas, type Dir } from './orient';
import {
  buildIndex,
  edgeKey,
  facingNormal,
  placementIssue,
  spanOf,
  type Axis,
  type Indexes,
  type Normal,
} from './rules';
import type { Placement } from './types';

export type Ray = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number };

export type Hover = {
  placement: Omit<Placement, 'uid'>;
  ok: boolean;
  reason: string | null;
  point: [number, number, number];
};

function distToPoint(ray: Ray, x: number, y: number, z: number, minT = 0.2) {
  const vx = x - ray.ox;
  const vy = y - ray.oy;
  const vz = z - ray.oz;
  const t = vx * ray.dx + vy * ray.dy + vz * ray.dz;
  if (t < minT) return null;
  const cx = ray.ox + ray.dx * t;
  const cy = ray.oy + ray.dy * t;
  const cz = ray.oz + ray.dz * t;
  const dist = Math.hypot(x - cx, y - cy, z - cz);
  return { dist, t };
}

function consider(
  best: { dist: number; t: number; hover: Hover } | null,
  dist: number,
  t: number,
  hover: Hover,
  limit: number,
) {
  if (dist > limit) return best;
  if (!best || dist < best.dist - 0.02 || (Math.abs(dist - best.dist) <= 0.02 && t < best.t)) {
    return { dist, t, hover };
  }
  return best;
}

function draft(partId: string, x: number, y: number, z: number, ori: number, color: string): Omit<Placement, 'uid'> {
  return { partId, x, y, z, ori, color };
}

function finish(
  part: Part,
  placement: Omit<Placement, 'uid'>,
  placements: Placement[],
  stock: Record<string, number>,
  point: [number, number, number],
  indexes: Indexes,
): Hover {
  const structural = placementIssue({ ...placement, uid: '__ghost__' }, placements, indexes);
  const used = placements.filter((item) => item.partId === part.id).length;
  const have = stock[part.id] ?? 0;
  let reason = structural;
  if (!reason && used >= have) reason = have === 0 ? `${part.name}还没有数量` : `${part.name}已经用完`;
  return { placement, ok: !reason, reason, point };
}

export function pickHover(input: {
  ray: Ray;
  part: Part;
  placements: Placement[];
  stock: Record<string, number>;
  pitch: number;
  ori: number;
  color: string;
  rungMm?: number;
}): Hover | null {
  const { ray, part, placements, stock, pitch, ori, color, rungMm = 150 } = input;
  const indexes = buildIndex(placements);
  let best: { dist: number; t: number; hover: Hover } | null = null;

  if (part.category === 'joint') {
    const orients = jointOrients(part);
    for (let x = 0; x <= 12; x += 1) {
      for (let y = 0; y <= 6; y += 1) {
        for (let z = 0; z <= 10; z += 1) {
          const [px, py, pz] = nodePos(x, y, z, pitch);
          const hit = distToPoint(ray, px, py, pz);
          if (!hit) continue;
          const needed = portsAt(x, y, z, indexes);
          let use = ((ori % orients.length) + orients.length) % orients.length;
          if (needed.some((dir) => !maskHas(orients[use].mask, dir))) {
            const found = orients.findIndex((item) => needed.every((dir) => maskHas(item.mask, dir)));
            if (found >= 0 && needed.length) use = found;
          }
          const placement = draft(part.id, x, y, z, use, '');
          best = consider(best, hit.dist, hit.t, finish(part, placement, placements, stock, [px, py, pz], indexes), 0.42);
        }
      }
    }
  } else if (part.category === 'tube') {
    for (const guide of tubeGuides(placements)) {
      const endX = guide.x + (guide.axis === 0 ? 1 : 0);
      const endY = guide.y + (guide.axis === 1 ? 1 : 0);
      const endZ = guide.z + (guide.axis === 2 ? 1 : 0);
      const a = nodePos(guide.x, guide.y, guide.z, pitch);
      const b = nodePos(endX, endY, endZ, pitch);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const mz = (a[2] + b[2]) / 2;
      const hit = distToPoint(ray, mx, my, mz, 1.15);
      if (!hit) continue;
      const endBit = part.id === 'rung' ? dockEnd(ray, placements, a, b, guide, ori) : 0;
      const placement = draft(part.id, guide.x, guide.y, guide.z, guide.axis + endBit * 3, color);
      const center = tubeCenter(placement, pitch, rungMm);
      const hover = finish(part, placement, placements, stock, center, indexes);
      const score = hit.dist + Math.max(0, 1.6 - hit.t) * 1.4;
      best = consider(best, score, hit.t, hover, 0.62);
    }
  } else if (part.feature === 'slide' || part.feature === 'curved') {
    for (let x = 0; x <= 12; x += 1) {
      for (let y = 1; y <= 6; y += 1) {
        for (let z = 0; z <= 10; z += 1) {
          for (let facing = 0; facing < 4; facing += 1) {
            const dx = facing === 0 ? 2 : facing === 1 ? -2 : 0;
            const dz = facing === 2 ? 2 : facing === 3 ? -2 : 0;
            if (x + dx < 0 || x + dx > 12 || z + dz < 0 || z + dz > 10) continue;
            const placement = draft(part.id, x, y, z, facing, color);
            const [px, py, pz] = nodePos(x, y, z, pitch);
            const hit = distToPoint(ray, px + dx / 2, py - 0.4, pz + dz / 2);
            if (!hit) continue;
            best = consider(best, hit.dist, hit.t, finish(part, placement, placements, stock, [px, py, pz], indexes), 0.7);
          }
        }
      }
    }
  } else if (part.feature === 'swing') {
    for (let x = 0; x <= 11; x += 1) {
      for (let y = 0; y <= 4; y += 1) {
        for (let z = 0; z <= 10; z += 1) {
          for (const facing of [0, 1]) {
            const placement = draft(part.id, x, y, z, facing, color);
            const mid = nodePos(x + (facing === 0 ? 0.5 : 0), y + 1, z + (facing === 1 ? 0.5 : 0), pitch);
            const hit = distToPoint(ray, mid[0], mid[1], mid[2]);
            if (!hit) continue;
            best = consider(best, hit.dist, hit.t, finish(part, placement, placements, stock, mid, indexes), 0.7);
          }
        }
      }
    }
  } else if (part.feature === 'capsule') {
    for (let x = 0; x <= 11; x += 1) {
      for (let y = 0; y <= 5; y += 1) {
        for (let z = 0; z <= 9; z += 1) {
          const placement = draft(part.id, x, y, z, 0, color);
          const a = nodePos(x, y, z, pitch);
          const b = nodePos(x + 1, y + 1, z + 1, pitch);
          const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          const hit = distToPoint(ray, mid[0], mid[1], mid[2]);
          if (!hit) continue;
          best = consider(best, hit.dist, hit.t, finish(part, placement, placements, stock, mid, indexes), 0.62);
        }
      }
    }
  } else {
    const normals = allowedNormals(part);
    for (let x = 0; x <= 12; x += 1) {
      for (let y = 0; y <= 6; y += 1) {
        for (let z = 0; z <= 10; z += 1) {
          for (const normal of normals) {
            const facings = facingsFor(part, normal);
            for (const facing of facings) {
              const placement = draft(part.id, x, y, z, facing, color);
              if (!faceInside(part, placement)) continue;
              const mid = faceCenter(part, placement, pitch);
              const hit = distToPoint(ray, mid[0], mid[1], mid[2]);
              if (!hit) continue;
              best = consider(best, hit.dist, hit.t, finish(part, placement, placements, stock, mid, indexes), 0.58);
            }
          }
        }
      }
    }
  }

  return best?.hover ?? null;
}

function portsAt(x: number, y: number, z: number, indexes: ReturnType<typeof buildIndex>): Dir[] {
  const needed: Dir[] = [];
  ([0, 1, 2] as Axis[]).forEach((axis) => {
    if (indexes.edges.has(edgeKey(x, y, z, axis))) needed.push(AXIS_POS(axis));
    const prevX = axis === 0 ? x - 1 : x;
    const prevY = axis === 1 ? y - 1 : y;
    const prevZ = axis === 2 ? z - 1 : z;
    if (indexes.edges.has(edgeKey(prevX, prevY, prevZ, axis))) needed.push(AXIS_NEG(axis));
  });
  return needed;
}

function AXIS_POS(axis: Axis): Dir {
  return axis === 0 ? 0 : axis === 1 ? 2 : 4;
}
function AXIS_NEG(axis: Axis): Dir {
  return axis === 0 ? 1 : axis === 1 ? 3 : 5;
}

function allowedNormals(part: Part): Normal[] {
  if (part.panel === 'wall' || part.panel === 'pit' || part.feature === 'wheel') return ['x', 'z'];
  return ['y'];
}

function facingsFor(part: Part, normal: Normal): number[] {
  if (normal === 'y') {
    const w = part.span?.w ?? 1;
    const d = part.span?.d ?? 1;
    return w === d ? [0] : [0, 1];
  }
  return normal === 'x' ? [2] : [3];
}

function faceInside(part: Part, placement: Omit<Placement, 'uid'>) {
  const span = part.feature === 'wheel' ? { w: 1, d: 1 } : spanOf(part, placement.ori);
  const normal = facingNormal(placement.ori);
  const { x, y, z } = placement;
  if (normal === 'y') return x + span.w <= 12 && z + span.d <= 10 && y <= 6;
  if (normal === 'x') return y + span.d <= 6 && z + span.w <= 10 && x <= 12;
  return x + span.w <= 12 && y + span.d <= 6 && z <= 10;
}

function faceCenter(part: Part, placement: Omit<Placement, 'uid'>, pitch: number): [number, number, number] {
  const span = part.feature === 'wheel' ? { w: 1, d: 1 } : spanOf(part, placement.ori);
  const normal = facingNormal(placement.ori);
  const { x, y, z } = placement;
  if (normal === 'y') return nodePos(x + span.w / 2, y, z + span.d / 2, pitch);
  if (normal === 'x') return nodePos(x, y + span.d / 2, z + span.w / 2, pitch);
  return nodePos(x + span.w / 2, y + span.d / 2, z, pitch);
}

export function pickExisting(ray: Ray, placements: Placement[], pitch: number, rungMm = 150): Placement | null {
  let best: { dist: number; t: number; item: Placement } | null = null;
  for (const item of placements) {
    const part = PART_MAP[item.partId];
    if (!part) continue;
    const point = anchorPoint(part, item, pitch, rungMm);
    const hit = distToPoint(ray, point[0], point[1], point[2]);
    if (!hit || hit.dist > 0.48) continue;
    if (!best || hit.dist < best.dist - 0.02 || (Math.abs(hit.dist - best.dist) <= 0.02 && hit.t < best.t)) {
      best = { dist: hit.dist, t: hit.t, item };
    }
  }
  return best?.item ?? null;
}

function dockEnd(
  ray: Ray,
  placements: Placement[],
  a: [number, number, number],
  b: [number, number, number],
  guide: { x: number; y: number; z: number; axis: 0 | 1 | 2 },
  ori: number,
) {
  const far = {
    x: guide.x + (guide.axis === 0 ? 1 : 0),
    y: guide.y + (guide.axis === 1 ? 1 : 0),
    z: guide.z + (guide.axis === 2 ? 1 : 0),
  };
  const startBusy = nodeHasTube(placements, guide.x, guide.y, guide.z);
  const endBusy = nodeHasTube(placements, far.x, far.y, far.z);
  let end = 0;
  if (startBusy !== endBusy) end = endBusy ? 1 : 0;
  else {
    const nearStart = distToPoint(ray, a[0], a[1], a[2], 0);
    const nearEnd = distToPoint(ray, b[0], b[1], b[2], 0);
    end = nearStart && nearEnd && nearEnd.dist < nearStart.dist ? 1 : 0;
  }
  return (ori % 2 ? 1 - end : end) as 0 | 1;
}

function nodeHasTube(placements: Placement[], x: number, y: number, z: number) {
  return placements.some((item) => tubeNodeTouches(item).some((port) => port.x === x && port.y === y && port.z === z));
}

function anchorPoint(part: Part, placement: Placement, pitch: number, rungMm: number): [number, number, number] {
  if (part.category === 'joint') return nodePos(placement.x, placement.y, placement.z, pitch);
  if (part.category === 'tube') return tubeCenter(placement, pitch, rungMm);
  if (part.feature === 'capsule') {
    const a = nodePos(placement.x, placement.y, placement.z, pitch);
    const b = nodePos(placement.x + 1, placement.y + 1, placement.z + 1, pitch);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }
  if (part.feature === 'swing') {
    return nodePos(placement.x + (placement.ori % 2 === 0 ? 0.5 : 0), placement.y + 1, placement.z + (placement.ori % 2 === 0 ? 0 : 0.5), pitch);
  }
  if (part.feature === 'slide' || part.feature === 'curved') {
    return nodePos(placement.x, placement.y, placement.z, pitch);
  }
  return faceCenter(part, placement, pitch);
}

