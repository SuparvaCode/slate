import type { ColorKey } from './model';

export type Theme = 'light' | 'dark';

/** Apple system colors, light and dark variants. */
export const PALETTE: Record<Theme, Record<ColorKey, string>> = {
  light: {
    ink: '#1d1d1f',
    gray: '#8e8e93',
    red: '#ff3b30',
    orange: '#ff9500',
    yellow: '#ffcc00',
    green: '#34c759',
    blue: '#007aff',
    violet: '#af52de',
  },
  dark: {
    ink: '#f5f5f7',
    gray: '#98989d',
    red: '#ff453a',
    orange: '#ff9f0a',
    yellow: '#ffd60a',
    green: '#30d158',
    blue: '#0a84ff',
    violet: '#bf5af2',
  },
};

export const COLOR_LABELS: Record<ColorKey, string> = {
  ink: 'Black',
  gray: 'Gray',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  violet: 'Purple',
};

export const THEME_BG: Record<Theme, string> = { light: '#fbfbfd', dark: '#1c1c1e' };
export const GRID_DOT: Record<Theme, string> = { light: '#d2d2d7', dark: '#3a3a3c' };
export const ACCENT: Record<Theme, string> = { light: '#007aff', dark: '#0a84ff' };
