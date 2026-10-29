import type { BoxShape, Stroke, TextShape, WireShape } from './types';

export interface LinePreset {
  key: string;
  name: string;
  stroke: Stroke;
}

/** Line style presets, selectable with keys 1-3. */
export const LINE_PRESETS: LinePreset[] = [
  { key: '1', name: 'Datapath', stroke: { color: '#000000', width: 1.4, dash: 'solid' } },
  { key: '2', name: 'Control', stroke: { color: '#555555', width: 1.4, dash: 'dashed' } },
  { key: '3', name: 'Exception', stroke: { color: '#b03030', width: 1.4, dash: 'dashed' } },
];

export const DASH_ARRAY: Record<Stroke['dash'], string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1.5 3',
};

export const GRID = 10;

export const FONT_FAMILY = 'Helvetica, Arial, sans-serif';

export const defaultBox = (): Omit<BoxShape, 'id' | 'x' | 'y' | 'w' | 'h'> => ({
  type: 'box',
  fill: '#ffffff',
  stroke: { color: '#000000', width: 1.5, dash: 'solid' },
  radius: 0,
  text: '',
  fontSize: 11,
  textColor: '#000000',
  boldFirstLine: true,
});

export const defaultWire = (): Omit<WireShape, 'id' | 'points'> => ({
  type: 'wire',
  stroke: { ...LINE_PRESETS[0].stroke },
  arrowStart: false,
  arrowEnd: true,
  busWidth: 1,
});

export const defaultText = (): Omit<TextShape, 'id' | 'x' | 'y' | 'text'> => ({
  type: 'text',
  fontSize: 10,
  color: '#000000',
  anchor: 'start',
  bold: false,
});
