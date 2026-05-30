/**
 * messages.js — Bot response builders, suggestion messages, table/CSV formatting.
 *
 * - `showDidYouMean()` produces the "Did you mean:" suggestion payload sent to
 *   the React client. When called with { countError: true }, the response
 *   object carries a `countError` flag that `finalizeBotResponse_()` uses to
 *   increment EMAILS column F (NO. OF ERRORS).
 * - `buildFullQueryLabel()` resolves an intent's display phrase template from
 *   INTENTS (in intent.js) and substitutes the matched entity value, e.g.
 *   "List all POs from Huawei".
 * - `getMissingEntityMessage()` returns slot-filling prompts for VENDOR,
 *   DIVISION, PO_NUMBER, GR_NUMBER, AGE_FILTER (with inline suggestion buttons).
 * - Access-denied and not-found message helpers (`getAccessDeniedMessage_`,
 *   `getCommschedNotFoundMessage_`, etc.) are defined here so every handler
 *   uses consistent wording.
 * - `buildPoAgingReply_()` crafts the aging-specific natural-language reply.
 * - `finalizeBotResponse_()` is the post-handler hook that checks the
 *   `countError` flag and increments the error counter if set.
 * - Table/CSV builders (`buildTableResponse_`, `buildCsvContent_`, etc.)
 *   produce markdown tables with optional overflow truncation and CSV download
 *   payloads for the React client.
 * - unGR'd disambiguation helpers (`extractUnGrdSubjectText_`,
 *   `getUnGrdEntityHint_`, `buildUnGrdEntityDisambiguation_`) handle the
 *   vendor-vs-division ambiguity for checkTotalUnGrdVendor/Division intents.
 *
 * Dependencies: intent.js (INTENTS), counter.js (incrementEmailCounter_),
 *               auth.js (getEmailSheetColumnMap_).
 * Used by: routing.js (getGeminiResponse), all handler files.
 */

function showDidYouMean(suggestions, options) { // run this if confidence is < 0.9
	const items = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
	if (items.length === 0) {
		return "Sorry, I'm not sure I understood that.";
	}

	return {
		text: "Did you mean:",
		suggestions: items.map((item, index) => ({
			id: item.id || item.intent || String(index),
			label: item.label || item.matchedPhrase || "",
			displayText: item.displayText || item.label || item.matchedPhrase || "",
			query: item.query || item.sendText || "",
			entityType: item.entityType || "",
		})),
		countError: Boolean(options && options.countError),
	};
}

function buildFullQueryLabel(intentName, entityValue) {
	if (!intentName) return String(entityValue || "");
	const intent = (typeof INTENTS !== "undefined" && Array.isArray(INTENTS)) ? INTENTS.find(function(i) { return i && i.name === intentName; }) : null;
	let template = null;
	if (intent && Array.isArray(intent.phrases) && intent.phrases.length > 0) {
		const showPhrase = intent.phrases.find(function(p) { return /^show\b/i.test(String(p || "")); });
		template = showPhrase || intent.phrases[0];
	}
	if (!template) {
		if (intentName === "list_po_vendor") template = "List all POs from X";
		else if (intentName && intentName.indexOf("list") === 0) template = "List all POs from X";
		else template = String(entityValue || "");
	}

	let label = String(template || "").replace(/\bX\b/gi, String(entityValue || "")).replace(/\s+/g, " ").trim();
	if (!label) label = String(entityValue || "");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function getMissingEntityMessage(entityKey) {
	const prompts = {
		VENDOR: "Please provide a vendor name",
		DIVISION: "Please provide a division name",
		PO_NUMBER: "Please provide a 10-digit PO number",
		GR_NUMBER: "Please provide a GR ticket case number",
		DATE: "Please provide a date (MM/DD/YYYY)",
		YEAR: "Please provide a year",
	};

	if (entityKey === "AGE_FILTER") {
		return {
			text: "Please provide an aging filter:",
			hideSuggestionHeader: true,
			suggestions: [
				{ id: "age-filter-1", label: "<6 months" },
				{ id: "age-filter-2", label: "6-9 months" },
				{ id: "age-filter-3", label: "9-12 months" },
				{ id: "age-filter-4", label: "12-24 months" },
				{ id: "age-filter-5", label: ">24 months" },
			],
		};
	}

	return prompts[entityKey] || "Please provide more information";
}

function getAccessDeniedMessage_() {
	return "You do not have access to this chatbot, please contact an admin.";
}

function getCommschedDivisionDeniedMessage_(poNumber) {
	return "Your division does not have access to <b>PO " + poNumber + "</b>.";
}

function getCommschedNotFoundMessage_(poNumber) {
	return "Cannot find <b>PO " + poNumber + "</b>. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
}

function getCommschedNoDataMessage_(poNumber) {
	return "No data found for <b>PO " + poNumber + "</b>.";
}

function getGrTicketNotFoundMessage_(grNumber) {
	return "Cannot find <b>GR Ticket " + grNumber + "</b>. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
}

function getGrTicketNoDataMessage_(grNumber) {
	return "No data found for <b>GR Ticket " + grNumber + "</b>.";
}

function buildPoAgingReply_(poNumber, bucketInfo, intentName) {
	const boldPo = "<b>PO " + poNumber + "</b>";
	const bucketLabel = bucketInfo && bucketInfo.label ? bucketInfo.label : "";
	const bucketCode = bucketInfo && bucketInfo.code ? bucketInfo.code : "";

	if (intentName === "check_po_aging_exceeded") {
		if (bucketCode === "d" || bucketCode === "e") {
			return boldPo + " is " + bucketLabel + " old from the PO creation date. It has exceeded the standard SLA.";
		}

		return boldPo + " is " + bucketLabel + " old from the PO creation date. It has not yet exceeded the standard SLA.";
	}

	if (intentName === "check_po_high_risk") {
		if (bucketCode === "e") {
			return boldPo + " is >24 months old from the PO creation date. It is a high risk legacy PO.";
		}

		return boldPo + " is " + bucketLabel + " old from the PO creation date. It is not yet a high risk PO.";
	}

	if (bucketCode === "e") {
		return boldPo + " is >24 months old from the PO creation date. It is already a high risk legacy PO.";
	}

	return boldPo + " is " + bucketLabel + " old from the PO creation date.";
}

function finalizeBotResponse_(response, userProfile) {
	if (
		response &&
		typeof response === "object" &&
		response.countError &&
		userProfile &&
		userProfile.rowNumber
	) {
		const emailColumns = userProfile.emailColumns || getEmailSheetColumnMap_();
		const errorColumn = typeof emailColumns.errors === "number" ? emailColumns.errors + 1 : 6;
		incrementEmailCounter_(userProfile.rowNumber, errorColumn, 1);
	}

	return response;
}

/* ---- Table / CSV builders ---- */

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

function buildMarkdownTable_(headers, rows) {
	const headerCells = Array.isArray(headers) ? headers : [];
	const dataRows = Array.isArray(rows) ? rows : [];
	const lines = [];

	lines.push("| " + headerCells.map(function(header) {
		return String(header || "");
	}).join(" | ") + " |");
	lines.push("| " + headerCells.map(function() {
		return "---";
	}).join(" | ") + " |");

	for (let i = 0; i < dataRows.length; i += 1) {
		const row = Array.isArray(dataRows[i]) ? dataRows[i] : [];
		lines.push("| " + headerCells.map(function(_, index) {
			return String(row[index] === undefined || row[index] === null ? "" : row[index]);
		}).join(" | ") + " |");
	}

	return lines.join("\n");
}

function buildOverflowTableRow_(columnCount, summaryText) {
	const safeColumnCount = Math.max(1, Number(columnCount) || 0);
	const row = [];
	for (let i = 0; i < safeColumnCount; i += 1) {
		row.push(i === 0 ? String(summaryText || "") : "");
	}
	return row;
}

function buildTableResponse_(headers, rows, options) {
	const config = options || {};
	const allRows = Array.isArray(rows) ? rows : [];
	const headerCells = Array.isArray(headers) ? headers : [];
	const maxDisplayRows = Number.isInteger(config.maxDisplayRows) ? config.maxDisplayRows : 10;
	const includeCsvDownload = Boolean(config.includeCsvDownload);
	const csvFilename = String(config.csvFilename || "sia-response.csv");
	const hasOverflow = allRows.length > maxDisplayRows;
	let visibleRows = allRows.slice(0, maxDisplayRows);

	if (hasOverflow && maxDisplayRows > 0 && config.showOverflowRow !== false) {
		const visibleDataRows = Math.max(0, maxDisplayRows - 1);
		visibleRows = allRows.slice(0, visibleDataRows).concat([
			buildOverflowTableRow_(headerCells.length, "+" + (allRows.length - visibleDataRows) + " more rows"),
		]);
	}

	const tableText = buildMarkdownTable_(headerCells, visibleRows);
	if (!hasOverflow || !includeCsvDownload) {
		return tableText;
	}

	const csvRows = allRows.map(function(row) {
		return Array.isArray(row) ? row : [];
	});
	const csvContent = buildCsvContent_(headerCells, csvRows);
	return {
		text: tableText,
		download: {
			filename: csvFilename,
			content: csvContent,
			mimeType: "text/csv",
		},
	};
}

/* ---- unGR'd entity disambiguation ---- */

function extractUnGrdSubjectText_(userText) {
	const raw = String(userText || "").trim();
	if (!raw) return "";
	const patterns = [
		/^what is the total ungrd(?:'s)? exposure for\s+(.+)$/i,
		/^what is the total ungrd(?:'s)? for\s+(.+)$/i,
		/^total ungrd(?:'s)? exposure for\s+(.+)$/i,
		/^total ungrd(?:'s)? for\s+(.+)$/i,
	];

	for (let i = 0; i < patterns.length; i += 1) {
		const match = raw.match(patterns[i]);
		if (match && match[1]) {
			return String(match[1]).replace(/[?!.]+$/g, "").trim();
		}
	}

	const forMatch = raw.match(/\bfor\s+(.+)$/i);
	if (forMatch && forMatch[1]) {
		return String(forMatch[1]).replace(/[?!.]+$/g, "").trim();
	}

	return raw.replace(/[?!.]+$/g, "").trim();
}

function getUnGrdEntityHint_(userText) {
	const text = normalizeText(userText);
	if (/\bdivision\b/.test(text)) return "division";
	if (/\bvendor\b/.test(text)) return "vendor";
	return "";
}

function buildUnGrdEntityDisambiguation_(userText) {
	const subjectText = extractUnGrdSubjectText_(userText);
	if (!subjectText) {
		return showDidYouMean([]);
	}

	return {
		text: "Did you mean:",
		suggestions: [
			{
				id: "ungrd-vendor",
				label: subjectText + " is a <b>vendor</b>",
				displayText: subjectText + " is a vendor",
				query: String(userText || "").trim(),
				entityType: "vendor",
			},
			{
				id: "ungrd-division",
				label: subjectText + " is a <b>division</b>",
				displayText: subjectText + " is a division",
				query: String(userText || "").trim(),
				entityType: "division",
			},
		],
	};
}
