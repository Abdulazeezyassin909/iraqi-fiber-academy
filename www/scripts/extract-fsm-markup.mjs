import fs from 'fs';

const html = fs.readFileSync('fusion-splicer-machine.html', 'utf8');
const bodyMatch = html.match(/<body>([\s\S]*?)<script>/);
if (!bodyMatch) throw new Error('no body');

function idToClass(id) {
  return 'fsm-' + id.replace(/([A-Z])/g, (ch) => '-' + ch.toLowerCase());
}

let body = bodyMatch[1].trim();
body = body.replace(/\s+onclick="[^"]*"/g, '');

// Elements with id only
body = body.replace(
  /<([a-zA-Z][\w-]*)([^>]*?)\bid="([^"]+)"([^>]*)>/g,
  (full, tag, before, id, after) => {
    const fsmClass = idToClass(id);
    const chunk = before + after;
    const classMatch = chunk.match(/\bclass="([^"]*)"/);
    if (classMatch) {
      const merged = (classMatch[1] + ' ' + fsmClass).trim();
      const rest = chunk.replace(/\bclass="[^"]*"/, 'class="' + merged + '"');
      return '<' + tag + rest + '>';
    }
    return '<' + tag + before + after + ' class="' + fsmClass + '">';
  }
);

const wrapped =
  '<div class="fusion-splicer-machine" data-fusion-ui-root="1" role="application" aria-label="Fusion splicer machine">\n' +
  body +
  '\n</div>';

fs.writeFileSync('scripts/fsm-markup-snippet.html', wrapped);
console.log('wrote markup snippet', wrapped.length, 'chars');
