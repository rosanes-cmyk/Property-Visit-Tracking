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
        const titleData = parseAppointmentTitle(email.subject);
        // REI truncates the task title in its emails, so a direct link often does not survive.
        // Fall back to REI's "View" button — a SendGrid click-tracking URL that redirects to the
        // real REI page (Playwright follows the redirect; the sandbox browser is already logged in).
        const viewLink = (email.urls || []).find((u) => /ct\.sendgrid\.net\/ls\/click/i.test(u)) || '';
        const reiLink = email.reiLink || titleData.reiLink || viewLink;
        partialVisit = {
          gmailMessageId: email.id,
          emailSubject: email.subject,
          reiLink,
          sellerName: titleData.sellerName,
          propertyAddress: titleData.propertyAddress,
          appointmentStartIso: titleData.appointmentStartIso,
          assignedOwner: titleData.assignedOwner,
          taskTitle: titleData.rawTitle,
          warnings: [...(titleData.warnings || [])],
          scrapedAt: new Date().toISOString()
        };
        if (!reiLink) throw new Error('No REI BlackBook link was found in the Gmail message.');

        logger.info('Opening REI notification.', {
          gmailMessageId: email.id,
          subject: email.subject,
          reiLink
        });

        const scraped = await scrapeReiVisit(context, reiLink, titleData);
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
