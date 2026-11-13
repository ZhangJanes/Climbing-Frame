import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLORWAYS, PARTS, PART_MAP } from './model/catalog';
import { deriveJoints } from './model/joints';
import { audit, boundsMm, usedCount } from './model/rules';
import { storyBill, storyLevels } from './model/layers';
import type { DesignFile, Mode } from './model/types';
import { Picker, choosePick } from './scene/Picker';
import { pickById, type PickItem } from './scene/pickerParts';
import { Viewport, look, removePart, showLayer, slide, type PartMenu } from './scene/Viewport';
import { stockTemplate, useStore } from './store';

const MODES: { id: Mode; name: string }[] = [
  { id: 'place', name: '放置' },
  { id: 'delete', name: '删除' },
  { id: 'paint', name: '上色' },
  { id: 'look', name: '观察' },
];

export function App() {
  const name = useStore((state) => state.name);
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const stock = useStore((state) => state.stock);
  const toast = useStore((state) => state.toast);
  const inspector = useStore((state) => state.inspector);
  const showSize = useStore((state) => state.showSize);
  const levels = useMemo(() => storyLevels(placements), [placements]);
  const assemblyY = useStore((state) => state.assemblyY);
  const explodeLayers = useStore((state) => state.explodeLayers);
  const fileRef = useRef<HTMLInputElement>(null);
  const stockRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState({ text: '', bad: false, x: 0, y: 0, show: false });
  const [menu, setMenu] = useState<PartMenu | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const size = useMemo(() => boundsMm(placements, pitch), [placements, pitch]);
  const issues = useMemo(() => audit(placements, stock), [placements, stock]);

  useEffect(() => {
    if (assemblyY === null || levels.includes(assemblyY)) return;
    useStore.getState().setAssemblyY(levels[0] ?? null);
  }, [assemblyY, levels]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const state = useStore.getState();
      if (event.key === 'r' || event.key === 'R') state.cycleOri();
      if (event.key >= '1' && event.key <= '3') {
        const category = (['tube', 'panel', 'feature'] as const)[Number(event.key) - 1];
        const current = PART_MAP[state.partId];
        if (current?.category !== category) {
          const next = PARTS.find((part) => part.category === category);
          if (next) state.setPart(next.id);
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && state.selectedUid) {
        event.preventDefault();
        removePart(state.selectedUid);
        setMenu(null);
      }
      if (event.key === 'Escape') {
        if (menuRef.current) setMenu(null);
        else if (useStore.getState().assemblyY !== null) useStore.getState().setAssemblyY(null);
      }
      if ((event.key === '[' || event.key === ']') && state.assemblyY !== null) {
        event.preventDefault();
        const levels = storyLevels(state.placements);
        const index = Math.max(0, levels.indexOf(state.assemblyY));
        const next = event.key === ']' ? Math.min(levels.length - 1, index + 1) : Math.max(0, index - 1);
        if (levels[next] !== undefined) state.setAssemblyY(levels[next]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Mark />
          <strong>攀爬架设计台</strong>
        </div>
        <input className="name" aria-label="方案名称" value={name} onChange={(event) => useStore.getState().setName(event.target.value)} />
        {showSize ? (
          <div className="size">
            {size ? (
              <>
                长 {cm(size.w)}
                <span>×</span>
                宽 {cm(size.d)}
                <span>×</span>
                高 {cm(size.h)} cm
              </>
            ) : (
              '放上零件后显示长宽高'
            )}
          </div>
        ) : null}
        <div className="actions">
          <button className="ghost-btn" type="button" onClick={() => fileRef.current?.click()}>打开方案</button>
          <button className="solid" type="button" onClick={() => useStore.getState().saveDesign()}>保存方案</button>
        </div>
      </header>
      <Tray onImport={() => stockRef.current?.click()} />
      <main className="stage">
        <Viewport onLabel={(text, bad, x, y, show) => setLabel({ text, bad, x, y, show })} onMenu={setMenu} />
        {!placements.length ? <div className="empty-hint">左键绕结构转一圈，右键拖动或方向按钮平移。黄线是可接的位置，点一下就能接上管子。</div> : null}
        <AssemblyBar levels={levels} assemblyY={assemblyY} explode={explodeLayers} placements={placements} />
        <div className="views">
          <div className="move" role="group" aria-label="移动画布">
            <button type="button" aria-label="向左" onClick={() => slide(-1, 0)}>←</button>
            <button type="button" aria-label="向右" onClick={() => slide(1, 0)}>→</button>
            <button type="button" aria-label="向上" onClick={() => slide(0, 1)}>↑</button>
            <button type="button" aria-label="向下" onClick={() => slide(0, -1)}>↓</button>
          </div>
          <button type="button" onClick={() => look('iso')}>斜视</button>
          <button type="button" onClick={() => look('top')}>顶</button>
          <button type="button" onClick={() => look('front')}>前</button>
          <button type="button" onClick={() => look('side')}>侧</button>
          <button type="button" onClick={() => look('fit')}>对准</button>
          <button type="button" className={showSize ? 'on' : ''} aria-pressed={showSize} onClick={() => useStore.getState().toggleSize()}>尺寸</button>
        </div>
        <aside className={inspector ? 'inspector open' : 'inspector'} aria-hidden={!inspector}>
          <Inspector issues={issues} />
        </aside>
      </main>
      <footer className="status">
        <label className="pitch">
          <span>格距</span>
          <input aria-label="格距毫米" type="number" min={200} max={800} value={pitch} onChange={(event) => useStore.getState().setPitch(Number(event.target.value))} />
          <span>mm</span>
        </label>
        <span className="hint">已用 {placements.length}</span>
        <ModeCue />
        <div className="modes">
          <UndoButton />
          <RedoButton />
          <div className="mode" role="group" aria-label="操作">
            {MODES.map((mode) => (
              <ModeButton key={mode.id} id={mode.id} name={mode.name} />
            ))}
          </div>
          <button className="check" type="button" onClick={() => useStore.getState().toggleInspector()}>
            检查
            {issues.length ? <i /> : null}
          </button>
        </div>
      </footer>
      <div className={label.show ? `float-label show${label.bad ? ' bad' : ''}` : 'float-label'} style={{ left: label.x + 14, top: label.y + 16 }}>
        {label.text}
      </div>
      <div className={toast ? 'toast show' : 'toast'} role="status">{toast}</div>
      <PartMenuPanel menu={menu} onClose={() => setMenu(null)} />
      <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        file.text().then((text) => {
          const data = JSON.parse(text) as DesignFile;
          if (data.version !== 1) {
            useStore.getState().showToast('这个文件不是方案');
            return;
          }
          useStore.getState().loadDesign(data);
        }).catch(() => useStore.getState().showToast('方案没有打开'));
      }} />
      <input ref={stockRef} hidden type="file" accept=".csv,.json,.txt,text/csv,application/json" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        file.text().then((text) => useStore.getState().importStock(text)).catch(() => useStore.getState().showToast('数量没有导入'));
      }} />
    </div>
  );
}

function ModeCue() {
  const mode = useStore((state) => state.mode);
  const text = {
    place: '点黄线放下。短管按 R，换到另一头接头。',
    delete: '点一件拆掉，或先选中再按 Backspace。',
    paint: '点管子或板，涂上现在选中的颜色。',
    look: '左键绕结构转，右键拖动画布。点中之后可以改色或删除。',
  }[mode];
  return <span className="hint cue">{text}</span>;
}

function UndoButton() {
  const can = useStore((state) => state.past.length > 0);
  return (
    <button className="check" type="button" disabled={!can} onClick={() => useStore.getState().undo()}>撤销</button>
  );
}

function RedoButton() {
  const can = useStore((state) => state.future.length > 0);
  return (
    <button className="check" type="button" disabled={!can} onClick={() => useStore.getState().redo()}>重做</button>
  );
}

function PartMenuPanel({ menu, onClose }: { menu: PartMenu | null; onClose: () => void }) {
  const placements = useStore((state) => state.placements);
  const colorwayId = useStore((state) => state.colorwayId);
  const canUndo = useStore((state) => state.past.length > 0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const selected = menu
    ? placements.find((item) => item.uid === menu.uid) ?? deriveJoints(placements).find((item) => item.uid === menu.uid)
    : null;
  const part = selected ? PART_MAP[selected.partId] : null;
  const way = COLORWAYS.find((item) => item.id === colorwayId) ?? COLORWAYS[0];

  useLayoutEffect(() => {
    if (!menu) return;
    const node = ref.current;
    const width = node?.offsetWidth ?? 196;
    const height = node?.offsetHeight ?? 160;
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)),
    });
  }, [menu, selected?.uid, selected?.color]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (event.button === 2) return;
      const node = event.target as HTMLElement | null;
      if (node?.closest('.menu')) return;
      onClose();
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu, onClose]);

  if (!menu || !selected || !part) return null;
  const locked = selected.uid.startsWith('auto:') || part.category === 'joint';
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      <div className="menu-name">{part.name}</div>
      {locked ? <p className="menu-note">接头跟着管子走，保持黑色。要拆掉它，先拆相连的管子。</p> : (
        <button className="menu-item danger" type="button" role="menuitem" onClick={() => { removePart(selected.uid); onClose(); }}>删除</button>
      )}
      {part.category === 'joint' ? null : (
        <>
          <div className="menu-label">改色</div>
          <div className="menu-colors">
            {way.colors.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={swatch === selected.color ? 'on' : ''}
                style={{ background: swatch }}
                aria-label={`改成 ${swatch}`}
                onClick={() => { useStore.getState().recolor(selected.uid, swatch); onClose(); }}
              />
            ))}
          </div>
        </>
      )}
      <button className="menu-item undo" type="button" role="menuitem" disabled={!canUndo} onClick={() => { useStore.getState().undo(); onClose(); }}>撤销</button>
    </div>
  );
}

function cm(mm: number) {
  return (mm / 10).toFixed(mm % 10 === 0 ? 0 : 1);
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 11H9M13 11H19M11 3V9M11 13V19" stroke="#17181A" strokeWidth="2.4" />
      <rect x="7.5" y="7.5" width="7" height="7" fill="#17181A" />
    </svg>
  );
}

function AssemblyBar({
  levels,
  assemblyY,
  explode,
  placements,
}: {
  levels: number[];
  assemblyY: number | null;
  explode: boolean;
  placements: import('./model/types').Placement[];
}) {
  if (!levels.length) return null;
  const index = Math.max(0, levels.indexOf(assemblyY ?? levels[0]));
  const y = assemblyY === null ? null : (levels.includes(assemblyY) ? assemblyY : levels[0]);
  const bill = y === null ? [] : storyBill(placements, y);
  const open = () => {
    useStore.getState().setMode('look');
    useStore.getState().setAssemblyY(levels[0]);
    showLayer(levels[0]);
  };
  const move = (dir: number) => {
    const next = Math.min(levels.length - 1, Math.max(0, index + dir));
    const nextY = levels[next];
    useStore.getState().setAssemblyY(nextY);
    showLayer(nextY);
  };
  const copyList = () => {
    const title = y === null ? '' : layerTitle(y, index, levels.length);
    const lines = [title, ...bill.map((item) => `${item.name} × ${item.count}`)];
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => useStore.getState().showToast('这一层的清单已复制'),
      () => useStore.getState().showToast('清单没有复制'),
    );
  };
  return (
    <div className="layers">
      <div className="layers-bar">
        <button type="button" className={assemblyY !== null ? 'on' : ''} aria-pressed={assemblyY !== null} onClick={() => (assemblyY === null ? open() : useStore.getState().setAssemblyY(null))}>
          组装
        </button>
        {y !== null ? (
          <>
            <button type="button" disabled={index <= 0} onClick={() => move(-1)}>上一层</button>
            <span className="step-label">{layerTitle(y, index, levels.length)}</span>
            <button type="button" disabled={index >= levels.length - 1} onClick={() => move(1)}>下一层</button>
            <button type="button" className={explode ? 'on' : ''} aria-pressed={explode} onClick={() => useStore.getState().setExplodeLayers(!explode)}>
              {explode ? '拼回' : '拆开'}
            </button>
            <button type="button" onClick={copyList}>复制清单</button>
            <div className="layer-side">
              <span className="layer-note">{y === 0 ? '先装地面，立柱一起插上' : '接到下面已经装好的立柱上'}</span>
              <span className="layer-parts">
                {bill.length ? bill.map((item) => (
                  <b key={item.name}>{item.name} {item.count}</b>
                )) : <b>这一层没有新零件</b>}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function layerTitle(y: number, index: number, total: number) {
  const height = y === 0 ? '地面' : `往上 ${y} 根35管`;
  return `第 ${index + 1}/${total} 层 · ${height}`;
}

function ModeButton({ id, name }: { id: Mode; name: string }) {
  const mode = useStore((state) => state.mode);
  return (
    <button type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => useStore.getState().setMode(id)}>
      {name}
    </button>
  );
}

function Tray({ onImport }: { onImport: () => void }) {
  const [focus, setFocus] = useState('tube35');
  const item = pickById(focus);
  return (
    <aside className="tray">
      <div className="tray-tools">
        <button className="text-btn" type="button" onClick={onImport}>导入数量</button>
        <button className="text-btn" type="button" onClick={stockTemplate}>模板</button>
        <button className="text-btn" type="button" onClick={() => useStore.getState().fillExample()}>示例数量</button>
      </div>
      <div className="tray-scroll">
        <Picker focus={focus} onFocus={(next) => { setFocus(next.id); choosePick(next); }} />
      </div>
      <Hand item={item} />
    </aside>
  );
}

function Hand({ item }: { item: PickItem }) {
  const part = item.placeId ? PART_MAP[item.placeId] : null;
  const partId = item.placeId ?? '';
  const stock = useStore((state) => state.stock);
  const placements = useStore((state) => state.placements);
  const colorwayId = useStore((state) => state.colorwayId);
  const color = useStore((state) => state.color);
  const rungMm = useStore((state) => state.rungMm);
  const way = COLORWAYS.find((entry) => entry.id === colorwayId) ?? COLORWAYS[0];
  const have = stock[partId] ?? 0;
  const left = part ? have - usedCount(placements, partId) : 0;
  const placeable = part && part.category !== 'joint';
  return (
    <div className="hand">
      <div className="hand-name">{item.name}</div>
      <p>{item.size}{item.note ? ` · ${item.note}` : ''}</p>
      {part ? <p>{part.detail}</p> : <p>按图上的尺寸和造型展示。这件先不接到格子上。</p>}
      {placeable ? (
        <>
          <div className="ways">
            {COLORWAYS.map((item) => (
              <button key={item.id} type="button" className={item.id === way.id ? 'on' : ''} onClick={() => useStore.getState().setColorway(item.id)}>
                {item.name}
              </button>
            ))}
          </div>
          {way.note ? <div className="note">{way.note}</div> : null}
          <div className="swatches">
            {way.colors.map((swatch) => (
              <button key={swatch} type="button" className={swatch === color ? 'on' : ''} style={{ background: swatch }} aria-label={swatch} onClick={() => useStore.getState().setColor(swatch)} />
            ))}
          </div>
        </>
      ) : null}
      {placeable ? (
        <>
      <div className="count-label" style={{ marginTop: 14 }}>现有</div>
      <div className="count-row">
        <button className="step" type="button" aria-label="减少" onClick={() => useStore.getState().setStock(partId, have - 1)}>−</button>
        <input className="stock-input" aria-label="现有数量" type="number" min={0} max={999} value={have} onChange={(event) => useStore.getState().setStock(partId, Number(event.target.value || 0))} />
        <button className="step" type="button" aria-label="增加" onClick={() => useStore.getState().setStock(partId, have + 1)}>+</button>
      </div>
      <div className={left < 0 ? 'remain hot' : 'remain'}>剩余 {left}</div>
      {partId === 'rung' ? (
        <label className="rung">
          15管长度
          <input type="number" min={120} max={400} value={rungMm} onChange={(event) => useStore.getState().setRung(Number(event.target.value))} />
          mm
        </label>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

function Inspector({ issues }: { issues: { text: string }[] }) {
  const selectedUid = useStore((state) => state.selectedUid);
  const placements = useStore((state) => state.placements);
  const selected = placements.find((item) => item.uid === selectedUid) ?? deriveJoints(placements).find((item) => item.uid === selectedUid);
  const part = selected ? PART_MAP[selected.partId] : null;
  return (
    <>
      <h2>检查</h2>
      {selected && part ? (
        <div className="meta">
          <b>{part.name}</b>
          <div>格子 {selected.x}, {selected.y}, {selected.z}</div>
          {selected.uid.startsWith('auto:') ? <div>这是自动接上的接头。</div> : (
            <button className="danger" type="button" onClick={() => removePart(selected.uid)}>拆掉这一件</button>
          )}
        </div>
      ) : <p className="quiet">在观察模式下点一件，这里会写出它的位置。</p>}
      {issues.length ? issues.map((issue) => <div className="issue" key={issue.text}>{issue.text}</div>) : <p className="quiet">数量和结构目前对得上。</p>}
      <p className="quiet">接头按汇合的管子自动选择。两根直线是直通，两根垂直是弯头，三根以上按方向换成三通、四通、五通或六通。</p>
    </>
  );
}
