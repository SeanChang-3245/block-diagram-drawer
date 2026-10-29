import { useStore } from '../store';
import { shapeBounds, unionRects } from '../model/geometry';
import { zoomAt } from './Canvas';
import { cursorWorld } from '../tools/interaction';

const FIT_PAD = 40;

export const fitView = () => {
  const { doc, canvasSize, setView } = useStore.getState();
  const b = unionRects(doc.order.map((id) => shapeBounds(doc.shapes[id])));
  if (!b) return setView({ x: -40, y: -40, zoom: 1 });
  const zoom = Math.min(4, (canvasSize.w - 2 * FIT_PAD) / Math.max(b.w, 1), (canvasSize.h - 2 * FIT_PAD) / Math.max(b.h, 1));
  setView({ zoom, x: b.x + b.w / 2 - canvasSize.w / 2 / zoom, y: b.y + b.h / 2 - canvasSize.h / 2 / zoom });
};

/** Zoom around the last cursor position (or the canvas centre if it is off-screen). */
export const zoomBy = (factor: number) => {
  const { view, canvasSize, setView } = useStore.getState();
  const c = cursorWorld();
  let sx = (c.x - view.x) * view.zoom, sy = (c.y - view.y) * view.zoom;
  if (sx < 0 || sy < 0 || sx > canvasSize.w || sy > canvasSize.h) {
    sx = canvasSize.w / 2;
    sy = canvasSize.h / 2;
  }
  setView(zoomAt(view, sx, sy, factor));
};

export const panBy = (dxScreen: number, dyScreen: number) => {
  const { view, setView } = useStore.getState();
  setView({ ...view, x: view.x + dxScreen / view.zoom, y: view.y + dyScreen / view.zoom });
};
