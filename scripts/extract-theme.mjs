// Copy the DSH theme token sheet verbatim from the installed theme package
// into ui/prototype/theme.css. The sheet lives inside JS string literals in
// lib/client.js: light aliases on `body`, dark aliases on
// `body[data-ds-dark-theme]`, located by brace-depth backtracking from marker
// tokens; statics/fonts/radii are theme-independent singles collected by
// global match. Refresh: node scripts/extract-theme.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const raw = await readFile(fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js', import.meta.url)), 'utf8');
// Unescape the JS string literals so quotes/backslashes/line-continuations
// become plain CSS text.
const css = raw.replace(/\\(["'])/g, '$1').replace(/\\\n/g, '').replace(/\\\\/g, '\\');

function enclosingRule(marker) {
  const at = css.indexOf(marker);
  if (at === -1) throw new Error(`marker not found: ${marker.slice(0, 60)}`);
  let depth = 0;
  let open = -1;
  for (let i = at; i >= 0; i--) {
    const ch = css[i];
    if (ch === '}') depth++;
    else if (ch === '{') { if (depth === 0) { open = i; break; } depth--; }
  }
  let depth2 = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth2++;
    else if (css[i] === '}') { depth2--; if (depth2 === 0) return css.slice(open, i + 1); }
  }
  throw new Error('unbalanced rule');
}

const declarations = rule => [...new Set(rule.slice(rule.indexOf('{') + 1, -1).split(';').map(d => d.trim()).filter(d => d.startsWith('--dsw')))];
const balanced = list => {
  for (const d of list) {
    if (((d.match(/\(/g) ?? []).length) !== ((d.match(/\)/g) ?? []).length)) throw new Error(`unbalanced decl: ${d.slice(0, 80)}`);
  }
  return list;
};

const dswStatics = [...css.matchAll(/--dsw-(?:static|radius|font|corner)[a-z0-9-]*:[^;{}]+/g)].map(m => m[0]);
const fontFamilyVars = [...css.matchAll(/--(?:dsh|ds)-font-family[a-z0-9-]*:[^;{}]+/g)].map(m => m[0]);
const statics = balanced([...new Set([...dswStatics, ...fontFamilyVars])]);
const light = balanced(declarations(enclosingRule('--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00)')));
const dark = balanced(declarations(enclosingRule('--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-875)')));

const out = `/* Copied verbatim from @deepseek-ai/dsh-client-ui-theme 0.2.1-rc.2 (MIT),
   lib/client.js theme sheet; upstream commit 687f282e8625c6b8d11ff58211a90524be2e4317.
   Extracted by scripts/extract-theme.mjs: statics ${statics.length},
   light aliases ${light.length} (body), dark aliases ${dark.length}
   (body[data-ds-dark-theme], re-mounted on [data-theme=dark] and
   prefers-color-scheme below). */

:root{
${statics.join(';\n')};
}

:root, [data-theme="light"]{
${light.join(';\n')};
}

[data-theme="dark"]{
${dark.join(';\n')};
}

@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
${dark.join(';\n')};
} }
`;
await writeFile(fileURLToPath(new URL('../ui/prototype/theme.css', import.meta.url)), out);
console.log(`theme.css: statics ${statics.length}, light ${light.length}, dark ${dark.length}`);
