# Block Diagram Drawer

A focused SVG editor for **hardware block diagrams**: boxes, wires, buses and labels,
driven by layout-editor style hotkeys. The file you save *is* an `.svg`, so it drops
straight into slides, papers and Markdown, and it reopens with every shape still editable.

Any other SVG works too: open a diagram an AI drew and it is converted into editable
boxes, wires, junction dots and labels, so you can fine-tune it by hand.

## Features

- **Boxes**: fill, border color, solid / dashed / dotted border, corner radius, multi-line centred text.
- **Wires**: orthogonal routing, color, solid / dashed / dotted, arrowheads at either end.
- **Buses**: a wire with the classic slash-and-number width mark (`/ 32`).
- **Line style presets** on keys `1` `2` `3`: datapath (black solid), control (grey dashed), exception (red dashed).
- **Hardware macros** (`I`): MUX with any number of inputs (not only powers of two), ALU, register / flip-flop
  (clock triangle, optional enable and reset), operator node (`+ − × ⊕ & | =`), pipeline register. Any flow direction,
  `Shift+R` rotates. Default sizes and stretch steps keep every port on the grid.
- **Ports**: wires snap to macro pins and meet them head-on; attached wires follow when a macro moves, is stretched,
  rotated or gains inputs. T-junction dots are added automatically.
- **Wire labels**: signal names that ride along the wire; drag a label to slide it.
- **Stacking order**: bring forward / send backward / to front / to back.
- **Stretch** (`S`) like a layout editor: drag a box edge or corner to resize, a wire segment to slide it, a vertex to move it,
  or drag a box around several edges and vertices to stretch them together. Wires whose ends touch a moving edge follow it.
- **Import any SVG** (e.g. one an AI drew) and get an editable diagram back:
  - `rect` becomes a box (centred text inside becomes its label), `line` / `polyline` / open paths become wires;
  - trapezoids become **MUXes**, with the input count and pin positions read from the wires (and constant labels like
    `0`) that enter them, so a 6-input MUX comes back as a 6-input MUX; notched trapezoids become **ALUs**;
    circles holding `+ × ⊕ …` become operator nodes;
  - wire ends touching those pins are attached, so moving or stretching the MUX drags its wires along;
  - signal names written next to a wire become that wire's label; a MUX's caption is grouped with it;
  - junction dots become automatic ones; `translate()` groups are seen through.
  Anything else is kept verbatim and can still be moved.
- Grid snapping, undo / redo, grouping, copy / paste, PNG export, drag-and-drop open, crash-recovery autosave.
- Runs entirely in your browser: no server, your diagrams never leave your machine.

## Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `R` | Rectangle box | `M` | Move |
| `W` | Wire | `C` | Copy |
| `B` | Bus | `S` | Stretch |
| `L` | Text label | `Q` | Toggle properties panel |
| `I` | Place macro (then `M` `A` `R` `O` `P`) | `F` | Fit diagram |
| `Esc` | Cancel step / exit command | `Z` | Zoom into an area (drag a box) |
| `Shift+R` | Rotate macro 90° | `Shift+Z` | Zoom out 2× |
| `Ctrl+]` / `Ctrl+[` | Bring forward / send backward | `Ctrl+Shift+]` / `[` | To front / to back |
| `Del` | Delete | `U` / `Shift+U` | Undo / redo |
| `1` `2` `3` | Line style preset | `G` | Toggle grid |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / ungroup | `Ctrl+S` / `Ctrl+O` | Save / open |
| `Ctrl+C` / `Ctrl+V` | Copy / paste | `Ctrl+E` | Export PNG |

While routing a wire: click to add points, `Space` flips the bend, double-click / `Enter` / right-click finishes.
Holding `Shift` during move, copy or stretch locks the motion to one axis. Press `?` in the app for the full sheet.

Commands work like a layout editor: they stay armed until `Esc`, and both *click, move, click* and *press, drag, release* work.
Area zoom (`Z`, as in Virtuoso) can be used in the middle of another command, e.g. while routing a wire.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (geometry, stretch, SVG import/export)
npm run build    # production build in dist/
```

Stack: Vite, React, TypeScript, zustand. Shapes are rendered by the same React components on the
canvas and in the exporter, so what you see is what gets saved.

```
src/model/   document model, geometry, move / stretch engine, style presets
src/io/      SVG export, SVG import (native + heuristic), file open / save
src/render/  shape rendering shared by canvas and exporter
src/tools/   tool state machine (rect, wire, bus, move, copy, stretch, ...)
src/ui/      canvas, toolbars, properties panel, shortcuts
```

### Saved file format

Every shape is written as a normal, visible SVG group, tagged with its model:

```xml
<g data-bdd="wire" data-bdd-json='{"type":"wire","points":[...],"busWidth":32,...}'>
  <polyline points="..." stroke="#000" marker-end="url(#bdd-arrow-000000)"/>
  ...
</g>
```

Viewers ignore the `data-*` attributes; this app reads them back for an exact round trip.

## Deployment

Pushing to `main` builds and publishes the site with GitHub Actions
(`.github/workflows/deploy.yml`). One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Roadmap

1. ~~Basic editing: boxes, wires, styles, hotkeys, stretch, SVG save / open~~
2. ~~Hardware macros: MUX with any number of inputs, ALU, register / flip-flop, adder; ports that wires snap to; wire labels~~
3. ~~Smarter import: recognise MUX / ALU shapes in AI-drawn SVGs~~
4. Published format spec for AI tools, PDF export, user-defined macros

## License

MIT
