import { PART_MAP } from './catalog';
import { structuralPlacements, tubeNodeTouches } from './joints';
import { inNode } from './metrics';
import type { Axis } from './rules';
import type { Placement } from './types';

export type GuideEdge = { x: number; y: number; z: number; axis: Axis };

function edgeKey(x: number, y: number, z: number, axis: Axis) {
  return `${axis}:${x}:${y}:${z}`;
}

/** Open one-module slots at every tube end. The first tube uses a patch of floor lines. */
export function tubeGuides(placements: Placement[]): GuideEdge[] {
  const tubes = structuralPlacements(placements).filter((item) => PART_MAP[item.partId]?.category === 'tube');
  const occupied = new Set<string>();
  const nodes = new Set<string>();
  for (const tube of tubes) {
    const axis = (tube.ori % 3) as Axis;
    const modules = PART_MAP[tube.partId]?.modules ?? 1;
    for (let step = 0; step < modules; step += 1) {
      const x = tube.x + (axis === 0 ? step : 0);
      const y = tube.y + (axis === 1 ? step : 0);
      const z = tube.z + (axis === 2 ? step : 0);
      occupied.add(edgeKey(x, y, z, axis));
    }
    for (const port of tubeNodeTouches(tube)) nodes.add(`${port.x}:${port.y}:${port.z}`);
  }

  const seen = new Set<string>();
  const guides: GuideEdge[] = [];
  const push = (x: number, y: number, z: number, axis: Axis) => {
    if (x < 0 || y < 0 || z < 0) return;
    const endX = x + (axis === 0 ? 1 : 0);
    const endY = y + (axis === 1 ? 1 : 0);
    const endZ = z + (axis === 2 ? 1 : 0);
    if (!inNode(x, y, z) || !inNode(endX, endY, endZ)) return;
    const key = edgeKey(x, y, z, axis);
    if (occupied.has(key) || seen.has(key)) return;
    seen.add(key);
    guides.push({ x, y, z, axis });
  };

  if (!nodes.size) {
    for (let x = 3; x <= 7; x += 1) {
      for (let z = 2; z <= 5; z += 1) {
        push(x, 0, z, 0);
        push(x, 0, z, 2);
      }
    }
    return guides;
  }

  for (const key of nodes) {
    const [x, y, z] = key.split(':').map(Number);
    ([0, 1, 2] as Axis[]).forEach((axis) => {
      push(x, y, z, axis);
      push(x - (axis === 0 ? 1 : 0), y - (axis === 1 ? 1 : 0), z - (axis === 2 ? 1 : 0), axis);
    });
  }
  return guides;
}
