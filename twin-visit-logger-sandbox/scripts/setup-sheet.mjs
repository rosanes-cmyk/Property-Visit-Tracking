import { authorizeGoogle } from '../src/google/auth.mjs';
import { ensureTrackerHeaders } from '../src/google/sheets.mjs';

const auth = await authorizeGoogle();
const result = await ensureTrackerHeaders(auth);
console.log(`Tracker headers ready. ${result.headers.length} columns detected.`);
