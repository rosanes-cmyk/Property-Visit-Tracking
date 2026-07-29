import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config } from '../src/config.mjs';
import { launchReiContext } from '../src/rei/browser.mjs';

const context = await launchReiContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());
await page.goto(config.reiLoginUrl, { waitUntil: 'domcontentloaded' });
console.log('Log into REI BlackBook in the opened sandbox browser. Complete MFA if requested.');
const rl = readline.createInterface({ input, output });
await rl.question('After the REI dashboard is fully open, press Enter here to save the persistent session...');
rl.close();
await context.close();
console.log('REI sandbox profile saved. Do not commit browser-data/.');
