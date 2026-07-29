import { authorizeGoogle } from '../src/google/auth.mjs';

await authorizeGoogle({ forceInteractive: true });
console.log('Google authorization completed and token.json was saved locally.');
