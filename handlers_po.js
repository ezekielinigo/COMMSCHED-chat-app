/**
 * handlers_po.js — Single-PO lookup handlers.
 *
 * Each handler takes (entities, parsed, context) and returns a string or a
 * structured response object for the React client.
 *
 * - `checkPoStatus`        → deliveryComplete YES/NO → closed/open
 * - `checkPoGrStatus`      → GR% bucket + currency + GR amount
 * - `checkPoRemainingBalance` → currency + remaining balance
 * - `checkPoTotalValue`    → PO amount vs actual GR value
 * - `checkPoLatestGrDate`  → formatted "MMM d, yyyy" or "not yet GR'd"
 * - `checkPoAging`         → PO SLA bucket → aging reply (shared with
 *                            check_po_aging_exceeded / check_po_high_risk intents)
 * - `checkPoYear`          → PO creation year extracted from PO Date
 * - `checkPoFullyGrd`      → fully GR'd / pending unGR'd balance reply
 *
 * All handlers use `lookupCommschedPoRow_()` from sheets.js which enforces
 * division-access rules and returns `{ accessDenied, message }` on mismatch.
 *
 * Dependencies: sheets.js (lookupCommschedPoRow_), messages.js
 *               (getCommschedNotFoundMessage_, getCommschedNoDataMessage_,
 *               getCommschedDivisionDeniedMessage_, getMissingEntityMessage,
 *               buildPoAgingReply_), format.js (parseDisplayAmount_,
 *               getPoSlaBucketInfo_).
 * Routed from: routing.js (getGeminiResponse → handlers dispatch table).
 */

function checkPoStatus(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["deliveryComplete"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const delivValue = String(lookup.values.deliveryComplete || "").trim().toUpperCase();

	if (delivValue === "YES") {
		return "<b>PO " + poNumber + "</b> is closed.";
	}
	if (delivValue === "NO") {
		return "<b>PO " + poNumber + "</b> is still open.";
	}

	return getCommschedNoDataMessage_(poNumber);
}

function checkPoGrStatus(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "goodsReceiptAmount", "grBucket"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const currencyValue = String(lookup.values.currency || "").trim();
	const grAmountValue = String(lookup.values.goodsReceiptAmount || "").trim();
	const grValue = String(lookup.values.grBucket || "").trim().replace(/\s+/g, " ").toUpperCase();

	const bucketReplies = {
		"A. ZERO GR": "<b>PO " + poNumber + "</b> is not yet GR'd.",
		"B. 1-10% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (1-10% GR'd).",
		"C. 11-30% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (11-30% GR'd).",
		"D. 31-50% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (31-50% GR'd).",
		"E. 51-70% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (51-70% GR'd).",
		"F. 71-90% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (71-90% GR'd).",
		"G. 91-99% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (91-99% GR'd).",
		"H. FULLY GRD": "<b>PO " + poNumber + "</b> is fully GR'd.",
	};

	return bucketReplies[grValue] || getCommschedNoDataMessage_(poNumber);
}

function checkPoRemainingBalance(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "remainingBalance"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const currencyValue = String(lookup.values.currency || "").trim();
	const remainingBalanceValue = String(lookup.values.remainingBalance || "").trim();

	if (!currencyValue || !remainingBalanceValue) {
		return getCommschedNoDataMessage_(poNumber);
	}

	return "<b>PO " + poNumber + "</b> has a remaining balance of " + currencyValue + " " + remainingBalanceValue + ".";
}

function checkPoTotalValue(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "poAmount", "goodsReceiptAmount"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const currencyValue = String(lookup.values.currency || "").trim();
	const poAmountValue = String(lookup.values.poAmount || "").trim();
	const grAmountValue = String(lookup.values.goodsReceiptAmount || "").trim();

	if (!currencyValue || !poAmountValue || !grAmountValue) {
		return getCommschedNoDataMessage_(poNumber);
	}

	return "<b>PO " + poNumber + "</b> has a total value of " + currencyValue + " " + poAmountValue + " and GR value of " + currencyValue + " " + grAmountValue + ".";
}

function checkPoLatestGrDate(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return "Cannot find PO X. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["latestGrDate"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const latestGrDateRaw = lookup.values ? lookup.values.latestGrDate : "";
	const latestGrDateValue = String(latestGrDateRaw || "").trim();
	if (!latestGrDateValue) {
		return "<b>PO " + poNumber + "</b> is not yet GR'd.";
	}

	const parsedDate = parseDateValue_(latestGrDateRaw);
	const formattedDate = parsedDate
		? Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "MMM d, yyyy")
		: latestGrDateValue;

	return "The last GR for <b>PO " + poNumber + "</b> was posted on " + formattedDate + ".";
}

function checkPoAging(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["poSla"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const poSlaValue = lookup.values ? lookup.values.poSla : "";
	if (!poSlaValue) {
		return getCommschedNoDataMessage_(poNumber);
	}

	const bucketInfo = getPoSlaBucketInfo_(poSlaValue);
	if (!bucketInfo) {
		return getCommschedNoDataMessage_(poNumber);
	}

	const intentName = parsed && parsed.intent ? String(parsed.intent).trim() : "check_po_aging";
	return buildPoAgingReply_(poNumber, bucketInfo, intentName);
}

function checkPoYear(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || '').trim();
	if (!poNumber) return getMissingEntityMessage('PO_NUMBER');
	const lookup = lookupCommschedPoRow_(poNumber, ['poDate'], context);
	if (lookup && lookup.accessDenied) return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	if (!lookup || !lookup.found) return getCommschedNotFoundMessage_(poNumber);
	const raw = lookup.values && lookup.values.poDate ? lookup.values.poDate : '';
	if (!raw) return 'No PO date found for <b>PO ' + poNumber + '</b>.';
	const dt = parseDateValue_(raw);
	let year = null;
	if (dt) {
		year = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy');
	} else {
		const m = String(raw).match(/(\d{4})/);
		if (m) year = m[1];
	}
	if (!year) return 'Could not determine PO year for <b>PO ' + poNumber + '</b>.';
	return '<b>PO ' + poNumber + '</b> was released on ' + year + '.';
}

function checkPoFullyGrd(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["ungrdUsd", "remainingBalance", "grBucket", "goodsReceiptAmount", "poAmount"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const ungrdRaw = lookup.values && (lookup.values.ungrdUsd || lookup.values.remainingBalance) ? (lookup.values.ungrdUsd || lookup.values.remainingBalance) : "";
	const ungrdNum = parseDisplayAmount_(ungrdRaw);
	if (!isNaN(ungrdNum)) {
		if (Number(ungrdNum) === 0) {
			return "<b>PO " + poNumber + "</b> is fully GR'd.";
		}
		const currencyValue = String(lookup.values && lookup.values.currency ? lookup.values.currency : "USD").trim() || "USD";
		return "<b>PO " + poNumber + "</b> is not yet fully GR'd. (Pending unGR'd balance: " + currencyValue + " " + formatMoney_(ungrdNum) + ")";
	}

	const grBucket = String(lookup.values && lookup.values.grBucket ? lookup.values.grBucket : "").trim().toUpperCase();
	if (grBucket.indexOf("H. FULLY GRD") !== -1 || grBucket.indexOf("FULL") !== -1) {
		return "<b>PO " + poNumber + "</b> is fully GR'd.";
	}
	if (grBucket) {
		const remainingRaw = lookup.values && lookup.values.remainingBalance ? lookup.values.remainingBalance : "";
		const remainingNum = parseDisplayAmount_(remainingRaw);
		const currencyValue = String(lookup.values && lookup.values.currency ? lookup.values.currency : "USD").trim() || "USD";
		if (!isNaN(remainingNum) && Number(remainingNum) > 0) {
			return "<b>PO " + poNumber + "</b> is not yet fully GR'd. (Pending unGR'd balance: " + currencyValue + " " + formatMoney_(remainingNum) + ")";
		}
		return "<b>PO " + poNumber + "</b> is not yet fully GR'd.";
	}

	return getCommschedNoDataMessage_(poNumber);
}
