/* handler.js

- intent-facing data lookup functions
- only the functions directly called by intent routing live here

*/
function checkPoStatus(entities) { // done
	const startedAt = Date.now();
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const metaLookupStartedAt = Date.now();
	const meta = getCommschedLookupMeta_();
	console.log("[checkPoStatus] metadata lookup: " + (Date.now() - metaLookupStartedAt) + "ms");

	if (!meta) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const workbookStartedAt = Date.now();
	const workbook = openSpreadsheetFromLink_(meta.sourceLink);
	const sheet = workbook.getSheetByName(meta.sheetName);
	console.log("[checkPoStatus] workbook open + sheet resolve: " + (Date.now() - workbookStartedAt) + "ms");

	if (!sheet) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const lastRow = sheet.getLastRow();
	if (lastRow <= meta.headerRow) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const rowLookupStartedAt = Date.now();
	const match = findPoRowInColumn_(sheet, meta.poColumn, meta.dataStartRow, lastRow, poNumber);
	console.log("[checkPoStatus] PO lookup: " + (Date.now() - rowLookupStartedAt) + "ms" + (match ? " via " + match.method : " (not found)"));

	if (!match) {
		console.log("[checkPoStatus] total: " + (Date.now() - startedAt) + "ms");
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const delivReadStartedAt = Date.now();
	const delivValue = String(sheet.getRange(match.row, meta.delivColumn + 1).getDisplayValue() || "").trim().toUpperCase();
	console.log("[checkPoStatus] delivery read: " + (Date.now() - delivReadStartedAt) + "ms");
	console.log("[checkPoStatus] total: " + (Date.now() - startedAt) + "ms");

	if (delivValue === "YES") {
		return "<b>PO " + poNumber + "</b> is closed.";
	}
	if (delivValue === "NO") {
		return "<b>PO " + poNumber + "</b> is still open.";
	}

	return "No data found for <b>PO " + poNumber + "</b>.";
}

function checkPoGrStatus(entities) { // done
	const startedAt = Date.now();
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const metaLookupStartedAt = Date.now();
	const meta = getCommschedGrLookupMeta_();
	console.log("[checkPoGrStatus] metadata lookup: " + (Date.now() - metaLookupStartedAt) + "ms");

	if (!meta) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const workbookStartedAt = Date.now();
	const workbook = openSpreadsheetFromLink_(meta.sourceLink);
	const sheet = workbook.getSheetByName(meta.sheetName);
	console.log("[checkPoGrStatus] workbook open + sheet resolve: " + (Date.now() - workbookStartedAt) + "ms");

	if (!sheet) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const lastRow = sheet.getLastRow();
	if (lastRow <= meta.headerRow) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const rowLookupStartedAt = Date.now();
	const match = findPoRowInColumn_(sheet, meta.poColumn, meta.dataStartRow, lastRow, poNumber);
	console.log("[checkPoGrStatus] PO lookup: " + (Date.now() - rowLookupStartedAt) + "ms" + (match ? " via " + match.method : " (not found)"));

	if (!match) {
		console.log("[checkPoGrStatus] total: " + (Date.now() - startedAt) + "ms");
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const rowReadStartedAt = Date.now();
	const rowValues = sheet.getRange(match.row, 1, 1, meta.lastColumn).getDisplayValues()[0] || [];
	const currencyValue = String(rowValues[meta.currencyColumn] || "").trim();
	const grAmountValue = String(rowValues[meta.grAmountColumn] || "").trim();
	const grValue = String(rowValues[meta.grColumn] || "").trim().replace(/\s+/g, " ").toUpperCase();
	console.log("[checkPoGrStatus] row read: " + (Date.now() - rowReadStartedAt) + "ms");
	console.log("[checkPoGrStatus] total: " + (Date.now() - startedAt) + "ms");

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

	return bucketReplies[grValue] || "No data found for <b>PO " + poNumber + "</b>.";
}

function checkPoRemainingBalance(entities) { // done
	const startedAt = Date.now();
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const metaLookupStartedAt = Date.now();
	const meta = getCommschedRemainingBalanceLookupMeta_();
	console.log("[checkPoRemainingBalance] metadata lookup: " + (Date.now() - metaLookupStartedAt) + "ms");

	if (!meta) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const workbookStartedAt = Date.now();
	const workbook = openSpreadsheetFromLink_(meta.sourceLink);
	const sheet = workbook.getSheetByName(meta.sheetName);
	console.log("[checkPoRemainingBalance] workbook open + sheet resolve: " + (Date.now() - workbookStartedAt) + "ms");

	if (!sheet) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const lastRow = sheet.getLastRow();
	if (lastRow <= meta.headerRow) {
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const rowLookupStartedAt = Date.now();
	const match = findPoRowInColumn_(sheet, meta.poColumn, meta.dataStartRow, lastRow, poNumber);
	console.log("[checkPoRemainingBalance] PO lookup: " + (Date.now() - rowLookupStartedAt) + "ms" + (match ? " via " + match.method : " (not found)"));

	if (!match) {
		console.log("[checkPoRemainingBalance] total: " + (Date.now() - startedAt) + "ms");
		return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
	}

	const rowReadStartedAt = Date.now();
	const rowValues = sheet.getRange(match.row, 1, 1, meta.lastColumn).getDisplayValues()[0] || [];
	const currencyValue = String(rowValues[meta.currencyColumn] || "").trim();
	const remainingBalanceValue = String(rowValues[meta.remainingBalanceColumn] || "").trim();
	console.log("[checkPoRemainingBalance] row read: " + (Date.now() - rowReadStartedAt) + "ms");
	console.log("[checkPoRemainingBalance] total: " + (Date.now() - startedAt) + "ms");

	if (!currencyValue || !remainingBalanceValue) {
		return "No data found for <b>PO " + poNumber + "</b>.";
	}

	return "<b>PO " + poNumber + "</b> has a remaining balance of " + currencyValue + " " + remainingBalanceValue + ".";
}

function checkPoLatestGrDate(entities) {
	const poNumber = entities.PO_NUMBER;
	return "The latest GR date of <b>PO " + poNumber + "</b> is: [date here]";
}
/****************** PO AGING ******************/

function checkPoAging(entities) {
	const poNumber = entities.PO_NUMBER;
	return "<b>PO " + poNumber + "</b> is [age here] days old";
}

function checkPoAgingExceeded(entities) {
	const poNumber = entities.PO_NUMBER;
	return "<b>PO " + poNumber + "</b> has exceeded standard SLA: [yes/no here]";
}

function checkPoAgingExceededList(entities) {
	return "Here are the POs that have exceeded the standard SLA: [list of POs here]";
}