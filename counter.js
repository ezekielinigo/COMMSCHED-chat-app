/**
 * counter.js — Counter increment helpers.
 *
 * - `incrementSheetCounter_()` is the low-level atomic increment that acquires a
 *   script lock, reads the current cell value, adds delta, and writes it back.
 * - `incrementEmailCounter_()` targets the "EMAILS" sheet (columns D=visits,
 *   E=queries, F=errors). Column numbers come from auth.js's
 *   getEmailSheetColumnMap_() so header reordering is tolerated.
 * - `incrementMetricCounter_()` targets the "METRICS" sheet — column B for
 *   direct user queries, column C for menu/suggestion-click triggers.
 *   The function name must exactly match a value in METRICS column A.
 *
 * Dependencies: auth.js (getMetricsSheet_, getEmailSheetColumnMap_).
 * Used by: routing.js (getGeminiResponse), auth.js (getCurrentUserProfile_),
 *          messages.js (finalizeBotResponse_).
 */

function incrementSheetCounter_(sheetName, rowNumber, columnNumber, delta) {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	if (!ss || !sheetName || !rowNumber || !columnNumber) {
		return false;
	}

	const sheet = ss.getSheetByName(sheetName);
	if (!sheet) {
		return false;
	}

	const amount = Number(delta || 1);
	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(5000);
		const range = sheet.getRange(rowNumber, columnNumber);
		const currentValue = Number(range.getValue()) || 0;
		range.setValue(currentValue + amount);
		return true;
	} catch (error) {
		return false;
	} finally {
		try {
			lock.releaseLock();
		} catch (releaseError) {
			// Ignore lock cleanup failures.
		}
	}
}

function incrementEmailCounter_(rowNumber, columnNumber, delta) {
	return incrementSheetCounter_("EMAILS", rowNumber, columnNumber, delta);
}

function findMetricRowByFunctionName_(functionName) {
	const sheet = getMetricsSheet_();
	const targetName = String(functionName || "").trim().toLowerCase();
	if (!sheet || !targetName) {
		return null;
	}

	const lastRow = sheet.getLastRow();
	if (lastRow < 2) {
		return null;
	}

	const rows = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
	for (let i = 0; i < rows.length; i += 1) {
		const rowName = String((rows[i] || [])[0] || "").trim().toLowerCase();
		if (rowName && rowName === targetName) {
			return i + 2;
		}
	}

	return null;
}

function incrementMetricCounter_(functionName, triggerSource) {
	const rowNumber = findMetricRowByFunctionName_(functionName);
	if (!rowNumber) {
		return false;
	}

	const source = String(triggerSource || "query").trim().toLowerCase();
	const columnNumber = source === "menu" ? 3 : 2;
	return incrementSheetCounter_("METRICS", rowNumber, columnNumber, 1);
}
