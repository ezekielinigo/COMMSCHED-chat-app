/**
 * handlers_gr.js — GR ticket status and submission date handlers.
 *
 * - `parseGrTicketSubmittedDate_()` parses DD/MM/YYYY dates from GR sheet cells,
 *   trying both day-first and month-first interpretations to handle ambiguous
 *   date formats.
 * - `checkGrTicketStatus` returns a human-readable stage description for a GR
 *   ticket case number (1-7 digits). Stages map to fixed replies:
 *   (1) For GR Submission → "is for GR validation"
 *   (2) For GR Posting → "is for GR posting"
 *   (3) GR Posted/Completed → "has been GR posted"
 *   (4) For WBS Creation → "is for WBS creation"
 *   (5) Return to Vendor → "has been returned to the vendor"
 *   (6) For Revalidation → "is for revalidation"
 *   (7) Resubmitted → "has been resubmitted"
 *   (8) For Cancellation → "has been cancelled"
 * - `checkGrTicketSubmitted` returns the submitted date in both long
 *   ("MMMM d, yyyy") and short ("M/d/yyyy") formats.
 *
 * GR ticket lookups use `lookupGrTicketRow_()` from sheets.js (no division
 * filtering — GR data is accessible to all divisions).
 *
 * Dependencies: sheets.js (lookupGrTicketRow_, parseDateValue_),
 *               messages.js (getMissingEntityMessage,
 *               getGrTicketNotFoundMessage_, getGrTicketNoDataMessage_).
 * Routed from: routing.js (getGeminiResponse → handlers dispatch table).
 */

function parseGrTicketSubmittedDate_(value) {
	if (value instanceof Date && !isNaN(value.getTime())) {
		return value;
	}

	const text = String(value || '').trim();
	if (!text) {
		return null;
	}

	const match = text.match(/^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})\s*$/);
	if (match) {
		const first = Number(match[1]);
		const second = Number(match[2]);
		let year = Number(match[3]);
		if (match[3].length === 2) {
			year += 2000;
		}

		const candidates = [
			{ day: first, month: second - 1 },
			{ day: second, month: first - 1 },
		];

		for (let i = 0; i < candidates.length; i += 1) {
			const candidate = candidates[i];
			const parsed = new Date(year, candidate.month, candidate.day);
			if (
				!isNaN(parsed.getTime()) &&
				parsed.getFullYear() === year &&
				parsed.getMonth() === candidate.month &&
				parsed.getDate() === candidate.day
			) {
				return parsed;
			}
		}
	}

	const parsed = new Date(text);
	return isNaN(parsed.getTime()) ? null : parsed;
}

function checkGrTicketStatus(entities, parsed, context) {
	const grNumber = String(entities.GR_NUMBER || '').trim();
	if (!grNumber) {
		return getMissingEntityMessage('GR_NUMBER');
	}

	const lookup = lookupGrTicketRow_(grNumber, ['grStages', 'poNumber'], context);
	if (!lookup || !lookup.found) {
		return getGrTicketNotFoundMessage_(grNumber);
	}

	const stageValue = String(lookup.values && lookup.values.grStages ? lookup.values.grStages : '').trim().replace(/\s+/g, ' ');
	if (!stageValue) {
		return getGrTicketNoDataMessage_(grNumber);
	}

	const stageReplies = {
		'(1) For GR Submission': '<b>GR Ticket ' + grNumber + '</b> is for GR validation.',
		'(2) For GR Posting': '<b>GR Ticket ' + grNumber + '</b> is for GR posting.',
		'(3) GR Posted/Completed': '<b>GR Ticket ' + grNumber + '</b> has been GR posted.',
		'(4) For WBS Creation': '<b>GR Ticket ' + grNumber + '</b> is for WBS creation.',
		'(5) Return to Vendor': '<b>GR Ticket ' + grNumber + '</b> has been returned to the vendor.',
		'(6) For Revalidation': '<b>GR Ticket ' + grNumber + '</b> is for revalidation.',
		'(7) Resubmitted': '<b>GR Ticket ' + grNumber + '</b> has been resubmitted.',
		'(8) For Cancellation': '<b>GR Ticket ' + grNumber + '</b> has been cancelled.',
	};

	return stageReplies[stageValue] || getGrTicketNoDataMessage_(grNumber);
}

function checkGrTicketSubmitted(entities, parsed, context) {
	const grNumber = String(entities.GR_NUMBER || '').trim();
	if (!grNumber) {
		return getMissingEntityMessage('GR_NUMBER');
	}

	const lookup = lookupGrTicketRow_(grNumber, ['dateSubmitted', 'poNumber'], context);
	if (!lookup || !lookup.found) {
		return getGrTicketNotFoundMessage_(grNumber);
	}

	const submittedDateValue = lookup.values && lookup.values.dateSubmitted ? lookup.values.dateSubmitted : '';
	const parsedDate = parseGrTicketSubmittedDate_(submittedDateValue);
	if (!parsedDate) {
		return getGrTicketNoDataMessage_(grNumber);
	}

	const longDate = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), 'MMMM d, yyyy');
	const shortDate = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), 'M/d/yyyy');
	return '<b>GR Ticket ' + grNumber + '</b> was submitted on ' + longDate + ' (' + shortDate + ')';
}
