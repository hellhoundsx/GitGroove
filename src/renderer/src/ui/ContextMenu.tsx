import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

export interface MenuItem {
  label?: string;
  hint?: string; // right-aligned secondary text, e.g. a shortcut or explanation
  hintPath?: boolean; // the hint is a path: ellipsise it at its start so the tail stays (GC-067)
  caption?: boolean; // a non-interactive heading over the group beneath it (GC-067)
  onClick?: () => unknown;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface Props {
  menu: MenuState;
  onClose(): void;
}

/**
 * A DOM context menu positioned at the pointer and kept inside the viewport. It closes itself on
 * a click outside, a scroll, a resize or a blur, but never on Escape: like the dialogs, the menu
 * is a layer `App` closes (GC-034, GC-037), so one Escape can only ever close one of them.
 *
 * The outside click below is also what dismisses the menu when its own dropdown control is
 * clicked a second time; making that click leave the menu shut instead of reopening it needs the
 * owning element, which only `UiProvider` knows, so it lives there (GC-066).
 */
export function ContextMenu({ menu, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) });
  }, [menu]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const close = (): void => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="ctx-sep" />
        ) : item.caption ? (
          // A heading, not a row: a plain div, so it is neither focusable nor clickable and the
          // `.ctx-item` selectors every driver and test uses cannot pick it up (GC-067).
          <div key={i} className="ctx-caption" role="presentation">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              void item.onClick?.();
            }}
          >
            <span className="ctx-label">{item.label}</span>
            {item.hint && <span className={`ctx-hint ${item.hintPath ? 'path' : ''}`}>{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
