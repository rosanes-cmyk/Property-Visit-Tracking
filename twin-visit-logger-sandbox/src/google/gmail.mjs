import { google } from 'googleapis';
import { simpleParser } from 'mailparser';
import { config } from '../config.mjs';

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function cleanUrl(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/[),.;]+$/g, '')
    .trim();
}

function extractUrls(...parts) {
  const urls = new Set();
  for (const part of parts) {
    if (!part) continue;
    const matches = String(part).match(/https?:\/\/[^\s<>"']+/gi) || [];
    for (const match of matches) urls.add(cleanUrl(match));
  }
  return [...urls];
}

export async function ensureLabel(auth, labelName) {
  const gmail = google.gmail({ version: 'v1', auth });
  const existing = await gmail.users.labels.list({ userId: 'me' });
  const found = existing.data.labels?.find((label) => label.name === labelName);
  if (found?.id) return found.id;

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    }
  });
  return created.data.id;
}

export async function listCandidateMessages(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: config.gmailQuery,
    maxResults: config.maxEmailsPerRun
  });
  return response.data.messages || [];
}

export async function readMessage(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'raw'
  });
  if (!response.data.raw) throw new Error(`Gmail message ${messageId} did not include raw content.`);

  const parsed = await simpleParser(decodeBase64Url(response.data.raw));
  const subject = parsed.subject || '';
  const text = parsed.text || '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const urls = extractUrls(subject, text, html);
  const reiLink = urls.find((url) => url.toLowerCase().includes(config.reiUrlPattern.toLowerCase()));

  return {
    id: messageId,
    threadId: response.data.threadId || '',
    subject,
    text,
    html,
    from: parsed.from?.text || '',
    date: parsed.date?.toISOString() || '',
    urls,
    reiLink: reiLink || ''
  };
}

export async function addLabel(auth, messageId, labelId) {
  if (!labelId) return;
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [labelId] }
  });
}
