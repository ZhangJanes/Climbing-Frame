import { PART_MAP, jointOrients } from './catalog';
import { anchoredEnd } from './joints';
import { nodePos } from './metrics';
import { facingNormal, spanOf } from './rules';
import type { Placement } from './types';

export type Pose = {
  position: [number, number, number];
  /** Row-major 3×3. Local +Y is the tube axis. */
  matrix: number[];
};

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function ry(deg: number) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Cylinder local +Y onto +X or +Z. */
const TUBE_X = [0, 1, 0, -1, 0, 0, 0, 0, 1];
const TUBE_Z = [1, 0, 0, 0, 0, -1, 0, 1, 0];

export function poseOf(placement: Placement, pitch: number, rungMm = 150): Pose {
  const part = PART_MAP[placement.partId];
  const { x, y, z, ori } = placement;

  if (!part || part.category === 'joint') {
    const list = part ? jointOrients(part) : [];
    const matrix = list[ori]?.matrix ?? list[0]?.matrix ?? I;
    return { position: nodePos(x, y, z, pitch), matrix };
  }

  if (part.category === 'tube') {
    const axis = ori % 3;
    return {
      position: tubeCenter(placement, pitch, rungMm),
      matrix: axis === 0 ? TUBE_X : axis === 2 ? TUBE_Z : I,
    };
  }

  if (part.feature === 'slide' || part.feature === 'curved') {
    return { position: nodePos(x, y, z, pitch), matrix: ry([0, 180, -90, 90][ori % 4]) };
  }

  if (part.feature === 'capsule') {
    const a = nodePos(x, y, z, pitch);
    const b = nodePos(x + 1, y + 1, z + 1, pitch);
    return { position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], matrix: I };
  }

  if (part.feature === 'swing') {
    const alongX = ori % 2 === 0;
    return {
      position: nodePos(x + (alongX ? 0.5 : 0), y + 1, z + (alongX ? 0 : 0.5), pitch),
      matrix: alongX ? I : ry(-90),
    };
  }

  const center = footprintCenter(placement, pitch);
  if (part.panel === 'pit') center[1] -= 0.22;
  if (part.feature === 'wheel') {
    const normal = facingNormal(ori);
    const lift = 0.08;
    if (normal === 'x') center[0] += lift;
    if (normal === 'z') center[2] += lift;
    return { position: center, matrix: normal === 'x' ? ry(90) : I };
  }

  const normal = facingNormal(ori);
  let matrix = I;
  if (normal === 'y' && ori === 1) matrix = ry(-90);
  else if (normal === 'x') matrix = ry(90);
  return { position: center, matrix };
}

function footprintCenter(placement: Placement, pitch: number): [number, number, number] {
  const part = PART_MAP[placement.partId];
  const span = part.feature === 'wheel' ? { w: 1, d: 1 } : spanOf(part, placement.ori);
  const normal = facingNormal(placement.ori);
  const { x, y, z } = placement;
  if (normal === 'y') return nodePos(x + span.w / 2, y, z + span.d / 2, pitch);
  if (normal === 'x') return nodePos(x, y + span.d / 2, z + span.w / 2, pitch);
  return nodePos(x + span.w / 2, y + span.d / 2, z, pitch);
}

export function tubeLengthUnits(partId: string, pitch: number, rungMm: number) {
  if (partId === 'rung') return Math.min(0.88, Math.min(pitch, Math.max(120, rungMm)) / pitch);
  if (partId === 'tube') return 0.88;
  return 1;
}

/** Full tubes sit on the midpoint. A short tube slides until one end meets a joint. */
export function tubeCenter(placement: Pick<Placement, 'partId' | 'x' | 'y' | 'z' | 'ori'>, pitch: number, rungMm = 150): [number, number, number] {
  const axis = placement.ori % 3;
  const a = nodePos(placement.x, placement.y, placement.z, pitch);
  const b = nodePos(
    placement.x + (axis === 0 ? 1 : 0),
    placement.y + (axis === 1 ? 1 : 0),
    placement.z + (axis === 2 ? 1 : 0),
    pitch,
  );
  const anchor = anchoredEnd(placement.partId, placement.ori);
  let t = 0.5;
  if (anchor !== null) {
    const along = 0.06 + tubeLengthUnits(placement.partId, pitch, rungMm) / 2;
    t = anchor === 0 ? along : 1 - along;
  }
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
