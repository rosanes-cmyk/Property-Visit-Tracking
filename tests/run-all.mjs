/**
 * Run every test in this folder.
 *
 *   node tests/run-all.mjs            (from anywhere — cwd is fixed below)
 *   npm test                          (from twin-visit-logger-sandbox)
 *
 * Why this exists, replacing a hand-written chain of 22 `node ../tests/x.test.mjs &&` calls:
 *
 *   IT DID NOT RUN. The chain used '../tests/' paths, so it only made sense with the working directory
 *   set to the sandbox package — but the tests themselves resolve fixtures from the REPO ROOT
 *   (path.resolve('apps-script/Dashboard.html')). Every way of invoking it was wrong for one half or the
 *   other, and `npm test` died on the first file with ENOENT. This runner sets cwd itself, so where it is
 *   launched from stops mattering.
 *
 *   IT WAS INCOMPLETE. 20 of the 42 test files were not in the list, including the menu, dropdown, gift,
 *   stage-map and REI re-check suites. A test nobody runs is not a safety net; it is a file. Globbing the
 *   folder means a new test is picked up by existing it, which is the only way this stays true.
 *
 * Windows matters here: the client runs this from cmd on the office PC, so no shell loops and no globbing
 * by the shell — process.execPath and readdir do the work.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..');

const files = fs.readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (!files.length) {
  console.error('No *.test.mjs files found in ' + TESTS_DIR);
  process.exit(1);
}

const failed = [];
for (const file of files) {
  const res = spawnSync(process.execPath, [path.join(TESTS_DIR, file)], {
    cwd: REPO_ROOT,          // the fixtures every suite reads are repo-root relative
    stdio: 'inherit'
  });
  if (res.status !== 0) failed.push(file);
}

const line = '='.repeat(60);
console.log(`\n${line}`);
console.log(`${files.length - failed.length}/${files.length} test files passed`);
if (failed.length) {
  console.log('\nFAILED:');
  failed.forEach((f) => console.log('  - ' + f));
}
console.log(line);
process.exit(failed.length ? 1 : 0);
