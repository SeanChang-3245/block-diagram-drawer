import { renderToStaticMarkup } from 'react-dom/server';
import { FONT_FAMILY } from '../model/presets';
import { shapeBounds, unionRects } from '../model/geometry';
import type { Doc } from '../model/types';
import { ArrowMarkers, JunctionDots, ShapeView } from '../render/ShapeView';

export const FORMAT_VERSION = '1';
const MARGIN = 20;

/** Serialize the document as a standalone SVG that also carries the editable model. */
export const exportSvg = (doc: Doc): string => {
  const shapes = doc.order.map((id) => doc.shapes[id]).filter(Boolean);
  // Pad for arrowheads and bus labels that sit outside the geometric bounds.
  const b = unionRects(shapes.map(shapeBounds)) ?? { x: 0, y: 0, w: 400, h: 300 };
  const x = Math.floor(b.x - MARGIN), y = Math.floor(b.y - MARGIN);
  const w = Math.ceil(b.w + 2 * MARGIN), h = Math.ceil(b.h + 2 * MARGIN);
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={h}
      viewBox={`${x} ${y} ${w} ${h}`}
      fontFamily={FONT_FAMILY}
      data-bdd-version={FORMAT_VERSION}
    >
      <ArrowMarkers doc={doc} />
      <rect data-bdd-bg="" x={x} y={y} width={w} height={h} fill="#ffffff" />
      {shapes.map((s) => (
        <ShapeView key={s.id} s={s} embedModel />
      ))}
      <JunctionDots doc={doc} />
    </svg>,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup.replace(/(<\/g>|<\/defs>|<rect data-bdd-bg[^>]*\/>)</g, '$1\n<')}\n`;
};

/** Rasterize the exported SVG to a PNG blob. */
export const exportPng = async (doc: Doc, scale = 2): Promise<Blob> => {
  const svg = exportSvg(doc);
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  const w = Number(m?.[1] ?? 800), h = Number(m?.[2] ?? 600);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
};
