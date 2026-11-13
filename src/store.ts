import { create } from 'zustand';
import { COLORWAYS, EXAMPLE_STOCK, PARTS, PART_MAP, emptyStock, partByName } from './model/catalog';
import { audit, boundsMm, usedCount } from './model/rules';
import type { DesignFile, Mode, Placement } from './model/types';

const KEY = 'climbing-frame-design-v1';

type Snap = { placements: Placement[] };

export type Store = {
  name: string;
  pitch: number;
  rungMm: number;
  colorwayId: string;
  color: string;
  mode: Mode;
  partId: string;
  oriByPart: Record<string, number>;
  stock: Record<string, number>;
  placements: Placement[];
  past: Snap[];
  future: Snap[];
  selectedUid: string | null;
  inspector: boolean;
  showSize: boolean;
  assemblyY: number | null;
  explodeLayers: boolean;
  toast: string | null;
  setName: (name: string) => void;
  setPitch: (pitch: number) => void;
  setRung: (mm: number) => void;
  setMode: (mode: Mode) => void;
  setPart: (partId: string) => void;
  cycleOri: () => void;
  setColorway: (id: string) => void;
  setColor: (color: string) => void;
  setStock: (partId: string, count: number) => void;
  fillExample: () => void;
  importStock: (text: string) => void;
  place: (draft: Omit<Placement, 'uid'>) => string;
  remove: (uid: string) => void;
  paint: (uid: string) => void;
  recolor: (uid: string, color: string) => void;
  select: (uid: string | null, inspect?: boolean) => void;
  toggleSize: () => void;
  setAssemblyY: (y: number | null) => void;
  setExplodeLayers: (on: boolean) => void;
  undo: () => void;
  redo: () => void;
  toggleInspector: (open?: boolean) => void;
  showToast: (text: string) => void;
  saveDesign: () => void;
  loadDesign: (file: DesignFile) => void;
};

function uid() {
  return crypto.randomUUID();
}

function readPersisted(): Partial<Store> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as DesignFile & { stock?: Record<string, number>; color?: string };
    if (data.version !== 1 || !Array.isArray(data.placements)) return null;
    return data;
  } catch {
    return null;
  }
}

const saved = readPersisted();
const initialWay = COLORWAYS.find((item) => item.id === saved?.colorwayId) ?? COLORWAYS[0];

let toastTimer = 0;

export const useStore = create<Store>((set, get) => ({
  name: saved?.name || '未命名方案',
  pitch: saved?.pitch && saved.pitch >= 200 ? saved.pitch : 400,
  rungMm: saved?.rungMm && saved.rungMm >= 120 ? saved.rungMm : 280,
  colorwayId: initialWay.id,
  color: saved?.color && initialWay.colors.includes(saved.color) ? saved.color : initialWay.colors[0],
  mode: 'place',
  partId: 'tube',
  oriByPart: {},
  stock: { ...emptyStock(), ...(saved?.stock ?? {}) },
  placements: (saved?.placements ?? []).filter((item) => PART_MAP[item.partId]?.category !== 'joint'),
  past: [],
  future: [],
  selectedUid: null,
  inspector: false,
  showSize: false,
  assemblyY: null,
  explodeLayers: false,
  toast: null,
  setName: (name) => set({ name }),
  setPitch: (pitch) => set({ pitch: Math.max(200, Math.min(800, Math.round(pitch))) }),
  setRung: (mm) => set({ rungMm: Math.max(120, Math.min(400, Math.round(mm))) }),
  setMode: (mode) => set({ mode }),
  setPart: (partId) => set({ partId }),
  cycleOri: () =>
    set((state) => ({
      oriByPart: { ...state.oriByPart, [state.partId]: (state.oriByPart[state.partId] ?? 0) + 1 },
    })),
  setColorway: (id) => {
    const way = COLORWAYS.find((item) => item.id === id) ?? COLORWAYS[0];
    set({ colorwayId: way.id, color: way.colors[0] });
  },
  setColor: (color) => set({ color }),
  setStock: (partId, count) =>
    set((state) => ({ stock: { ...state.stock, [partId]: Math.max(0, Math.min(999, Math.round(count))) } })),
  fillExample: () => {
    set({ stock: { ...emptyStock(), ...EXAMPLE_STOCK } });
    get().showToast('已填入示例数量，不是商品清单');
  },
  importStock: (text) => {
    const next = { ...emptyStock() };
    let n = 0;
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      const data = JSON.parse(trimmed) as { stock?: Record<string, number> };
      const source = data.stock ?? (data as Record<string, number>);
      for (const [key, value] of Object.entries(source)) {
        const id = PART_MAP[key] ? key : partByName(key)?.id;
        if (!id || typeof value !== 'number') continue;
        next[id] = Math.max(0, Math.round(value));
        n += 1;
      }
    } else {
      for (const line of trimmed.split(/\r?\n/)) {
        const row = line.trim();
        if (!row || row.startsWith('id') || row.startsWith('零件')) continue;
        const [a, b] = row.split(/[,，\t]/);
        if (!a || !b) continue;
        const id = PART_MAP[a.trim()] ? a.trim() : partByName(a.trim())?.id;
        const value = Number(b);
        if (!id || !Number.isFinite(value)) continue;
        next[id] = Math.max(0, Math.round(value));
        n += 1;
      }
    }
    set({ stock: next });
    get().showToast(n ? `已导入 ${n} 种零件` : '没有读到数量');
  },
  place: (draft) => {
    const id = uid();
    set((state) => ({
      past: [...state.past, { placements: state.placements }].slice(-50),
      future: [],
      placements: [...state.placements, { ...draft, uid: id }],
      selectedUid: null,
    }));
    return id;
  },
  remove: (id) =>
    set((state) => ({
      past: [...state.past, { placements: state.placements }].slice(-50),
      future: [],
      placements: state.placements.filter((item) => item.uid !== id),
      selectedUid: state.selectedUid === id ? null : state.selectedUid,
    })),
  paint: (id) => get().recolor(id, get().color),
  recolor: (id, color) => {
    const item = get().placements.find((entry) => entry.uid === id);
    if (!item) return;
    if (PART_MAP[item.partId]?.category === 'joint') {
      get().showToast('接头保持黑色');
      return;
    }
    if (item.color === color) {
      set({ color });
      return;
    }
    set((state) => ({
      past: [...state.past, { placements: state.placements }].slice(-50),
      future: [],
      color,
      placements: state.placements.map((entry) => (entry.uid === id ? { ...entry, color } : entry)),
    }));
  },
  select: (selectedUid, inspect = true) => set({ selectedUid, inspector: selectedUid && inspect ? true : get().inspector }),
  toggleSize: () => set((state) => ({ showSize: !state.showSize })),
  setAssemblyY: (assemblyY) => set({ assemblyY }),
  setExplodeLayers: (explodeLayers) => set({ explodeLayers }),
  undo: () =>
    set((state) => {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        future: [...state.future, { placements: state.placements }],
        placements: prev.placements,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      return {
        future: state.future.slice(0, -1),
        past: [...state.past, { placements: state.placements }],
        placements: next.placements,
      };
    }),
  toggleInspector: (open) => set((state) => ({ inspector: open ?? !state.inspector })),
  showToast: (text) => {
    window.clearTimeout(toastTimer);
    set({ toast: text });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2400);
  },
  saveDesign: () => {
    const state = get();
    const file: DesignFile = {
      version: 1,
      name: state.name,
      pitch: state.pitch,
      colorwayId: state.colorwayId,
      rungMm: state.rungMm,
      placements: state.placements,
    };
    download(`${state.name || '方案'}.json`, JSON.stringify(file, null, 2));
    state.showToast(`已保存「${state.name || '方案'}」`);
  },
  loadDesign: (file) => {
    const way = COLORWAYS.find((item) => item.id === file.colorwayId) ?? COLORWAYS[0];
    const placements = (file.placements ?? []).filter((item) => PART_MAP[item.partId]?.category !== 'joint');
    set({
      name: file.name || '未命名方案',
      pitch: file.pitch || 400,
      rungMm: file.rungMm || 280,
      colorwayId: way.id,
      color: way.colors[0],
      placements,
      past: [],
      future: [],
      selectedUid: null,
    });
    const issues = audit(placements, get().stock);
    if (issues.length) {
      set({ inspector: true });
      get().showToast('方案已打开，有零件超出数量');
    } else get().showToast(`已打开「${file.name || '方案'}」`);
  },
}));

function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

useStore.subscribe((state) => {
  const file = {
    version: 1 as const,
    name: state.name,
    pitch: state.pitch,
    colorwayId: state.colorwayId,
    rungMm: state.rungMm,
    placements: state.placements,
    stock: state.stock,
    color: state.color,
  };
  localStorage.setItem(KEY, JSON.stringify(file));
});

export function stockTemplate() {
  const lines = ['零件,数量', ...PARTS.map((part) => `${part.name},0`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '零件数量.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export function selectIssues() {
  const state = useStore.getState();
  return audit(state.placements, state.stock);
}

export function selectSize() {
  const state = useStore.getState();
  return boundsMm(state.placements, state.pitch);
}

export { usedCount };
