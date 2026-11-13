import type { Dir } from '../model/orient';

export type ThumbKind =
  | { type: 'tube'; length: number; metal?: boolean; bend?: boolean }
  | { type: 'panel'; w: number; d: number; face: 'solid' | 'hole' | 'honey' | 'quarter' }
  | { type: 'joint'; ports: Dir[] }
  | { type: 'rings' }
  | { type: 'net'; w: number; d: number }
  | { type: 'rope' }
  | { type: 'archNet'; w: number; h: number }
  | { type: 'cloth'; w: number; d: number };

export type PickItem = {
  id: string;
  name: string;
  group: '管件' | '板件' | '通件' | '配件';
  /** Placeable part id. Joints stay automatic. */
  placeId?: string;
  colors?: string[];
  size: string;
  note?: string;
  kind: ThumbKind;
};

const RED = '#F21D1D';
const YELLOW = '#FFD000';
const BLUE = '#1A47FF';
const GREEN = '#14D13F';
const FOUR = [RED, YELLOW, BLUE, GREEN];

export const PICK_GROUPS = ['管件', '板件', '通件', '配件'] as const;

export const PICK_ITEMS: PickItem[] = [
  { id: 'tube35', name: '35管', group: '管件', placeId: 'tube', colors: FOUR, size: '350 mm', kind: { type: 'tube', length: 350 } },
  { id: 'tube15', name: '15管', group: '管件', placeId: 'rung', colors: FOUR, size: '150 mm', kind: { type: 'tube', length: 150 } },
  { id: 'bendTube', name: '大弯管', group: '管件', colors: [YELLOW, BLUE, GREEN], size: '四分之一弯', kind: { type: 'tube', length: 350, bend: true } },
  { id: 'alu', name: '铝管', group: '管件', size: '350 mm', kind: { type: 'tube', length: 350, metal: true } },
  { id: 'board40', name: '40板', group: '板件', placeId: 'solid', colors: FOUR, size: '400×400 mm', kind: { type: 'panel', w: 400, d: 400, face: 'solid' } },
  { id: 'boardBend', name: '大弯板', group: '板件', colors: [YELLOW], size: 'R 400 mm', kind: { type: 'panel', w: 400, d: 400, face: 'quarter' } },
  { id: 'board20', name: '20板', group: '板件', colors: [RED, YELLOW, GREEN], size: '400×200 mm', kind: { type: 'panel', w: 400, d: 200, face: 'solid' } },
  { id: 'honey', name: '蜂窝板', group: '板件', placeId: 'honey', colors: FOUR, size: '400×400 mm', kind: { type: 'panel', w: 400, d: 400, face: 'honey' } },
  { id: 'hole9', name: '9孔板', group: '板件', placeId: 'hole', colors: FOUR, size: '400×400 mm', kind: { type: 'panel', w: 400, d: 400, face: 'hole' } },
  { id: 'five', name: '五通', group: '通件', placeId: 'five', size: '五向接头', kind: { type: 'joint', ports: [0, 1, 2, 4, 5] } },
  { id: 'four', name: '四通', group: '通件', placeId: 'corner4', size: '四向接头', kind: { type: 'joint', ports: [0, 1, 2, 4] } },
  { id: 'three', name: '三通', group: '通件', placeId: 'corner3', size: '三向角', kind: { type: 'joint', ports: [0, 2, 4] } },
  { id: 'cross', name: '十字通', group: '通件', placeId: 'cross4', size: '平面四通', kind: { type: 'joint', ports: [0, 1, 4, 5] } },
  { id: 'tee', name: 'T通', group: '通件', placeId: 'tee', size: '丁字三通', kind: { type: 'joint', ports: [0, 1, 2] } },
  { id: 'ell', name: 'L通', group: '通件', placeId: 'elbow', size: '两通弯头', kind: { type: 'joint', ports: [0, 2] } },
  { id: 'inline', name: '一字通', group: '通件', placeId: 'straight', size: '直通', kind: { type: 'joint', ports: [0, 1] } },
  { id: 'rings', name: '八字环', group: '配件', size: '连环', kind: { type: 'rings' } },
  { id: 'net', name: '爬网', group: '配件', size: '400×400 mm', kind: { type: 'net', w: 400, d: 400 } },
  { id: 'rope', name: '自定义绳子', group: '配件', size: '绳圈', kind: { type: 'rope' } },
  { id: 'archNet', name: '弯管爬网', group: '配件', size: '400×610 mm', note: '尺寸为框架尺寸，仅供参考', kind: { type: 'archNet', w: 400, h: 610 } },
  { id: 'cloth', name: '蹦床布', group: '配件', placeId: 'tramp', size: '800×800 mm', note: '尺寸为框架尺寸，仅供参考', kind: { type: 'cloth', w: 800, d: 800 } },
];

export function pickById(id: string) {
  return PICK_ITEMS.find((item) => item.id === id) ?? PICK_ITEMS[0];
}
