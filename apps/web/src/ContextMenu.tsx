import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import type { IconName } from './icons';
import { COLOR_KEYS } from './model';
import type { ColorKey } from './model';
import { COLOR_LABELS, PALETTE } from './theme';
import type { Theme } from './theme';
import { useBack } from './back';

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Shortcut shown on the right, for keyboards. */
  keys?: string;
  danger?: boolean;
  /** Drawn with the accent gradient icon, for the feature the menu leads with. */
  accent?: boolean;
  disabled?: boolean;
  run: () => void;
}

export interface MenuSpec {
  /** Screen position the menu opens from. */
  x: number;
  y: number;
  /** Colour row; omitted when nothing selected can take a colour. */
  colors?: { current: ColorKey | null; pick: (c: ColorKey) => void };
  /** Groups of items, drawn with separators between them. */
  groups: MenuItem[][];
}

interface Props {
  spec: MenuSpec;
  theme: Theme;
  onClose: () => void;
}

/** A Mac-style menu for right-click and long-press, kept on screen. */
export function ContextMenu({ spec, theme, onClose }: Props) {
  useBack(true, onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: spec.x, top: spec.y, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height ignore the opening animation's scale, which would under-measure the menu.
    const r = { width: el.offsetWidth, height: el.offsetHeight };
    const M = 8;
    let left = spec.x;
    let top = spec.y;
    // Flip to the left of the pointer when there is no room on the right, and never leave the screen.
    if (left + r.width > window.innerWidth - M) left = spec.x - r.width;
    left = Math.min(Math.max(M, left), Math.max(M, window.innerWidth - M - r.width));
    if (top + r.height > window.innerHeight - M) top = Math.max(M, window.innerHeight - M - r.height);
    setPos({ left, top, ready: true });
  }, [spec]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Registered after the event that opened the menu has finished.
    const t = window.setTimeout(() => {
      window.addEventListener('pointerdown', away, true);
      window.addEventListener('keydown', key, true);
      window.addEventListener('resize', onClose);
      window.addEventListener('wheel', onClose, { passive: true });
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  const colors = PALETTE[theme];
  const groups = spec.groups.filter((g) => g.length > 0);
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {spec.colors && (
        <div className="menu-colors" role="group" aria-label="Colour">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              className={`swatch${spec.colors!.current === c ? ' on' : ''}`}
              style={{ '--c': colors[c] } as React.CSSProperties}
              aria-label={COLOR_LABELS[c]}
              onClick={() => {
                spec.colors!.pick(c);
                onClose();
              }}
            />
          ))}
        </div>
      )}
      {groups.map((g, i) => (
        <div className="menu-group" key={i}>
          {g.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`menu-item${item.danger ? ' danger' : ''}${item.accent ? ' accent' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.run();
              }}
            >
              <span className="menu-ico">{item.icon && <Icon name={item.icon} size={16} />}</span>
              <span className="menu-label">{item.label}</span>
              {item.keys && <span className="menu-keys">{item.keys}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
