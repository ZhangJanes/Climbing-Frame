import { PARTS, PART_MAP } from './catalog';
import { visiblePlacements } from './joints';
import type { Placement } from './types';

/** One storey is one 35管 tall. A part belongs to the storey of its lower node. */
export function storyOf(item: Placement) {
  return item.y;
}

export function storyLevels(placements: Placement[]) {
  const ys = new Set(visiblePlacements(placements).map(storyOf));
  return [...ys].sort((a, b) => a - b);
}

export function storyBill(placements: Placement[], y: number) {
  const counts = new Map<string, { name: string; count: number; order: number }>();
  for (const item of visiblePlacements(placements)) {
    if (storyOf(item) !== y) continue;
    const part = PART_MAP[item.partId];
    if (!part) continue;
    const previous = counts.get(part.id);
    counts.set(part.id, {
      name: part.name,
      count: (previous?.count ?? 0) + 1,
      order: PARTS.findIndex((entry) => entry.id === part.id),
    });
  }
  return [...counts.values()].sort((a, b) => a.order - b.order);
}

export const LAYER_GAP = 0.85;

export function assemblyLift(y: number, levels: number[], explode: boolean) {
  if (!explode) return 0;
  const index = levels.indexOf(y);
  return index < 0 ? 0 : index * LAYER_GAP;
}
