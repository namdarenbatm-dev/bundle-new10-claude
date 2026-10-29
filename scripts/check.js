'use strict';
// Static build checks: JSON validity, referenced files exist, SW precache list is complete, icon sizes, relative paths.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failures++; console.log('  FAIL ' + m); };
const exists = (p) => fs.existsSync(path.join(root, p));

// required files
['index.html', 'manifest.json', 'sw.js', 'README.md', 'css/styles.css', 'js/core.js', 'js/app.js', 'assets/logo.png', 'assets/Yekan.ttf']
  .forEach((f) => (exists(f) ? ok('exists ' + f) : bad('missing ' + f)));

// manifest
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); ok('manifest.json is valid JSON'); }
catch (e) { bad('manifest.json invalid: ' + e.message); manifest = { icons: [] }; }
['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'background_color'].forEach((k) => (manifest[k] ? ok('manifest.' + k) : bad('manifest.' + k + ' missing')));
['start_url', 'scope'].forEach((k) => (manifest[k] && !manifest[k].startsWith('/') && !/^https?:/.test(manifest[k]) ? ok('manifest.' + k + ' is relative (' + manifest[k] + ')') : bad('manifest.' + k + ' must be relative for GitHub Pages sub-paths')));

function pngSize(file) {
  const b = fs.readFileSync(path.join(root, file));
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
(manifest.icons || []).forEach((i) => {
  if (!exists(i.src)) return bad('manifest icon missing ' + i.src);
  const sz = pngSize(i.src);
  const want = i.sizes.split('x').map(Number);
  sz && sz[0] === want[0] && sz[1] === want[1] ? ok('icon ' + i.src + ' is ' + i.sizes + ' (' + i.purpose + ')') : bad('icon size mismatch ' + i.src + ' ' + sz);
});
const purposes = (manifest.icons || []).map((i) => i.purpose + i.sizes).join(' ');
['any192x192', 'any512x512', 'maskable512x512'].forEach((p) => (purposes.includes(p) ? ok('manifest has ' + p) : bad('manifest lacks ' + p)));

// index.html local references
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
refs.forEach((r) => {
  if (/^(https?:)?\/\//.test(r)) return bad('external dependency in index.html: ' + r);
  if (r.startsWith('/')) return bad('root-absolute path breaks GitHub Pages sub-paths: ' + r);
  exists(r) ? ok('index.html -> ' + r) : bad('index.html references missing ' + r);
});
/<html[^>]*lang="fa"[^>]*dir="rtl"/.test(html) ? ok('html lang=fa dir=rtl') : bad('html lang/dir');

// CSS url() references
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
[...css.matchAll(/url\("?([^")]+)"?\)/g)].forEach((m) => {
  const p = path.posix.normalize(path.posix.join('css', m[1]));
  exists(p) ? ok('css -> ' + p) : bad('css references missing ' + p);
});
/https?:\/\//.test(css) ? bad('external URL in CSS') : ok('CSS has no external URLs');
/https?:\/\/(?!www\.w3\.org)/.test(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8')) ? bad('external URL in app.js') : ok('app.js has no external URLs');

// service worker precache list
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!list) bad('PRECACHE not found');
else {
  const items = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  items.forEach((p) => {
    if (p.startsWith('/')) return bad('SW precache uses absolute path ' + p);
    const f = p === './' ? 'index.html' : p.replace(/^\.\//, '');
    exists(f) ? ok('precache ' + p) : bad('precache missing file ' + p);
  });
  ['./index.html', './manifest.json', './css/styles.css', './js/core.js', './js/app.js', './assets/logo.png', './assets/Yekan.ttf']
    .forEach((p) => (items.includes(p) ? ok('precache includes ' + p) : bad('precache lacks ' + p)));
  (manifest.icons || []).forEach((i) => (items.includes('./' + i.src) ? ok('precache includes icon ' + i.src) : bad('precache lacks icon ' + i.src)));
}
/CACHE_VERSION\s*=\s*'v10/.test(sw) ? ok('SW cache is versioned') : bad('SW cache version missing');

// syntax check of JS files
['sw.js', 'js/core.js', 'js/app.js'].forEach((f) => {
  try { new Function(fs.readFileSync(path.join(root, f), 'utf8')); ok('syntax ' + f); } catch (e) { bad('syntax ' + f + ': ' + e.message); }
});

console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nAll static checks passed');
process.exit(failures ? 1 : 0);
