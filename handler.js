/* handler.js

- intent-facing data lookup functions
- only the functions directly called by intent routing live here

*/
function getCommschedNotFoundMessage_(poNumber) {
	return "Cannot find <b>PO " + poNumber + "</b> in latest COMMSCHED sheet.";
}

function getCommschedNoDataMessage_(poNumber) {
	return "No data found for <b>PO " + poNumber + "</b>.";
}

function checkPoStatus(entities) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["deliveryComplete"]);
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

function checkPoGrStatus(entities) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "goodsReceiptAmount", "grBucket"]);
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

function checkPoRemainingBalance(entities) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "remainingBalance"]);
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

function checkPoLatestGrDate(entities) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return "Cannot find <b>PO X</b> in latest COMMSCHED sheet.";
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["latestGrDate"]);
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
/****************** PO AGING ******************/

function getPoAgeMonths_(poDateValue, asOfDate) {
	const poDate = parseDateValue_(poDateValue);
	const currentDate = parseDateValue_(asOfDate || new Date());
	if (!poDate || !currentDate) {
		return null;
	}

	const timeZone = Session.getScriptTimeZone();
	const poYear = Number(Utilities.formatDate(poDate, timeZone, "yyyy"));
	const poMonth = Number(Utilities.formatDate(poDate, timeZone, "MM"));
	const poDay = Number(Utilities.formatDate(poDate, timeZone, "dd"));
	const currentYear = Number(Utilities.formatDate(currentDate, timeZone, "yyyy"));
	const currentMonth = Number(Utilities.formatDate(currentDate, timeZone, "MM"));
	const currentDay = Number(Utilities.formatDate(currentDate, timeZone, "dd"));

	let ageMonths = (currentYear - poYear) * 12 + (currentMonth - poMonth);
	if (currentDay < poDay) {
		ageMonths -= 1;
	}

	return ageMonths < 0 ? 0 : ageMonths;
}

function getPoAgingBucket_(ageMonths) {
	if (typeof ageMonths !== "number" || isNaN(ageMonths)) {
		return null;
	}

	if (ageMonths < 6) {
		return "<6 months";
	}
	if (ageMonths < 9) {
		return "6-9 months";
	}
	if (ageMonths < 12) {
		return "9-12 months";
	}
	if (ageMonths <= 24) {
		return "12-24 months";
	}

	return ">24 months";
}

function formatCsvValue_(value) {
	const text = String(value === undefined || value === null ? "" : value);
	if (/[",\n\r]/.test(text)) {
		return '"' + text.replace(/"/g, '""') + '"';
	}
	return text;
}

function buildCsvContent_(headers, rows) {
	const lines = [];
	lines.push(headers.map(formatCsvValue_).join(","));
	for (let i = 0; i < rows.length; i += 1) {
		lines.push(rows[i].map(formatCsvValue_).join(","));
	}
	return lines.join("\r\n");
}

function normalizePoSlaCellValue_(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function getPoSlaBucketInfo_(value) {
	const normalized = normalizePoSlaCellValue_(value);
	const buckets = {
		"a. <6 months": { cellValue: "a. <6 months", code: "a", label: "<6 months", rank: 1 },
		"b. 6-9 months": { cellValue: "b. 6-9 months", code: "b", label: "6-9 months", rank: 2 },
		"c. 9-12 months": { cellValue: "c. 9-12 months", code: "c", label: "9-12 months", rank: 3 },
		"d. 12-24 months": { cellValue: "d. 12-24 months", code: "d", label: "12-24 months", rank: 4 },
		"e. >24 months": { cellValue: "e. >24 months", code: "e", label: ">24 months", rank: 5 },
	};

	return buckets[normalized] || null;
}

function resolvePoSlaBucketCellsForFilter_(rawFilter) {
	const text = String(rawFilter || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!text) {
		return null;
	}

	if (/(?:^|\s)(?:a\.\s*)?<\s*6\s*months?\b/.test(text) || /\b(?:<\s*6\s*months?|less than\s*6\s*months?|under\s*6\s*months?|<\s*3\s*months?|less than\s*3\s*months?|under\s*3\s*months?)\b/.test(text)) {
		return ["a. <6 months"];
	}

	if (/(?:^|\s)(?:b\.\s*)?6\s*-\s*9\s*months?\b/.test(text) || /\b6\s*to\s*9\s*months?\b/.test(text) || /\bbetween\s*6\s*and\s*9\s*months?\b/.test(text)) {
		return ["b. 6-9 months"];
	}

	if (/(?:^|\s)(?:c\.\s*)?9\s*-\s*12\s*months?\b/.test(text) || /\b9\s*to\s*12\s*months?\b/.test(text) || /\bbetween\s*9\s*and\s*12\s*months?\b/.test(text)) {
		return ["c. 9-12 months"];
	}

	if (/(?:^|\s)(?:d\.\s*)?12\s*-\s*24\s*months?\b/.test(text) || /\b12\s*to\s*24\s*months?\b/.test(text) || /\bbetween\s*12\s*and\s*24\s*months?\b/.test(text)) {
		return ["d. 12-24 months"];
	}

	if (/(?:^|\s)(?:e\.\s*)?>\s*24\s*months?\b/.test(text) || /\bhigh[-\s]?risk\b/.test(text) || /\blegacy\b/.test(text) || /\b(?:more than|over|beyond|older than)\s*24\s*months?\b/.test(text)) {
		return ["e. >24 months"];
	}

	if (/\bat least\s*1\s*year\b/.test(text) || /\b>=\s*1\s*year\b/.test(text) || /\bmore than\s*1\s*year\b/.test(text) || /\bover\s*1\s*year\b/.test(text) || /\bbeyond\s*1\s*year\b/.test(text) || /\bolder than\s*1\s*year\b/.test(text) || /\bat least\s*12\s*months?\b/.test(text) || /\b>=\s*12\s*months?\b/.test(text) || /\bmore than\s*12\s*months?\b/.test(text) || /\bover\s*12\s*months?\b/.test(text) || /\bbeyond\s*12\s*months?\b/.test(text) || /\bolder than\s*12\s*months?\b/.test(text)) {
		return ["d. 12-24 months", "e. >24 months"];
	}

	return null;
}

function buildPoAgingReply_(poNumber, bucketInfo, intentName) {
	const boldPo = "<b>PO " + poNumber + "</b>";
	const bucketLabel = bucketInfo && bucketInfo.label ? bucketInfo.label : "";
	const bucketCode = bucketInfo && bucketInfo.code ? bucketInfo.code : "";

	if (intentName === "check_po_aging_exceeded") {
		if (bucketCode === "d" || bucketCode === "e") {
			return boldPo + " is " + bucketLabel + " old. It has exceeded the standard SLA.";
		}

		return boldPo + " is " + bucketLabel + " old. It has not yet exceeded the standard SLA.";
	}

	if (intentName === "check_po_high_risk") {
		if (bucketCode === "e") {
			return boldPo + " is >24 months old. It is a high risk legacy PO.";
		}

		return boldPo + " is " + bucketLabel + " old. It is not yet a high risk PO.";
	}

	if (bucketCode === "e") {
		return boldPo + " is >24 months old. It is already a high risk legacy PO.";
	}

	return boldPo + " is " + bucketLabel + " old.";
}

function checkPoAging(entities, parsed) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["poSla"]);
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

function listPoAging(entities) {
	const rawAgeFilter = String(entities.AGE_FILTER || "").trim();
	const allowedBuckets = resolvePoSlaBucketCellsForFilter_(rawAgeFilter);
	if (!allowedBuckets || allowedBuckets.length === 0) {
		return getMissingEntityMessage("AGE_FILTER");
	}

	const dataset = getCommschedRows_(["poNumber", "poSla"]);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest COMMSCHED sheet.";
	}

	const matches = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const poSlaValue = String(row.values && row.values.poSla ? row.values.poSla : "").trim();
		const bucketInfo = getPoSlaBucketInfo_(poSlaValue);
		if (!poNumber || !bucketInfo) {
			continue;
		}

		if (allowedBuckets.indexOf(bucketInfo.cellValue) === -1) {
			continue;
		}

		matches.push({
			poNumber: poNumber,
			poSla: bucketInfo.cellValue,
			rank: bucketInfo.rank,
		});
	}

	if (matches.length === 0) {
		return "No matching POs found.";
	}

	matches.sort(function(a, b) {
		if (a.rank !== b.rank) {
			return a.rank - b.rank;
		}

		return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
	});

	const maxRowsInChat = 10;
	if (matches.length > maxRowsInChat) {
		const headers = ["PO Number", "PO SLA"];
		const csvRows = matches.map((match) => [
			match.poNumber,
			match.poSla,
		]);
		const csvContent = buildCsvContent_(headers, csvRows);
		const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
		return {
			text: "Your spreadsheet is ready!",
			download: {
				filename: "sia-response-" + timestamp + ".csv",
				content: csvContent,
				mimeType: "text/csv",
			},
		};
	}

	const lines = [
		"| PO Number | PO SLA |",
		"| --- | --- |",
	];

	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		lines.push("| " + match.poNumber + " | " + match.poSla + " |");
	}

	return lines.join("\n");
}
