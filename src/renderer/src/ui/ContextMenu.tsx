import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { matches } from '../shortcuts';

export interface MenuItem {
  label?: string;
  /**
   * The same action's label where there is less room for it (GC-213). The menu itself never uses
   * this — it is for a surface that renders these items as a row of buttons, which today is the
   * stash view's head (GC-178).
   *
   * It exists because the two surfaces need different amounts of the noun, not different actions:
   * a stash's menu is opened from a row in a list of many, so "Apply stash" is right there, while
   * the panel's head already says `stash@{0}: 59ff3b1` two inches to the left and repeating the
   * word four times cost 160px the 400px panel does not have — the four buttons wrapped onto two
   * ragged lines. Behaviour, hint, `danger` and the confirmation all still come from the one item,
   * so the surfaces cannot drift on anything that matters; only on how much they restate.
   */
  short?: string;
  hint?: string; // right-aligned secondary text, e.g. a shortcut or explanation
  hintPath?: boolean; // the hint is a path: ellipsise it at its start so the tail stays (GC-067)
  caption?: boolean; // a non-interactive heading over the group beneath it (GC-067)
  /** An input at the top of the menu that narrows the rows beneath it as it is typed (GC-096). */
  filter?: boolean;
  placeholder?: string; // the filter's placeholder
  onClick?: () => unknown;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

/** A row the user can act on, as opposed to the furniture around it. */
const isRow = (i: MenuItem): boolean => !i.caption && !i.separator && !i.filter;

/**
 * The items a menu draws for a filter query (GC-096). Pure, and exported so the rule is tested
 * rather than read off the component: a row survives when its label holds the term, a caption only
 * while a row of its own group does, and a separator only between two things that are still there
 * — otherwise narrowing a list to one group leaves a rule floating over nothing. An empty query
 * changes nothing, and a query that matches nothing says so in a row rather than collapsing the
 * menu to a bare input.
 */
export function filterMenuItems(items: MenuItem[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const kept = items.filter((i) => !isRow(i) || (i.label ?? '').toLowerCase().includes(q));
  const grouped: MenuItem[] = [];
  for (let i = 0; i < kept.length; i++) {
    const it = kept[i]!;
    if (it.caption) {
      // A caption governs everything up to the next caption, so that is how far its group reaches.
      let hasRow = false;
      for (let j = i + 1; j < kept.length && !kept[j]!.caption; j++) if (isRow(kept[j]!)) hasRow = true;
      if (!hasRow) continue;
    }
    grouped.push(it);
  }
  const out: MenuItem[] = [];
  for (const it of grouped) {
    if (!it.separator) {
      out.push(it);
      continue;
    }
    // Leading, doubled, or with nothing but the filter above it: a rule with no group to divide.
    if (out.some(isRow) && !out[out.length - 1]?.separator) out.push(it);
  }
  while (out.length && out[out.length - 1]!.separator) out.pop();
  if (!out.some(isRow)) out.push({ label: 'No matches', disabled: true });
  return out;
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
 * a click outside, a scroll of anything else, a resize or a blur, but never on Escape: like the
 * dialogs, the menu is a layer `App` closes (GC-034, GC-037), so one Escape can only ever close
 * one of them.
 *
 * Taller than the window, it is capped by `.ctx-menu`'s `max-height` and scrolls inside
 * itself (GC-120), at which point the clamp below lands it at `top: 4` — it never flips above
 * the pointer, so a cap costs it nothing.
 *
 * The outside click below is also what dismisses the menu when its own dropdown control is
 * clicked a second time; making that click leave the menu shut instead of reopening it needs the
 * owning element, which only `UiProvider` knows, so it lives there (GC-066).
 */
export function ContextMenu({ menu, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  // The filter is the menu's own state (GC-096): the caller hands over one list and never sees it
  // narrow, so nothing reopens the menu — which would move it and take the focus off the field.
  const [query, setQuery] = useState('');
  const filterInput = useRef<HTMLInputElement>(null);
  const hasFilter = menu.items.some((i) => i.filter);
  useEffect(() => {
    filterInput.current?.focus();
  }, [menu]);
  const items = useMemo(() => (hasFilter ? filterMenuItems(menu.items, query) : menu.items), [hasFilter, menu.items, query]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `offsetWidth`/`offsetHeight`, never `getBoundingClientRect()` (GC-214). The menu opens
    // out of the pointer with a keyframe that starts it at 96%, and this effect runs before the
    // first paint — which is precisely when that keyframe is what the element computes, because
    // a CSS animation's first frame is resolved with the style that inserted it. A rect measured
    // here is 4% smaller than the menu about to be drawn, so the clamp would allow a position
    // that puts 17px of a 420px branch menu over the right edge of the window. The layout box
    // ignores transforms, and "how wide is this menu" is what the clamp has always meant.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - h - 4)) });
  }, [menu]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const close = (): void => onClose();
    // A wheel closes the menu because the surface under it scrolled away from the anchor — but a
    // menu tall enough to be capped scrolls itself, and that wheel is the user reaching its last
    // row, not the page moving (GC-120).
    const onWheel = (e: WheelEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', onWheel);
    };
  }, [onClose]);

  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item.filter ? (
          <input
            key={i}
            ref={filterInput}
            className="ctx-filter"
            placeholder={item.placeholder ?? 'Filter'}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            // Enter takes the first row still standing. `dialogConfirm` rather than a key name of
            // its own: the table is the only place a key is compared (GC-010), and this is the same
            // "accept what is in front of me" the modal's own input answers to. Escape is not here
            // either — `App` closes the topmost layer, and this menu is one (GC-034).
            onKeyDown={(e) => {
              if (!matches('dialogConfirm', e)) return;
              const first = items.find((x) => isRow(x) && !x.disabled);
              if (!first) return;
              e.preventDefault();
              onClose();
              void first.onClick?.();
            }}
          />
        ) : item.separator ? (
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
