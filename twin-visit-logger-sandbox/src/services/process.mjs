import { config } from '../config.mjs';
import {
  addLabel,
  ensureLabel,
  listCandidateMessages,
  readMessage
} from '../google/gmail.mjs';
import { findExistingVisit, upsertVisit } from '../google/sheets.mjs';
import { syncCalendarEvent } from '../google/calendar.mjs';
import { parseAppointmentTitle } from '../parser/email.mjs';
import { launchReiContext, ReiSessionExpiredError } from '../rei/browser.mjs';
import { scrapeReiVisit } from '../rei/scraper.mjs';

// Pull the phone number out of the REI notification (from the task-title line if possible). REI
// truncates long titles, so a short "Booked appointment | (707) 484-2558" title survives and the
// phone becomes the lookup key the scraper searches REI by.
function extractTaskPhone(email) {
  const html = String(email.html || '').replace(/<[^>]+>/g, ' ');
  const text = `${email.subject || ''}\n${email.text || ''}\n${html}`;
  const phoneRe = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
  const apptLine = text.split(/\r?\n/).find((line) => /appointment/i.test(line) && phoneRe.test(line));
  if (apptLine) {
    const match = apptLine.match(phoneRe);
    if (match) return match[0].trim();
  }
  const any = text.match(phoneRe);
  return any ? any[0].trim() : '';
}

// The pipe-delimited task title lives in the email BODY (the subject is generic). Find that line
// so we can read the appointment date/time from it as a fallback when REI's own fields are empty.
function findTaskTitleLine(email) {
  const html = String(email.html || '').replace(/<[^>]+>/g, '\n');
  const text = `${email.text || ''}\n${html}`;
  const line = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((l) => /(booked|rescheduled|cancell?ed)\s+appointment/i.test(l));
  return line || '';
}

function criticalValidationErrors(visit) {
  const status = String(visit.taskStatus || '').toLowerCase();
  if (status.includes('cancel')) return [];

  const errors = [];
  if (!visit.sellerName) errors.push('Seller name is missing.');
  if (!visit.propertyAddress) errors.push('Property address is missing.');
  if (!visit.appointmentStartIso) errors.push('Appointment date/time is missing or invalid.');
  if (!visit.assignedOwner) errors.push('Assigned owner is missing.');
  return errors;
}

export async function processInbox(auth, logger) {
  const processedLabelId = await ensureLabel(auth, config.gmailProcessedLabel);
  const errorLabelId = await ensureLabel(auth, config.gmailErrorLabel);
  const messages = await listCandidateMessages(auth);

  if (!messages.length) {
    logger.info('No matching Gmail notifications found.');
    return { found: 0, processed: 0, errors: 0 };
  }

  logger.info('Found Gmail notifications.', { count: messages.length });
  const context = await launchReiContext();
  let processed = 0;
  let errors = 0;

  try {
    for (const messageRef of [...messages].reverse()) {
      let email;
      let partialVisit = null;
      try {
        email = await readMessage(auth, messageRef.id);
        // Parse the pipe-delimited title from the email BODY (subject is generic), so the date in
        // the title is available as a fallback when REI's own appointment fields are empty.
        const titleData = parseAppointmentTitle(findTaskTitleLine(email) || email.subject);
        // REI truncates task titles in emails, so a direct link usually does not survive. Prefer a
        // genuine direct contact link if present; otherwise locate the contact by phone number.
        const reiLink = email.reiLink || titleData.reiLink || '';
        const phone = extractTaskPhone(email);
        partialVisit = {
          gmailMessageId: email.id,
          emailSubject: email.subject,
          reiLink,
          phone,
          sellerName: titleData.sellerName,
          propertyAddress: titleData.propertyAddress,
          appointmentStartIso: titleData.appointmentStartIso,
          assignedOwner: titleData.assignedOwner,
          taskTitle: titleData.rawTitle,
          warnings: [...(titleData.warnings || [])],
          scrapedAt: new Date().toISOString()
        };
        if (!reiLink && !phone) throw new Error('No REI link or phone number was found in the Gmail message.');

        logger.info('Opening REI notification.', {
          gmailMessageId: email.id,
          subject: email.subject,
          reiLink,
          phone
        });

        const scraped = await scrapeReiVisit(context, reiLink, { ...titleData, phone });
        partialVisit = {
          ...partialVisit,
          ...scraped,
          gmailMessageId: email.id,
          emailSubject: email.subject
        };

        const match = await findExistingVisit(auth, partialVisit);
        const validationErrors = criticalValidationErrors(partialVisit);
        const strictFailure = config.strictValidation && validationErrors.length > 0;

        if (strictFailure) {
          partialVisit.automationError = validationErrors.join(' | ');
          partialVisit.warnings = [...(partialVisit.warnings || []), ...validationErrors];
          if (!config.dryRun) {
            await upsertVisit(auth, partialVisit, match);
            await addLabel(auth, email.id, errorLabelId);
          }
          errors += 1;
          logger.warn('REI record needs review; calendar was not changed.', {
            gmailMessageId: email.id,
            errors: validationErrors
          });
          continue;
        }

        let calendarEventId = match.calendarEventId || '';
        if (!config.dryRun) {
          calendarEventId = await syncCalendarEvent(auth, partialVisit, calendarEventId);
          await upsertVisit(auth, { ...partialVisit, calendarEventId }, match);
          await addLabel(auth, email.id, processedLabelId);
        }

        processed += 1;
        logger.info('Visit synchronized.', {
          gmailMessageId: email.id,
          reiRecordId: partialVisit.reiRecordId,
          calendarEventId,
          dryRun: config.dryRun
        });
      } catch (error) {
        if (error instanceof ReiSessionExpiredError || error.retryable) {
          logger.error('REI session expired. No Gmail error label was added so this email can retry.', error);
          throw error;
        }

        errors += 1;
        logger.error('Failed to process Gmail notification.', {
          gmailMessageId: messageRef.id,
          error: { name: error.name, message: error.message, stack: error.stack }
        });

        if (!config.dryRun) {
          if (partialVisit) {
            partialVisit.automationError = error.message;
            await upsertVisit(auth, partialVisit).catch((sheetError) => {
              logger.error('Could not write the processing error to Sheets.', sheetError);
            });
          }
          await addLabel(auth, messageRef.id, errorLabelId).catch((labelError) => {
            logger.error('Could not add Gmail error label.', labelError);
          });
        }
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  return { found: messages.length, processed, errors };
}
