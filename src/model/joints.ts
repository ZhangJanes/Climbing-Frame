import { PART_MAP, jointOrients } from './catalog';
import { AXIS_NEG, AXIS_POS } from './orient';
import type { Placement } from './types';

const ORDER = ['straight', 'elbow', 'tee', 'corner3', 'cross4', 'corner4', 'five', 'six'];

export function structuralPlacements(list: Placement[]) {
  return list.filter((item) => PART_MAP[item.partId]?.category !== 'joint');
}

function popcount(value: number) {
  let count = 0;
  let bits = value;
  while (bits) {
    count += bits & 1;
    bits >>= 1;
  }
  return count;
}

function matchMask(mask: number) {
  for (const id of ORDER) {
    const list = jointOrients(PART_MAP[id]);
    const ori = list.findIndex((item) => item.mask === mask);
    if (ori >= 0) return { id, ori };
  }
  return null;
}

/** Short tubes dock to one end. 0 is the start node, 1 is the far node. Full tubes span both. */
export function anchoredEnd(partId: string, ori: number): 0 | 1 | null {
  if (partId !== 'rung') return null;
  return (Math.floor(Math.abs(ori) / 3) % 2) as 0 | 1;
}

export function tubeNodeTouches(item: Placement) {
  const part = PART_MAP[item.partId];
  const touches: { x: number; y: number; z: number; dir: number }[] = [];
  if (part?.category !== 'tube') return touches;
  const axis = item.ori % 3;
  const modules = part.modules ?? 1;
  const anchor = anchoredEnd(item.partId, item.ori);
  for (let step = 0; step < modules; step += 1) {
    const x = item.x + (axis === 0 ? step : 0);
    const y = item.y + (axis === 1 ? step : 0);
    const z = item.z + (axis === 2 ? step : 0);
    const farX = x + (axis === 0 ? 1 : 0);
    const farY = y + (axis === 1 ? 1 : 0);
    const farZ = z + (axis === 2 ? 1 : 0);
    if (anchor !== 1) touches.push({ x, y, z, dir: AXIS_POS[axis] });
    if (anchor !== 0) touches.push({ x: farX, y: farY, z: farZ, dir: AXIS_NEG[axis] });
  }
  return touches;
}

/** A joint appears only where at least two tubes meet. Its type follows the port directions. */
export function deriveJoints(list: Placement[]): Placement[] {
  const nodes = new Map<string, { x: number; y: number; z: number; mask: number }>();
  const touch = (x: number, y: number, z: number, dir: number) => {
    const key = `${x}:${y}:${z}`;
    const node = nodes.get(key) ?? { x, y, z, mask: 0 };
    node.mask |= 1 << dir;
    nodes.set(key, node);
  };
  for (const item of list) {
    for (const port of tubeNodeTouches(item)) touch(port.x, port.y, port.z, port.dir);
  }
  const joints: Placement[] = [];
  for (const node of nodes.values()) {
    if (popcount(node.mask) < 2) continue;
    const match = matchMask(node.mask);
    if (!match) continue;
    joints.push({
      uid: `auto:${node.x}:${node.y}:${node.z}`,
      partId: match.id,
      x: node.x,
      y: node.y,
      z: node.z,
      ori: match.ori,
      color: '',
    });
  }
  return joints;
}

export function visiblePlacements(list: Placement[]) {
  const base = structuralPlacements(list);
  return base.concat(deriveJoints(base));
}

export function jointSignature(joint: Placement) {
  return `${joint.uid}:${joint.partId}:${joint.ori}`;
}
