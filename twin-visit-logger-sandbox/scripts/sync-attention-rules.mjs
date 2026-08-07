/**
 * Copy the work-queue rules out of apps-script/ChatNotify.gs into src/rei/attention-rules.mjs.
 *
 *   node scripts/sync-attention-rules.mjs
 *
 * Run this after editing the bucket rules. tests/rei-buckets fails if the two are ever out of step, so a
 * forgotten sync is caught by a test rather than by a lead silently dropping off the hourly sweep.
 *
 * The rules are copied, never rewritten. A hand-translation into Node would be a second definition that
 * drifts — which is exactly what produced "Upcoming Visit: 0" on a preview that was meant to be identical
 * to the card.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const GS = path.resolve('../apps-script/ChatNotify.gs');
const TARGET = path.resolve('./src/rei/attention-rules.mjs');
const START = 'var DIGEST_LINES_PER_SECTION';
const END = '/**\n * Post the 3pm work queue';
const MARK = '/* ====== VERBATIM FROM apps-script/ChatNotify.gs — do not edit here ====== */\n';
const END_MARK = '\n/* ====== END VERBATIM ====== */';

const chat = await fs.readFile(GS, 'utf8').catch(() => null);
if (!chat) {
  console.log(`Could not read ${GS}.`);
  console.log('This script only runs in the full repo, where apps-script/ sits beside the sandbox.');
  process.exit(1);
}

const rules = chat.slice(chat.indexOf(START), chat.indexOf(END));
const current = await fs.readFile(TARGET, 'utf8');
const head = current.slice(0, current.indexOf(MARK) + MARK.length);
const tail = current.slice(current.indexOf(END_MARK));

const next = head + rules + tail;
if (next === current) {
  console.log('Already in step — nothing to do.');
} else {
  await fs.writeFile(TARGET, next, 'utf8');
  console.log(`Updated ${TARGET} from ChatNotify.gs.`);
}
