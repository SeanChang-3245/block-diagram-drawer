// Regenerates FORMAT.md from the prompt in src/io/aiFormat.ts: npm run gen:format
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AI_PROMPT } from '../src/io/aiFormat';

const md = `# Diagram format for AI tools

Hand the prompt below to an AI (ChatGPT, Claude, Gemini, ...) followed by a description of the circuit.
The SVG it returns opens in Block Diagram Drawer with every box, macro and wire editable and every wire
already attached to its pins. The same text is available in the app under **AI prompt**, with a copy button.

Files saved by the app use this format too: each shape is a \`<g data-bdd-json='...'>\` carrying its full
model, plus ordinary SVG inside it so any viewer shows the drawing. When reading, only \`type\` and a few
essential fields must be present; missing fields get defaults, wires given as \`from\` / \`to\` pins are routed
automatically, and malformed entries are skipped.

SVGs that ignore the format still import: rectangles, lines, text, trapezoids (MUX), notched trapezoids (ALU)
and circles with an operator symbol are recognised by their shape.

## The prompt

\`\`\`\`text
${AI_PROMPT.trim()}
\`\`\`\`
`;

writeFileSync(resolve(import.meta.dirname ?? __dirname, '../FORMAT.md'), md);
console.log('FORMAT.md updated');
