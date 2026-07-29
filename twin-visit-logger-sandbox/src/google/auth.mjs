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
  return client;
}
