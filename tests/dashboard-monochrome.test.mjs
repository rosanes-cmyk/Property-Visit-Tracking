/**
 * The board is black and white, and the theme can be switched.
 *
 *   node tests/dashboard-monochrome.test.mjs
 *
 * WHY THIS EXISTS. The client, twice: "dont to much color okay", and on seeing the board,
 * "its not like professional and business". They were right — a saturated blue button on every row, a
 * different hue of avatar per owner and eight coloured chips across the top meant nothing could stand
 * out, because everything was already shouting.
 *
 * The fix is a TOKEN layer, not a rewrite: every rule in the stylesheet takes its colour from a custom
 * property, so redefining about twenty of them turns the whole page monochrome without touching a single
 * component rule. That is also what makes it reversible.
 *
 * What this file guards is the part that is easy to undo by accident: a colour written straight into a
 * rule or a style attribute, where no token can reach it. Three were found that way — the avatar hue, and
 * two `color:#fff` declarations that became white-on-white the moment --brand stopped being blue.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
const RAW = fs.readFileSync(path.resolve('apps-script/Dashboard.html'), 'utf8');
const CSS = (RAW.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1]
  .replace(/\/\*[\s\S]*?\*\//g, '');
const JS = (RAW.match(/<script>([\s\S]*)<\/script>/) || ['', ''])[1]
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== nothing on the page carries a hue ===');
/*
 * Every hex must be a grey: r === g === b. A six-digit hex that is not grey is a colour somebody put
 * back, and on a monochrome page it will be the only coloured thing on screen.
 *
 * The FIRST :root block is skipped, and deliberately. It still holds the original blue/green/amber
 * palette, superseded by the monochrome block that follows it — keeping it is what makes this change one
 * deletion away from reversible. Those values never reach the screen, so scanning them only produces a
 * failure that cannot be fixed without throwing away the way back.
 */
const LIVE_CSS = CSS.replace(/:root\{[\s\S]*?\}/, '');
const hexes = [...new Set((LIVE_CSS.match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toLowerCase()))];
/*
 * NEAR-grey, not identical channels. The palette is a fraction cool on purpose — a pure mid-grey reads as
 * unconsidered, a grey carrying a trace of blue reads as chosen. #0b0b0c is a grey; #3b82f6 is a colour,
 * and the gap between them is enormous, so a tolerance of 8/255 separates them with room to spare.
 */
const spread = (h) => {
  const c = [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map((x) => parseInt(x, 16));
  return Math.max.apply(null, c) - Math.min.apply(null, c);
};
const coloured = hexes.filter((h) => spread(h) > 8);
check('every hex colour in the stylesheet is a grey', coloured, []);
check('...and there are some, so the check is not vacuous', hexes.length > 10, true);

/*
 * hsl() with a saturation above zero is the same problem wearing a different notation — and it is how the
 * avatar hues were written, in a style attribute the stylesheet could never override.
 */
const hsl = (CSS + JS).match(/hsl\(\s*\d+[^)]*\)/g) || [];
check('no hsl() colour is used anywhere', hsl, []);
check('the avatar hue table is gone', /AV_HUES\s*=/.test(JS), false);

console.log('\n=== contrast survives the palette change ===');
/*
 * `color:#fff` on a blue button is fine. On a white button it is invisible — which is exactly what
 * happened to the row action buttons and the report counters when --brand became white. --on-brand is the
 * token that exists for this and flips with the theme.
 */
check('no rule hardcodes white text', /color:\s*#fff(f{3})?\b/i.test(CSS), false);
check('the primary row button takes its text colour from a token',
  /\.go\{background:var\(--accent\);color:var\(--on-brand\)/.test(CSS), true);

console.log('\n=== both themes are fully defined ===');
/*
 * A token defined only inside a media query or a [data-theme] block is the classic unreadable-page bug:
 * most viewers have no data-theme attribute at all.
 */
for (const token of ['--bg', '--ink', '--brand', '--on-brand', '--crit', '--warn', '--good']) {
  check(`${token} is defined for the light theme`,
    new RegExp(`\\[data-theme="light"\\][^}]*${token}:`, 's').test(CSS), true);
}
check('the dark palette is the default on bare :root', /:root\{[^}]*--bg:#0B0B0C/s.test(CSS), true);
check('a light device preference is honoured when nothing is chosen',
  /@media \(prefers-color-scheme:light\)/.test(CSS), true);
check('...and an explicit dark choice still overrides that',
  /:root:not\(\[data-theme="dark"\]\)/.test(CSS), true);

console.log('\n=== severity still reads without colour ===');
/*
 * The point of the ramp: good/warn/crit must not collapse into one value, or urgency stops being visible
 * at all. They are greys at different distances from the background instead of three hues.
 */
const dark = (CSS.match(/:root\{[\s\S]*?\}/) || [''])[0];
const ramp = ['--crit', '--warn', '--good'].map((t) => (dark.match(new RegExp(t + ':(#[0-9a-fA-F]{6})')) || [])[1]);
check('crit, warn and good are three distinct tones', new Set(ramp).size, 3);

console.log('\n=== the switch works and survives a locked-down browser ===');
check('a theme choice is remembered', /localStorage\.setItem\('tvl-theme'/.test(JS), true);
/*
 * localStorage throws in a private window or with site data blocked. A theme switch must never be the
 * reason a board fails to load.
 */
const read = JS.match(/try\{saved=localStorage\.getItem\('tvl-theme'\);\}catch\(e\)\{\}/);
check('...and reading it cannot break the page', !!read, true);
check('...nor can writing it', /try\{localStorage\.setItem\('tvl-theme',next\);\}catch\(e\)\{\}/.test(JS), true);
check('the device preference is the default', /prefers-color-scheme: light/.test(JS), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
