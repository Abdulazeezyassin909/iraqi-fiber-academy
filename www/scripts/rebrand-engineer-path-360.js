/**
 * One-off rebrand: مسار المهندس ‎°360 / Engineer Path °360
 * Skips node_modules and rotation-only canvas files.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const skipDirs = new Set(['node_modules', '.git', 'dist', 'build']);
const skipFiles = new Set(['ftth-lab-canvas.js', 'fusion-splicer-stripper.js', 'rebrand-engineer-path-360.js']);
const exts = new Set(['.html', '.js', '.css', '.json', '.md']);

const AR = 'مسار المهندس ‎°360';
const EN_TITLE = 'Engineer Path °360';
const EN_CAPS = 'ENGINEER PATH °360';

function transform(content) {
  let s = content;

  // --- Arabic (longest first; avoid matching المهندس inside مسار المهندس ‎°360) ---
  s = s.replace(/مهندس المسار 360°/g, AR);
  s = s.replace(/مهندس 360°/g, AR);
  s = s.replace(/(?<!ال)مهندس 360/g, AR);
  s = s.replace(/مسار المسار المهندس ‎°360/g, AR);

  // --- English legacy + current (ordered) ---
  s = s.replace(/360° Path Engineer Admin/g, `${EN_CAPS} Admin`);
  s = s.replace(/ENGINEER 360° Admin/g, `${EN_CAPS} Admin`);
  s = s.replace(/360° Path Engineer Logo/g, `${EN_TITLE} Logo`);
  s = s.replace(/ENGINEER 360° Logo/g, `${EN_TITLE} Logo`);
  s = s.replace(/360° Engineer/g, EN_TITLE);
  s = s.replace(/ENGINEER 360°/g, EN_CAPS);
  s = s.replace(/360° Path Engineer — Engineering Career Path Platform/g, `${EN_CAPS} — Engineering Career Path Platform`);
  s = s.replace(/360° Path Engineer ·/g, `${EN_CAPS} ·`);
  s = s.replace(/360° Path Engineer\|/g, `${EN_TITLE}|`);
  s = s.replace(/\| 360° Path Engineer/g, `| ${EN_TITLE}`);
  s = s.replace(/title="360° Path Engineer"/g, `title="${EN_TITLE}"`);
  s = s.replace(/alt="360° Path Engineer"/g, `alt="${EN_TITLE}"`);
  s = s.replace(/<span class="font-semibold text-sm hidden sm:inline">360° Path Engineer<\/span>/g, `<span class="font-semibold text-sm hidden sm:inline">${EN_CAPS}</span>`);
  s = s.replace(/<span class="admin-sidebar__brand-name">360° Path Engineer<\/span>/g, `<span class="admin-sidebar__brand-name">${EN_CAPS}</span>`);
  s = s.replace(/360° Path Engineer/g, EN_TITLE);

  return s;
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else {
      const ext = path.extname(ent.name);
      if (!exts.has(ext) || skipFiles.has(ent.name)) continue;
      out.push(path.join(dir, ent.name));
    }
  }
}

const files = [];
walk(root, files);
let updated = 0;
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  const n = transform(c);
  if (n !== c) {
    fs.writeFileSync(f, n, 'utf8');
    updated++;
    console.log(path.relative(root, f));
  }
}
console.log('Updated', updated, 'files');
