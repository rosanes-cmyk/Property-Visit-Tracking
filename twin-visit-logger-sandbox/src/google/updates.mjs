/**
 * Updates, delivered through the client's own Google Drive.
 *
 * WHY DRIVE
 *
 * The client asked for it: "can we have this app auto update button if ther bug or issue in the app and it
 * will get the the update and just installed it."
 *
 * The alternatives were worse. `git pull` needs git installed on every PC plus a token for a private repo —
 * a credential on every machine. A download URL needs somewhere public to host it, and the code is not
 * public. Drive needs neither: the app already holds a Google login, so it can read a folder with no new
 * secret anywhere, and the client can drop a new version in from their phone.
 *
 * WHAT THIS FILE IS ALLOWED TO DO
 *
 * Look, and fetch. It does not install anything — swapping files a running process is executing cannot be
 * done from inside that process on Windows, and more importantly the decision to install is the client's.
 * They asked for a BUTTON, and they were right to: a silent auto-install means a bad version of mine stops
 * their automation overnight with nobody watching.
 *
 * THE THING TO UNDERSTAND BEFORE TOUCHING THIS
 *
 * This is a code-execution path. Whoever can write to that Drive folder can run anything they like on the
 * PC, as the Windows user, with the Google token and the REI session sitting right there. So the folder must
 * be one only the owner can edit — not shared with the team, not "anyone with the link". Nothing in software
 * can compensate for getting that wrong, which is why it is stated here, in the setup notes, and in the
 * docs, rather than assumed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/*
 * The folder is found BY NAME, not by a hard-coded id.
 *
 * An id would have to be baked into the package — and then a package built today could never be pointed at a
 * different folder without a rebuild. A name the client can see in Drive is also something they can recreate
 * themselves if they delete it by accident, which an opaque id is not.
 */
export const UPDATE_FOLDER = 'Twin Visit Logger Updates';

/** Semantic-ish version compare. Returns >0 when a is newer than b. */
export function compareVersions(a, b) {
  const parts = (v) => String(v || '').trim().replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * A package file name carries its version: `TwinVisitLogger-1.4.2.zip`.
 *
 * Deliberately not a manifest file to be read separately. Two files that must agree is one more thing that
 * can disagree — a manifest saying 1.5 next to a zip that is still 1.4 is a mistake with no symptom until
 * somebody wonders why the update did nothing.
 */
export function versionFromName(name) {
  const m = /twinvisitlogger[-_ ]v?(\d+(?:\.\d+)*)\.zip$/i.exec(String(name || '').trim());
  return m ? m[1] : '';
}

/** What version is installed, from package.json. */
export async function installedVersion(root = '.') {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/**
 * Is there a newer package in Drive?
 *
 * Returns { available, version, file, installed } and never throws for the ordinary reasons — no folder, no
 * files, no network. An update CHECK that can fail loudly would end up wired into the dashboard and turn a
 * missing Drive folder into a red banner on a system that is working perfectly.
 */
export async function checkForUpdate(drive, { root = '.' } = {}) {
  const installed = await installedVersion(root);
  try {
    const folders = await drive.files.list({
      q: `name = '${UPDATE_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name)',
      pageSize: 10
    });
    const folder = (folders.data.files || [])[0];
    if (!folder) return { available: false, installed, reason: 'no update folder in Drive' };

    const files = await drive.files.list({
      q: `'${folder.id}' in parents and trashed = false`,
      fields: 'files(id,name,size,modifiedTime,md5Checksum,owners(emailAddress))',
      pageSize: 50
    });
    /*
     * Every candidate is considered and the NEWEST wins — not the most recently modified. Re-uploading an old
     * package (a rollback done by hand, say) would otherwise look like an upgrade and be offered as one.
     */
    const candidates = (files.data.files || [])
      .map((f) => ({ ...f, version: versionFromName(f.name) }))
      .filter((f) => f.version)
      .sort((a, b) => compareVersions(b.version, a.version));

    if (!candidates.length) {
      return { available: false, installed, folderId: folder.id,
        reason: `nothing named like TwinVisitLogger-1.2.3.zip in "${UPDATE_FOLDER}"` };
    }
    const newest = candidates[0];
    if (compareVersions(newest.version, installed) <= 0) {
      return { available: false, installed, latest: newest.version, folderId: folder.id,
        reason: 'already up to date' };
    }
    return {
      available: true, installed, version: newest.version, folderId: folder.id,
      file: { id: newest.id, name: newest.name, size: Number(newest.size || 0),
        md5: newest.md5Checksum || '', modifiedTime: newest.modifiedTime || '' }
    };
  } catch (error) {
    return { available: false, installed, error: error.message };
  }
}

/**
 * Download a package and verify it before anybody is told it is ready.
 *
 * Verified TWICE, for two different failures:
 *
 *   md5 — Drive gives one for the uploaded bytes, so a truncated download is caught. Without it a
 *   half-downloaded zip would be installed and the app would be gone, which is the one outcome an updater
 *   must never produce.
 *
 *   the zip's own end-of-archive signature — because a file can be the right length and still be rubbish, and
 *   because md5Checksum is absent for some Drive files, in which case the size check alone proves very little.
 *
 * Note the ORDER: it downloads to a staging path and only renames into place once both checks pass. A
 * consumer that finds the final path finds a complete file, always.
 */
export async function downloadUpdate(drive, file, { into = './updates' } = {}) {
  await fs.mkdir(into, { recursive: true });
  const staging = path.join(into, `${file.name}.part`);
  const final = path.join(into, file.name);

  const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
  const bytes = Buffer.from(res.data);

  if (file.size && bytes.length !== file.size) {
    throw new Error(`Download is ${bytes.length} bytes, expected ${file.size}. Nothing was installed.`);
  }
  if (file.md5) {
    const got = crypto.createHash('md5').update(bytes).digest('hex');
    if (got !== file.md5) {
      throw new Error('The downloaded file does not match its checksum in Drive. Nothing was installed.');
    }
  }
  /*
   * PK\x05\x06 is the End Of Central Directory record every zip ends with (bar a trailing comment). Its
   * absence means the file is not a complete zip, whatever its length says.
   */
  if (bytes.length < 22 || bytes.lastIndexOf(Buffer.from('PK\x05\x06')) < 0) {
    throw new Error('The downloaded file is not a complete zip. Nothing was installed.');
  }

  await fs.writeFile(staging, bytes);
  await fs.rename(staging, final);
  return { path: final, bytes: bytes.length, verified: file.md5 ? 'checksum' : 'zip structure' };
}
