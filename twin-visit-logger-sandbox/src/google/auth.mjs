import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import { config } from '../config.mjs';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar'
];

async function loadSavedCredentials() {
  try {
    const content = await fs.readFile(config.googleTokenPath, 'utf8');
    return google.auth.fromJSON(JSON.parse(content));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(config.googleCredentialsPath, 'utf8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  if (!key) throw new Error('Google credentials JSON must contain an installed or web OAuth client.');
  if (!client.credentials.refresh_token) {
    throw new Error('Google authorization did not return a refresh token. Remove token.json and authorize again.');
  }
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token
  });
  await fs.mkdir(path.dirname(config.googleTokenPath), { recursive: true });
  await fs.writeFile(config.googleTokenPath, payload, { mode: 0o600 });
}

export async function authorizeGoogle({ forceInteractive = false } = {}) {
  if (!forceInteractive) {
    const saved = await loadSavedCredentials();
    if (saved) return saved;
  }

  const client = await authenticate({
    scopes: GOOGLE_SCOPES,
    keyfilePath: config.googleCredentialsPath
  });
  await saveCredentials(client);
  /*
   * Return the client REBUILT FROM THE SAVED TOKEN, not the one local-auth just handed back.
   *
   * This looks like pointless indirection and is a real bug fix. `@google-cloud/local-auth` depends on
   * `google-auth-library` separately from `googleapis`, and when npm resolves them to different versions the
   * two get separate copies of the class. `google.sheets({ auth })` then does not recognise local-auth's
   * client as an auth client at all — so it silently makes the request UNAUTHENTICATED and Google answers:
   *
   *   Method doesn't allow unregistered callers (callers without established identity).
   *
   * Which reads exactly like a permissions problem and is not one. It cost an hour of a live recovery on a
   * replacement PC: the old machine's node_modules had been installed months earlier with a combination that
   * happened to dedupe, and every dependency in this project is pinned to "latest", so a fresh install got
   * today's versions and behaved differently. The symptom was bizarre — first run failed, second run worked —
   * because the second run goes through loadSavedCredentials, which uses googleapis' OWN google.auth.fromJSON.
   *
   * Routing the first run through the same path makes both identical, and makes this immune to however npm
   * chooses to arrange those two packages in future.
   */
  const rebuilt = await loadSavedCredentials();
  return rebuilt || client;
}
