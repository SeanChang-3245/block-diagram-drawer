// Core document model. Every shape lives in world coordinates (SVG user units).

export interface Pt {
  x: number;
  y: number;
}

export type Dash = 'solid' | 'dashed' | 'dotted';

export interface Stroke {
  color: string;
  width: number;
  dash: Dash;
}

interface ShapeBase {
  id: string;
  /** Shapes sharing a groupId are selected and moved together. */
  groupId?: string;
}

export interface BoxShape extends ShapeBase {
  type: 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: Stroke;
  radius: number;
  /** Multi-line label, centered in the box. */
  text: string;
  fontSize: number;
  textColor: string;
  boldFirstLine: boolean;
}

export interface WireShape extends ShapeBase {
  type: 'wire';
  points: Pt[];
  stroke: Stroke;
  arrowStart: boolean;
  arrowEnd: boolean;
  /** Bus width in bits; drawn as a slash plus number when > 1. */
  busWidth: number;
  /** Signal name drawn along the wire. */
  label?: string;
  /** Where the label sits, as a fraction (0..1) of the wire's length. */
  labelPos?: number;
  /** Macro ports the endpoints are attached to; they follow the macro. */
  from?: PortRef;
  to?: PortRef;
}

export interface PortRef {
  id: string;
  port: string;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export interface TextShape extends ShapeBase {
  type: 'text';
  x: number;
  /** Baseline y, as in SVG <text>. */
  y: number;
  text: string;
  fontSize: number;
  color: string;
  anchor: TextAnchor;
  bold: boolean;
}

/** Junction dot where wires branch. */
export interface DotShape extends ShapeBase {
  type: 'dot';
  x: number;
  y: number;
  r: number;
  color: string;
}

export type MacroKind = 'mux' | 'alu' | 'reg' | 'op';

/** Direction signals flow through a macro: inputs on the upstream side. */
export type Direction = 'right' | 'left' | 'down' | 'up';

/** Parameterised hardware symbol. Parameters a kind does not use are ignored. */
export interface MacroShape extends ShapeBase {
  type: 'macro';
  kind: MacroKind;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: Direction;
  fill: string;
  stroke: Stroke;
  label: string;
  fontSize: number;
  textColor: string;
  /** mux: number of data inputs (any integer >= 2). */
  inputs: number;
  /** mux select / alu op port: on the top or bottom side (relative to flow). */
  ctrlSide: 'top' | 'bottom';
  /** mux: print 0..N-1 next to the inputs. */
  showIndices: boolean;
  /** reg: optional enable / reset pins. */
  enable: boolean;
  reset: boolean;
  /** op: symbol drawn in the circle (+, ×, ⊕, ...). */
  symbol: string;
}

/** Imported SVG markup we don't understand; kept verbatim and movable. */
export interface RawShape extends ShapeBase {
  type: 'raw';
  markup: string;
  dx: number;
  dy: number;
  /** Bounding box of the markup before the dx/dy offset. */
  bbox: { x: number; y: number; w: number; h: number };
}

export type Shape = BoxShape | WireShape | TextShape | DotShape | RawShape | MacroShape;
export type ShapeType = Shape['type'];

export interface Doc {
  shapes: Record<string, Shape>;
  /** Z-order, bottom first. */
  order: string[];
}

export const emptyDoc = (): Doc => ({ shapes: {}, order: [] });

let counter = 0;
export const newId = (prefix = 's'): string =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
