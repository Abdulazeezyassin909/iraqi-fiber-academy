import fs from 'fs';

const html = fs.readFileSync('fusion-splicer-machine.html', 'utf8');
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error('no style');

const idSet = new Set();
const idRe = /\bid="([A-Za-z][A-Za-z0-9]*)"/g;
let m;
while ((m = idRe.exec(html)) !== null) idSet.add(m[1]);

function idToClass(id) {
  return '.fsm-' + id.replace(/([A-Z])/g, (ch) => '-' + ch.toLowerCase());
}

let css = styleMatch[1];
css = css.replace(/@import\s+url\([^)]+\)\s*;/g, '');
css = css.replace(/\.lab-fusion-machine \.fusion-splicer-machine 500;700;900[^\n]*\n/g, '');
css = css.replace(/html\.is-lab-embed[\s\S]*?position:\s*absolute;\s*\}/g, '');
css = css.replace(/\* \{ margin: 0; padding: 0; box-sizing: border-box; \}/g, '');
css = css.replace(/body \{[\s\S]*?\}/m, '');
css = css.replace(/\/\*[\s\S]*?\*\//g, '');

const ids = [...idSet].sort((a, b) => b.length - a.length);
for (const id of ids) {
  css = css.replace(new RegExp('#' + id + '\\b', 'g'), idToClass(id));
}
css = css.replace(/:root\b/g, '.fusion-splicer-machine-vars');

const scope = '.lab-fusion-machine .fusion-splicer-machine';

function scopeSelectors(selectorText) {
  return selectorText
    .split(',')
    .map((sel) => {
      sel = sel.trim();
      if (!sel) return '';
      if (sel.startsWith(scope)) return sel;
      if (sel === '.fusion-splicer-machine-vars') return scope;
      return scope + ' ' + sel;
    })
    .filter(Boolean)
    .join(',\n');
}

function transformCss(input) {
  let out = '';
  let i = 0;
  let depth = 0;
  let selectorBuf = '';

  function flushSelector() {
    const trimmed = selectorBuf.trim();
    selectorBuf = '';
    if (!trimmed) return;
    if (trimmed.startsWith('@')) {
      out += trimmed;
      return;
    }
    out += scopeSelectors(trimmed);
  }

  while (i < input.length) {
    const ch = input[i];
    if (ch === '{') {
      flushSelector();
      out += '{';
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      out += '}';
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0) selectorBuf += ch;
    else out += ch;
    i += 1;
  }
  if (selectorBuf.trim()) flushSelector();
  return out;
}

const scopedCss = transformCss(css);

const out =
  '/* Fusion splicer native DOM — scoped under lab wrapper */\n' +
  '@import url("https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&display=swap");\n\n' +
  scope +
  ' {\n' +
  '  box-sizing: border-box;\n' +
  '  font-family: "Share Tech Mono", monospace;\n' +
  '  position: relative;\n' +
  '  width: 100%;\n' +
  '  height: 100%;\n' +
  '}\n\n' +
  scope +
  ' * {\n' +
  '  box-sizing: border-box;\n' +
  '}\n\n' +
  scopedCss +
  '\n\n/* Native z-index stack — shared document with pigtail SVG */\n' +
  scope + ' .fsm-clamp-base,\n' +
  scope + ' .fsm-clamp-base-groove { z-index: 10 !important; }\n' +
  scope + ' .fsm-clamp-lid:not(.is-open) { z-index: 30 !important; }\n' +
  scope + ' .fsm-clamp-lid.is-open { z-index: 8 !important; }\n';

fs.writeFileSync('css/fusion-splicer-machine.css', out);
console.log('ids:', ids.length, 'css chars:', out.length);
