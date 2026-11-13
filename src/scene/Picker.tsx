import { useEffect, useState } from 'react';
import { PART_MAP } from '../model/catalog';
import { usedCount } from '../model/rules';
import type { Placement } from '../model/types';
import { PICK_GROUPS, PICK_ITEMS, type PickItem } from './pickerParts';
import { loadThumbs } from './thumbs';
import { useStore } from '../store';

export function Picker({ focus, onFocus }: { focus: string; onFocus: (item: PickItem) => void }) {
  const [ready, setReady] = useState<Map<string, HTMLCanvasElement> | null>(null);
  useEffect(() => {
    let live = true;
    loadThumbs().then((thumbs) => {
      if (live) setReady(thumbs);
    });
    return () => {
      live = false;
    };
  }, []);

  const stock = useStore((state) => state.stock);
  const placements = useStore((state) => state.placements);
  return (
    <>
      {PICK_GROUPS.map((group) => (
        <section className="section" key={group}>
          <header>
            <span>{group}</span>
            <span>{PICK_ITEMS.filter((item) => item.group === group).length}</span>
          </header>
          <div className="pick-grid">
            {PICK_ITEMS.filter((item) => item.group === group).map((item) => (
              <PickCard
                key={item.id}
                item={item}
                on={item.id === focus}
                canvas={ready?.get(item.id) ?? null}
                left={remaining(item, stock, placements)}
                onFocus={onFocus}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function PickCard({
  item,
  on,
  canvas,
  left,
  onFocus,
}: {
  item: PickItem;
  on: boolean;
  canvas: HTMLCanvasElement | null;
  left: number | null;
  onFocus: (item: PickItem) => void;
}) {
  return (
    <button type="button" className={on ? 'pick on' : 'pick'} aria-pressed={on} onClick={() => onFocus(item)}>
      <span className={canvas ? 'thumb' : 'thumb wait'} ref={(node) => mountThumb(node, canvas)} />
      {left !== null ? <em className={left < 0 ? 'left hot' : 'left'}>{left}</em> : null}
      {item.colors ? (
        <span className="dots">
          {item.colors.map((color) => <i key={color} style={{ background: color }} />)}
        </span>
      ) : <span className="dots" />}
      <b>{item.name}</b>
      <small>{item.size}</small>
    </button>
  );
}

function remaining(item: PickItem, stock: Record<string, number>, placements: Placement[]) {
  if (!item.placeId) return null;
  const part = PART_MAP[item.placeId];
  if (!part || part.category === 'joint') return null;
  return (stock[item.placeId] ?? 0) - usedCount(placements, item.placeId);
}

function mountThumb(node: HTMLSpanElement | null, canvas: HTMLCanvasElement | null) {
  if (!node || !canvas) return;
  canvas.className = 'thumb-canvas';
  if (node.firstChild !== canvas) node.replaceChildren(canvas);
}

export function choosePick(item: PickItem) {
  if (!item.placeId) return;
  const part = PART_MAP[item.placeId];
  if (!part || part.category === 'joint') {
    useStore.getState().showToast('接头不用手放。管子一接到一起，会按方向自动接上');
    return;
  }
  useStore.getState().setPart(item.placeId);
  if (item.placeId === 'rung') useStore.getState().setRung(150);
}
