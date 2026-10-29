import fs from 'fs';

const snippet = fs.readFileSync('scripts/fsm-markup-snippet.html', 'utf8');
const inner = snippet
  .replace(/^<div class="fusion-splicer-machine"[^>]*>\n?/, '')
  .replace(/\n?<\/div>\s*$/, '')
  .trim();

const logic = fs.readFileSync('scripts/fsm-ui-logic.js', 'utf8');

const out =
  '/**\n' +
  ' * FusionSplicerMachineUI — native DOM chassis (migrated from fusion-splicer-machine.html).\n' +
  ' * Markup + scoped controller; one instance per placed lab machine.\n' +
  ' */\n' +
  '(function (global) {\n' +
  "  'use strict';\n\n" +
  '  function assemblyMarkup() {\n' +
  '    return ' + JSON.stringify(inner) + ';\n' +
  '  }\n\n' +
  logic +
  '\n\n  global.FusionSplicerMachineUI = {\n' +
  '    assemblyMarkup: assemblyMarkup,\n' +
  '    mount: mount,\n' +
  '    destroy: destroyInstance,\n' +
  '  };\n' +
  '})(typeof window !== \'undefined\' ? window : this);\n';

fs.writeFileSync('js/FusionSplicerMachineUI.js', out);
console.log('wrote js/FusionSplicerMachineUI.js', out.length);
