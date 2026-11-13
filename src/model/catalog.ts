import { orientationsFor, type Dir, type Orientation } from './orient';

export type Category = 'joint' | 'tube' | 'panel' | 'feature';
export type FeatureKind = 'slide' | 'curved' | 'tramp' | 'bridge' | 'wheel' | 'capsule' | 'swing';
export type PanelStyle = 'solid' | 'hole' | 'honey' | 'wall' | 'roof' | 'pit';

export type Part = {
  id: string;
  category: Category;
  name: string;
  detail: string;
  aliases?: string[];
  ports?: Dir[];
  /** Tube occupies this many modules along its axis. */
  modules?: number;
  panel?: PanelStyle;
  /** Footprint in cells. w along the first tangent, d along the second. */
  span?: { w: number; d: number };
  feature?: FeatureKind;
};

export const PARTS: Part[] = [
  { id: 'elbow', category: 'joint', name: 'L通', detail: '两根管子垂直相接时自动接上', aliases: ['两通弯头'], ports: [0, 2] },
  { id: 'straight', category: 'joint', name: '一字通', detail: '两根管子拉成一条直线时自动接上', aliases: ['直通'], ports: [0, 1] },
  { id: 'corner3', category: 'joint', name: '三通', detail: '三根管子交在角上时自动接上', aliases: ['三向角'], ports: [0, 2, 4] },
  { id: 'tee', category: 'joint', name: 'T通', detail: '一根直管再分出一支时自动接上', aliases: ['丁字三通'], ports: [0, 1, 2] },
  { id: 'cross4', category: 'joint', name: '十字通', detail: '四根管子组成十字时自动接上', aliases: ['平面四通'], ports: [0, 1, 4, 5] },
  { id: 'corner4', category: 'joint', name: '四通', detail: '角上再多接一根时自动接上', aliases: ['角四通'], ports: [0, 1, 2, 4] },
  { id: 'five', category: 'joint', name: '五通', detail: '五根管子汇合时自动接上', ports: [0, 1, 2, 4, 5] },
  { id: 'six', category: 'joint', name: '六通', detail: '六个方向都有管子时自动接上', ports: [0, 1, 2, 3, 4, 5] },
  { id: 'tube', category: 'tube', name: '35管', detail: '长 350 mm，接在一格上', aliases: ['一格管'], modules: 1 },
  { id: 'rung', category: 'tube', name: '15管', detail: '长 150 mm。靠在接头上，R 换到另一头', aliases: ['短横档'], modules: 1 },
  { id: 'solid', category: 'panel', name: '40板', detail: '400×400 mm 实心板', aliases: ['平台板'], panel: 'solid', span: { w: 1, d: 1 } },
  { id: 'hole', category: 'panel', name: '9孔板', detail: '400×400 mm，三行三列圆孔', aliases: ['九孔板'], panel: 'hole', span: { w: 1, d: 1 } },
  { id: 'honey', category: 'panel', name: '蜂窝板', detail: '400×400 mm 六角网眼', panel: 'honey', span: { w: 1, d: 1 } },
  { id: 'wall', category: 'panel', name: '墙板', detail: '竖着的一格板', panel: 'wall', span: { w: 1, d: 1 } },
  { id: 'roof', category: 'panel', name: '屋顶板', detail: '铺在顶上的一格板', panel: 'roof', span: { w: 1, d: 1 } },
  { id: 'pit', category: 'panel', name: '球池围板', detail: '只有下半格高的围板', panel: 'pit', span: { w: 1, d: 1 } },
  { id: 'slide', category: 'feature', name: '滑梯板', detail: '两格长，落下一格', feature: 'slide' },
  { id: 'tramp', category: 'feature', name: '蹦床布', detail: '800×800 mm，尺寸为框架尺寸，仅供参考', aliases: ['蹦床'], feature: 'tramp', span: { w: 2, d: 1 } },
  { id: 'bridge', category: 'feature', name: '绳吊桥', detail: '两格长的软桥', feature: 'bridge', span: { w: 2, d: 1 } },
  { id: 'wheel', category: 'feature', name: '方向盘', detail: '装在竖面上', feature: 'wheel' },
  { id: 'capsule', category: 'feature', name: '太空舱', detail: '占一个空格的透明球', feature: 'capsule' },
  { id: 'curved', category: 'feature', name: '弧形滑梯', detail: '先陡后缓，两格长', feature: 'curved' },
  { id: 'swing', category: 'feature', name: '秋千架', detail: '两格高的门洞里挂一条秋千', feature: 'swing' },
];

export const PART_MAP = Object.fromEntries(PARTS.map((part) => [part.id, part])) as Record<string, Part>;

const orientCache = new Map<string, Orientation[]>();

export function jointOrients(part: Part): Orientation[] {
  const cached = orientCache.get(part.id);
  if (cached) return cached;
  const list = orientationsFor(part.ports ?? []);
  orientCache.set(part.id, list);
  return list;
}

export type Colorway = { id: string; name: string; colors: string[]; note?: string };

export const COLORWAYS: Colorway[] = [
  { id: 'classic', name: '金典', colors: ['#FF1E1E', '#FFE600', '#1A47FF', '#14D13F'] },
  { id: 'homeGreen', name: 'HOME 绿', colors: ['#7DFF3C', '#0E8A42', '#FFFFFF', '#A3A8AD'] },
  { id: 'homeBlue', name: 'HOME 蓝', colors: ['#2EC6FF', '#1240C8', '#FFFFFF', '#A3A8AD'] },
  { id: 'gray', name: '白灰', colors: ['#FFFFFF', '#8E949B'] },
  { id: 'macaron', name: '马卡龙', colors: ['#FF4D8D', '#3EC4FF', '#3DDE62', '#FFE033'] },
  {
    id: 'macaronPurple',
    name: '马卡龙紫',
    colors: ['#C44DFF'],
    note: '页面没写清这套的四色，先用一个临时紫色。',
  },
];

export const EXAMPLE_STOCK: Record<string, number> = {
  elbow: 10,
  straight: 4,
  corner3: 12,
  tee: 6,
  cross4: 6,
  corner4: 4,
  five: 4,
  six: 6,
  tube: 48,
  rung: 10,
  solid: 6,
  hole: 2,
  honey: 2,
  wall: 4,
  roof: 2,
  pit: 4,
  slide: 1,
  tramp: 1,
  bridge: 1,
  wheel: 1,
  capsule: 1,
  curved: 1,
  swing: 1,
};

export function emptyStock(): Record<string, number> {
  return Object.fromEntries(PARTS.map((part) => [part.id, 0]));
}

export function partByName(name: string) {
  return PARTS.find((part) => part.name === name || part.aliases?.includes(name));
}
