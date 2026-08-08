import { DateTime } from 'luxon';
import { config } from '../config.mjs';
import {
  addLabel,
  ensureLabel,
  listCandidateMessages,
  readMessage
} from '../google/gmail.mjs';
import { findExistingVisit, upsertVisit } from '../google/sheets.mjs';
import { syncCalendarEvent, buildDescription } from '../google/calendar.mjs';
import { parseAppointmentTitle } from '../parser/email.mjs';
import { launchReiContext, ReiSessionExpiredError } from '../rei/browser.mjs';
import { scrapeReiVisit } from '../rei/scraper.mjs';
import { readTasks, pickTaskForVisit, completeTask } from '../rei/tasks.mjs';
import { shouldCompleteTask } from '../rei/task-gate.mjs';
import { notifyChat } from '../utils/notify.mjs';
import { briefingFromDescription } from '../whatsapp/note.mjs';
import fs from 'node:fs/promises';

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
  // REI appends "Due: <weekday>, <date>" to the same line; strip it so the title parses cleanly.
  return line ? line.replace(/\bDue:.*$/i, '').trim() : '';
}

function criticalValidationErrors(visit) {
  const status = String(visit.taskStatus || '').toLowerCase();
  if (status.includes('cancel')) return [];

  // Only data the automation genuinely cannot work without. Assigned Owner is deliberately NOT here:
  // REI often has no owner on the contact and the team assigns it by hand, so requiring it blocked
  // real bookings from being scheduled and suppressed their calendar events. A missing owner is
  // surfaced as a warning and the dashboard flags the row instead.
  const errors = [];
  if (!visit.sellerName) errors.push('Seller name is missing.');
  if (!visit.propertyAddress) errors.push('Property address is missing.');
  if (!visit.appointmentStartIso) errors.push('Appointment date/time is missing or invalid.');
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
          // The contact URL matters more than anything else here: the fix is almost always a blank
          // field on that REI record, and without the link the reader has to go hunting for it.
          logger.warn('REI record needs review; calendar was not changed.', {
            gmailMessageId: email.id,
            errors: validationErrors,
            // Include the scraper's detail (which date pieces were found) so the gap is visible.
            details: [...new Set(partialVisit.warnings || [])],
            appointmentSource: partialVisit.appointmentSource || '(none)',
            reiContact: partialVisit.reiLink || '(no REI contact URL resolved)',
            seller: partialVisit.sellerName || '(no name read)',
            fixOnTheReiContact: validationErrors.some((e) => /address/i.test(e))
              ? 'Fill in "Property Address" on that REI contact, then re-run. No calendar event is ' +
                'created without a real address.'
              : 'Fill in the field(s) named above on that REI contact, then re-run.'
          });
          continue;
        }

        let calendarEventId = match.calendarEventId || '';
        let written = null;
        if (!config.dryRun) {
          calendarEventId = await syncCalendarEvent(auth, partialVisit, calendarEventId);
          /*
           * Carry the event ID on the record itself from here on. The calendar event is created before
           * the row is written, so a failed write used to leave the event with nothing pointing at it:
           * the error path re-tried the upsert with a copy that had no calendarEventId, and the link
           * between the row and the event was simply lost.
           */
          partialVisit.calendarEventId = calendarEventId;
          written = await upsertVisit(auth, { ...partialVisit, calendarEventId }, match);
          await addLabel(auth, email.id, processedLabelId);
        }

        processed += 1;
        // Say WHERE, not just "synchronized". "It did not show up in the sheet" is unanswerable from
        // a success line that names neither the workbook nor the tab nor the row — and the usual
        // cause is SPREADSHEET_ID or TRACKER_SHEET in .env pointing somewhere other than the
        // workbook being looked at.
        logger.info('Visit synchronized.', {
          gmailMessageId: email.id,
          reiRecordId: partialVisit.reiRecordId,
          seller: partialVisit.sellerName || '',
          address: partialVisit.propertyAddress || '',
          wroteToWorkbook: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
          wroteToTab: config.trackerSheet,
          wroteToRow: written?.rowNumber ?? '(unknown)',
          rowWasAppended: written?.appended ? 'new row' : 'updated an existing row',
          calendarEventId,
          calendarTarget: config.calendarName || config.calendarId,
          dryRun: config.dryRun
        });

        /*
         * The FULL briefing belongs to the WhatsApp group, and is OFF in Chat.
         *
         * It was routed here when WhatsApp was switched off, on the reasoning that the briefing was the
         * valuable part and should survive. The client has now seen it land in the alerts channel and
         * decided otherwise: "it should be in the whatsapp only, so we dont need that in the alert gc, and
         * should be only in the whatsapp if we enable again." CHAT_VISIT_BRIEFING=true puts it back.
         *
         * Nothing is lost by that. The booking still creates the row, the dashboard entry and Juan's
         * calendar event, and still appears on the 11am/3pm work queue under Upcoming Visit — so Chat still
         * tells the team about the visit, once, in the place they already read.
         *
         * The original reasoning, kept because it is still true of the briefing itself:
         *
         * The WhatsApp number used for this got banned — automating WhatsApp Web breaches their terms and Meta
         * detects it, which was a stated risk from the start and has now happened. But the valuable thing was
         * never the group: it is the visitor having the property, the drive plan, the numbers and the call in
         * front of them before they set off. Chat is the client's own Workspace and automating it is permitted,
         * so the briefing goes there and survives WhatsApp being switched off entirely.
         *
         * Seller phone and email are stripped by notifyChat regardless of what is assembled here.
         */
        /*
         * The ONE write this project makes into REI, and it happens BEFORE the Chat message.
         *
         * The client wanted both facts in a single message: "i need the template that will notify in the
         * gc about booked and the task is completed." To report the closure, the closure has to have
         * happened — so this runs first and hands `taskLine` to the message below.
         *
         * It is deliberately OUTSIDE the CHAT_VISIT_BRIEFING gate. Closing the task is not a briefing
         * feature, and tying it to one would mean switching the briefing off silently stops REI being
         * kept tidy.
         *
         * Each condition is re-checked rather than remembered: the event id Google returned, the row the
         * sheet write reported, and the task read off this contact and matched on phone AND date — a
         * seller with two properties has two tasks, and clearing the wrong one hides a visit still to
         * come. shouldCompleteTask holds all of it, plus REI_COMPLETE_TASKS, which is false by default.
         *
         * Nothing here is ever fatal. By this point the row and the calendar event exist; an uncompleted
         * task is precisely the visible loose end it is designed to be.
         */
        let taskLine = '';
        if (config.reiCompleteTasks && !config.dryRun) {
          try {
            const visitKey = {
              phone: partialVisit.phone,
              date: partialVisit.appointmentStartIso
                ? DateTime.fromISO(partialVisit.appointmentStartIso)
                  .setZone(config.calendarTimezone).toFormat('yyyy-MM-dd')
                : ''
            };
            const page = await context.newPage();
            try {
              await page.goto(partialVisit.reiLink, { waitUntil: 'domcontentloaded' });
              const reiSelectors = JSON.parse(await fs.readFile(config.reiSelectorConfig, 'utf8'));
              const tasks = await readTasks(page, reiSelectors, { timezone: config.calendarTimezone });
              const task = pickTaskForVisit(tasks, visitKey);
              const verdict = shouldCompleteTask({
                enabled: true,
                apply: true,
                task,
                visit: visitKey,
                rowWritten: Boolean(written),
                calendarVerified: Boolean(calendarEventId),
                alreadyComplete: Boolean(task?.complete)
              });
              if (!verdict.complete) {
                taskLine = `⚠️ REI task still open — ${verdict.reason}`;
                logger.info('REI task left open.', { reason: verdict.reason, seller: partialVisit.sellerName });
              } else {
                const result = await completeTask(page, reiSelectors, task);
                /*
                 * `confirmed` is completeTask re-reading the row, not the click landing. An unconfirmed
                 * close is reported as still open — a tick nobody can trust is worse than a warning.
                 */
                taskLine = result.confirmed
                  ? `✅ REI task closed — ${task.title || 'Booked appointment'}`
                  : '⚠️ REI task — the click was not confirmed, check it in REI';
                logger.info(result.confirmed ? 'REI task marked complete.' : 'REI task completion NOT confirmed.', {
                  seller: partialVisit.sellerName,
                  clicked: result.clicked,
                  rowText: result.rowText
                });
              }
            } finally {
              await page.close().catch(() => {});
            }
          } catch (taskError) {
            taskLine = '⚠️ REI task still open — could not be reached, close it by hand';
            logger.warn('Could not complete the REI task; it stays open.', { message: taskError.message });
          }
        }

        /*
         * The FULL briefing belongs to the WhatsApp group, and is OFF in Chat unless asked for.
         *
         * It was routed here when WhatsApp was switched off; the client saw it land in the alerts channel
         * and decided otherwise — "it should be in the whatsapp only". WhatsApp is out again, restricted,
         * so CHAT_VISIT_BRIEFING=true puts it back and Chat is now the only delivery there is.
         */
        if (!config.dryRun && config.chatVisitBriefing) {
          /*
           * The SAME builder, from the SAME text, as the WhatsApp delivery. This used to assemble its own
           * version from the raw REI fields and silently dropped the drive plan, every PropertyRadar
           * figure, motivation, condition, timeline, price expectation and the call summary — about half
           * the briefing. buildDescription() is what goes on the calendar event, so the two deliveries
           * read one source and cannot disagree.
           */
          const briefing = briefingFromDescription(buildDescription(partialVisit), {
            address: partialVisit.propertyAddress,
            appointmentText: partialVisit.appointmentStartIso
              ? DateTime.fromISO(partialVisit.appointmentStartIso)
                .setZone(config.calendarTimezone).toFormat('ccc, LLL d, yyyy, h:mm a')
              : ''
          });

          /*
           * What the automation DID, then the one thing left for a person.
           *
           * Each line states what actually happened rather than what was attempted. A calendar event that
           * failed says so, in the same place the successful one would have — a checklist that only ever
           * shows ticks teaches people to stop reading it.
           */
          const rowNumber = written?.rowNumber ?? '?';
          const done = [
            calendarEventId
              ? `✅ Calendar — event on ${config.calendarName || 'the visit calendar'}`
              : "❌ Calendar — NOT created, this visit is on nobody's day",
            written
              ? `✅ Dashboard — row ${rowNumber} in "${config.trackerSheet}" (${written.appended ? 'new' : 'updated'})`
              : '❌ Dashboard — the row was NOT written',
            // Absent entirely when REI_COMPLETE_TASKS is off, rather than claiming anything either way.
            taskLine,
            '➡️ NEXT: create the WhatsApp group, add the team, and paste this briefing'
          ].filter(Boolean).join('\n');

          /*
           * The briefing goes inside a fenced block; the checklist stays outside it.
           *
           * The client: "how about the template? so my teammate can copy it?" Google Chat renders fenced
           * text as a monospace block with a copy control, and copying it takes ONLY that block. Posted
           * flat, a teammate copying the briefing also carried the checklist into the visit group —
           * instructions to themselves, pasted for the team.
           *
           * A fence inside the briefing would close it early. Nothing generates one — every line is a
           * label and a value — but the text is neutralised rather than trusted, because the failure is
           * silent and ugly: half a briefing in a box and the rest as loose text.
           */
          const FENCE = String.fromCharCode(96, 96, 96);
          const fenced = `${FENCE}\n${briefing.split(FENCE).join("'''")}\n${FENCE}`;

          await notifyChat(
            `*New visit booked — ${partialVisit.sellerName || 'seller'}*\n` +
            'Copy the block below into the visit group.\n\n' +
            `${fenced}\n\n━━ DONE FOR YOU ━━\n${done}`,
            /*
             * The seller's number survives in the briefing. It was redacted while this was one alert among
             * many and WhatsApp carried the real briefing; Chat is now the ONLY place the visitor gets
             * this, and a briefing that says "[phone]" sends them to a house to meet somebody they cannot
             * ring. Both destinations are the client's own team-only Workspace. Every other notification
             * is still scrubbed, and tests/notify.test.mjs names the call sites allowed to do this.
             */
            { kind: 'ok', keepContactDetails: true }
          );
        }
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

        /*
         * Name this one in plain language, because it is the single most likely reason a visit is on
         * the calendar but missing from the tracker — and the message Google returns ("cell L43
         * violates the data validation rules") does not say what to do about it.
         *
         * The cause is always the same shape: REI supplied a value the workbook's dropdown for that
         * column does not list. The row is refused outright; the calendar event, created a moment
         * earlier, stays. That asymmetry is exactly what "the lead did not show in the sheet" looks
         * like from the outside.
         */
        if (/data validation/i.test(String(error.message))) {
          logger.error('THE WORKBOOK REFUSED THIS ROW — a dropdown rule rejected one of the values.', {
            whatThisMeans: 'REI supplied a value that is not in that column\'s allowed list, so Google ' +
              'refused the whole row. The calendar event was already created, which is why the visit ' +
              'shows on the calendar but not in the tracker.',
            cellGoogleNamed: (String(error.message).match(/cell\s+([A-Z]+\d+)/i) || [])[1] || '(not named)',
            howToFix: 'Open the tracker, run "Property Visit Tracker → Set up / repair sheet" to ' +
              'refresh the dropdown lists, then re-run. Or add the missing value to that column\'s list.',
            workbook: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
            tab: config.trackerSheet,
            seller: partialVisit?.sellerName || '',
            address: partialVisit?.propertyAddress || ''
          });
        }

        if (!config.dryRun) {
          await notifyChat(
            `A booking could not be logged: ${error.message}` +
            (partialVisit?.propertyAddress ? `\nProperty: ${partialVisit.propertyAddress}` : '') +
            (partialVisit?.sellerName ? `\nSeller: ${partialVisit.sellerName}` : '') +
            (/data validation/i.test(String(error.message))
              ? '\nThe workbook refused the row — a dropdown rule rejected a value. Run "Set up / repair sheet".'
              : ''),
            { kind: 'error' }
          );
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
