// The prompt handed to an AI so the SVG it draws opens fully editable.
// test/aiFormat.test.ts imports the example below, so it must stay valid.

export const AI_EXAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 290">
  <g data-bdd-json='{"type":"macro","kind":"reg","id":"pc","x":40,"y":100,"label":"PC"}'/>
  <g data-bdd-json='{"type":"macro","kind":"op","id":"inc","x":180,"y":110,"symbol":"+","ctrlSide":"bottom"}'/>
  <g data-bdd-json='{"type":"box","id":"four","x":180,"y":180,"w":40,"h":20,"text":"4"}'/>
  <g data-bdd-json='{"type":"macro","kind":"mux","id":"nextpc","x":300,"y":120,"inputs":3,"showIndices":true}'/>
  <g data-bdd-json='{"type":"macro","kind":"alu","id":"alu","x":400,"y":120,"label":"ALU"}'/>
  <g data-bdd-json='{"type":"wire","from":{"id":"pc","port":"q"},"to":{"id":"inc","port":"a"},"label":"pc"}'/>
  <g data-bdd-json='{"type":"wire","points":[{"x":200,"y":180},{"x":200,"y":160}],"to":{"id":"inc","port":"b"}}'/>
  <g data-bdd-json='{"type":"wire","from":{"id":"inc","port":"out"},"to":{"id":"nextpc","port":"in0"},"busWidth":32}'/>
  <g data-bdd-json='{"type":"wire","from":{"id":"nextpc","port":"out"},"to":{"id":"alu","port":"a"}}'/>
  <g data-bdd-json='{"type":"wire","points":[{"x":310,"y":60},{"x":310,"y":90}],"to":{"id":"nextpc","port":"sel"},"stroke":{"color":"#555555","dash":"dashed"},"label":"pc_sel"}'/>
  <g data-bdd-json='{"type":"text","x":40,"y":270,"text":"Next-PC logic","fontSize":12,"bold":true}'/>
</svg>`;

export const AI_PROMPT = `Draw the block diagram as an SVG file for "Block Diagram Drawer". Follow this format exactly so every part stays editable.

FORMAT
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="...">.
- Every shape is one element <g data-bdd-json='{...}'/> whose attribute holds a JSON object. Put the JSON in single quotes; escape ' as &apos; and & as &amp; inside it. Visible SVG inside the <g> is optional: the editor draws everything from the JSON.
- Coordinates are SVG user units, y grows downward. Use multiples of 10 so things line up on the grid.
- Each shape needs "type" plus the fields shown in its first example below; anything else left out gets a sensible default.
- Give shapes you connect wires to a short unique "id".
- Not sure where things should go? Leave out "x" and "y" of every box and macro and connect them with "from"/"to" wires: the editor then places the blocks itself (signals flowing left to right) and routes the wires. Tall thin boxes (e.g. w 20, h 300) act as pipeline registers and split the stages into columns.

SHAPES
1. Box: {"type":"box","id":"rf","x":..,"y":..,"w":..,"h":..,"text":"Register File\\n2R1W"}
   optional: "fill" (default "#ffffff", or "none"), "stroke":{"color":"#000000","width":1.5,"dash":"solid"|"dashed"|"dotted"}, "radius", "fontSize" (11), "textColor", "boldFirstLine" (true).
   Text is centred; "\\n" starts a new line.
2. Macro: {"type":"macro","kind":K,"id":..,"x":..,"y":..} where x,y is the top-left corner.
   kinds and their pins (pin names are used by wires):
   - "mux": "inputs":N (any N >= 2, default 2). Pins in0..in{N-1}, out, sel. Default size 20 wide x 20*N tall.
     optional "showIndices":true prints 0..N-1, "ctrlSide":"top"|"bottom" puts sel on that side.
   - "alu": pins a, b, out, op. Default 60 x 120. optional "label" (e.g. "ALU").
   - "reg": register / flip-flop. Pins d, q, clk, plus en with "enable":true and rst with "reset":true. Default 60 x 60. optional "label".
   - "op": operator circle, "symbol" one of + − × ⊕ & | =. Pins a (left), b (top; "ctrlSide":"bottom" moves it to the bottom), out. Default 40 x 40.
   optional for all macros: "dir":"right"|"left"|"down"|"up" (signal flow, default "right": inputs on the left), "w","h", "fill", "stroke", "label", "fontSize".
3. Wire: {"type":"wire", "from":{"id":"pc","port":"q"}, "to":{"id":"alu","port":"a"}}
   - With "from" and "to" pins, leave out "points": the editor routes the wire with horizontal/vertical segments.
   - Otherwise give "points":[{"x":..,"y":..},...] (at least 2, preferably only horizontal and vertical segments). You may combine points with "from"/"to"; the matching end snaps onto the pin.
   optional: "stroke" (see Box; datapath = black solid, control = {"color":"#555555","dash":"dashed"}, exception = {"color":"#b03030","dash":"dashed"}),
   "arrowEnd" (default true), "arrowStart" (false), "busWidth" (bits, draws the "/ 32" mark when > 1), "label" (signal name drawn along the wire), "labelPos" (0..1 along the wire, default 0.25).
4. Text label: {"type":"text","x":..,"y":..,"text":"..."} (y is the baseline). optional "fontSize" (10), "color", "anchor":"start"|"middle"|"end", "bold".
5. Junction dot: {"type":"dot","x":..,"y":..}. Usually unnecessary: a dot is drawn automatically where a wire ends on the middle of another wire.

RULES
- Use macros for muxes, ALUs, registers and adders instead of drawing them with paths.
- Connect wires to macro pins with "from"/"to" whenever a wire starts or ends at a macro.
- A wire that branches: start the branch wire exactly on a point of the trunk wire (a dot appears there).
- Output only the SVG.

EXAMPLE
${AI_EXAMPLE}
`;
