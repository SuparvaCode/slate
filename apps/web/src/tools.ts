import type { IconName } from './icons';

export type Tool =
  | 'select' | 'hand' | 'pen' | 'highlight' | 'eraser'
  | 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'text' | 'figure' | 'solve';

export interface ToolInfo {
  tool: Tool;
  icon: IconName;
  label: string;
  key: string;
}

export const TOOLS: Record<Tool, ToolInfo> = {
  select: { tool: 'select', icon: 'select', label: 'Select', key: 'V' },
  hand: { tool: 'hand', icon: 'hand', label: 'Hand', key: 'G' },
  pen: { tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  highlight: { tool: 'highlight', icon: 'highlight', label: 'Highlighter', key: 'H' },
  eraser: { tool: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  rect: { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
  ellipse: { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  diamond: { tool: 'diamond', icon: 'diamond', label: 'Diamond', key: 'D' },
  line: { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
  arrow: { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  text: { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
  figure: { tool: 'figure', icon: 'shapes', label: 'Shapes and diagrams', key: 'F' },
  solve: { tool: 'solve', icon: 'sparkle', label: 'Solve', key: 'S' },
};

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  Object.values(TOOLS).map((t) => [t.key.toLowerCase(), t.tool]),
);

export const DRAWING_TOOLS: Tool[] = ['pen', 'highlight', 'rect', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'figure'];
