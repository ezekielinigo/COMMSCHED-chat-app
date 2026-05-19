function showDidYouMean(suggestions) { // run this if confidence is < 0.9
	const items = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
	if (items.length === 0) {
		return "Sorry, I’m not sure I understood that.";
	}

	return {
		text: "Did you mean:",
		suggestions: items.map((item, index) => ({
			id: item.id || item.intent || String(index),
			label: item.label || item.matchedPhrase || "",
		})),
	};
}

function getMissingEntityMessage(entityKey) {
	const prompts = {
		PO_NUMBER: "Please provide a 10-digit PO number",
		DATE: "Please provide a date (MM/DD/YYYY)",
		YEAR: "Please provide a year",
	};

	return prompts[entityKey] || "Please provide more information";
}

function getGeminiResponse(userText, messages) {
	const CONFIDENCE_THRESHOLD = 0.5;
	const fallback = "Sorry, I’m not sure I understood that.";

	const parsed = parseInput(userText);
	if (parsed && parsed.error) {
		return parsed.error;
	}
	if (!parsed || !parsed.intent) {
		return fallback;
	}
	if (parsed.confidence < CONFIDENCE_THRESHOLD) {
		return showDidYouMean(parsed.suggestions);
	}

	const intent = INTENTS.find((i) => i.name === parsed.intent);
	if (!intent) return fallback;

	const required = intent.requiredEntities || [];
	const entities = parsed.entities || {};
	const missingRequired = required.find((key) => !entities[key]);
	if (missingRequired) {
		return getMissingEntityMessage(missingRequired);
	}

	const handlers = {
		checkPoStatus: checkPoStatus,
		checkPoGrStatus: checkPoGrStatus,
		checkPoRemainingBalance: checkPoRemainingBalance,
		checkPoLatestGrDate: checkPoLatestGrDate,
		checkPoAging: checkPoAging,
		checkPoAgingExceeded: checkPoAgingExceeded,
		checkPoAgingExceededList: checkPoAgingExceededList,
	};

	const handler = handlers[intent.handler];
	if (typeof handler !== "function") {
		return fallback;
	}

	return handler(entities);
}

function getLinksSheet_() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	if (!ss) {
		throw new Error("Cannot access the active spreadsheet.");
	}

	const linksSheet = ss.getSheetByName("LINKS");
	if (!linksSheet) {
		throw new Error('Cannot find the "LINKS" sheet.');
	}

	return linksSheet;
}

function parseDateValue_(value) {
	if (value instanceof Date && !isNaN(value.getTime())) {
		return value;
	}

	const parsed = new Date(value);
	return isNaN(parsed.getTime()) ? null : parsed;
}

function getLatestCommschedSource_() {
	const linksSheet = getLinksSheet_();
	const lastRow = linksSheet.getLastRow();
	if (lastRow < 6) {
		return null;
	}

	const dateValues = linksSheet.getRange(6, 1, lastRow - 5, 1).getValues();
	const linkValues = linksSheet.getRange(6, 2, lastRow - 5, 1).getValues();
	const richTextValues = linksSheet.getRange(6, 2, lastRow - 5, 1).getRichTextValues();

	let latest = null;
	for (let i = 0; i < dateValues.length; i += 1) {
		const rowDate = parseDateValue_(dateValues[i][0]);
		if (!rowDate) {
			continue;
		}

		const linkCell = richTextValues[i][0];
		let link = linkCell && typeof linkCell.getLinkUrl === "function" ? linkCell.getLinkUrl() : null;
		if (!link) {
			const cellValue = linkValues[i][0];
			link = String(cellValue || "").trim();
		}

		if (!link) {
			continue;
		}

		if (!latest || rowDate.getTime() > latest.date.getTime() || (rowDate.getTime() === latest.date.getTime() && i > latest.index)) {
			latest = {
				date: rowDate,
				link: link,
				index: i,
			};
		}
	}

	return latest;
}

function openSpreadsheetFromLink_(link) {
	const rawLink = String(link || "").trim();
	if (!rawLink) {
		throw new Error("Missing COMMSCHED spreadsheet link.");
	}

	const idMatch = rawLink.match(/[-\w]{25,}/);
	if (idMatch) {
		return SpreadsheetApp.openById(idMatch[0]);
	}

	return SpreadsheetApp.openByUrl(rawLink);
}

function formatCommschedSheetName_(dateValue) {
	const month = Utilities.formatDate(dateValue, Session.getScriptTimeZone(), "MMMM").toUpperCase();
	return month + " COMMSCHED_working file";
}

function formatCommschedHeaderDate_(dateValue) {
	return Utilities.formatDate(dateValue, Session.getScriptTimeZone(), "MMMM d");
}

function findHeaderColumn_(headers, exactHeader) {
	const target = normalizeHeaderText_(exactHeader);
	if (!target) return -1;

	let foundIndex = -1;
	(headers || []).forEach((header, index) => {
		if (normalizeHeaderText_(header) === target) {
			foundIndex = index;
		}
	});
	return foundIndex;
}

function normalizeHeaderText_(value) {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function getScriptCache_() {
	return CacheService.getScriptCache();
}

function getCachedJson_(key) {
	const raw = getScriptCache_().get(key);
	if (!raw) return null;

	try {
		return JSON.parse(raw);
	} catch (error) {
		return null;
	}
}

function setCachedJson_(key, value, ttlSeconds) {
	try {
		getScriptCache_().put(key, JSON.stringify(value), ttlSeconds || 900);
	} catch (error) {
		// Cache writes are best-effort only.
	}
}

function findRightmostHeaderColumnByPrefix_(headers, headerPrefix) {
	const prefix = normalizeHeaderText_(headerPrefix);
	if (!prefix) return -1;

	for (let index = (headers || []).length - 1; index >= 0; index -= 1) {
		const header = normalizeHeaderText_(headers[index]);
		if (header.indexOf(prefix) === 0) {
			return index;
		}
	}

	return -1;
}

function getCommschedLookupMeta_() {
	const cacheKey = "commsched:lookup-meta:v3";
	const cached = getCachedJson_(cacheKey);
	if (cached && cached.sourceLink && cached.sheetName && Number.isInteger(cached.poColumn) && Number.isInteger(cached.delivColumn)) {
		return cached;
	}

	const latestSource = getLatestCommschedSource_();
	if (!latestSource) {
		return null;
	}

	const workbook = openSpreadsheetFromLink_(latestSource.link);
	const sheetName = formatCommschedSheetName_(latestSource.date);
	const sheet = workbook.getSheetByName(sheetName);
	if (!sheet) {
		return null;
	}

	const headerRow = 3;
	const lastColumn = sheet.getLastColumn();
	if (lastColumn < 1) {
		return null;
	}

	const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];
	const poColumn = findHeaderColumn_(headers, "PO Number");
	const delivColumn = findRightmostHeaderColumnByPrefix_(headers, "DELIV COMPLETE?");
	if (poColumn === -1 || delivColumn === -1) {
		return null;
	}

	const meta = {
		sourceLink: latestSource.link,
		sheetName: sheetName,
		headerRow: headerRow,
		dataStartRow: headerRow + 1,
		lastColumn: lastColumn,
		poColumn: poColumn,
		delivColumn: delivColumn,
	};
	setCachedJson_(cacheKey, meta, 900);
	return meta;
}

function getCommschedGrLookupMeta_() {
	const cacheKey = "commsched:lookup-meta:gr:v2";
	const cached = getCachedJson_(cacheKey);
	if (
		cached &&
		cached.sourceLink &&
		cached.sheetName &&
		Number.isInteger(cached.poColumn) &&
		Number.isInteger(cached.currencyColumn) &&
		Number.isInteger(cached.grAmountColumn) &&
		Number.isInteger(cached.grColumn)
	) {
		return cached;
	}

	const latestSource = getLatestCommschedSource_();
	if (!latestSource) {
		return null;
	}

	const workbook = openSpreadsheetFromLink_(latestSource.link);
	const sheetName = formatCommschedSheetName_(latestSource.date);
	const sheet = workbook.getSheetByName(sheetName);
	if (!sheet) {
		return null;
	}

	const headerRow = 3;
	const lastColumn = sheet.getLastColumn();
	if (lastColumn < 1) {
		return null;
	}

	const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];
	const poColumn = findHeaderColumn_(headers, "PO Number");
	const currencyColumn = findHeaderColumn_(headers, "Currency");
	const grAmountColumn = findRightmostHeaderColumnByPrefix_(headers, "Goods Receipt (as of");
	const grColumn = findRightmostHeaderColumnByPrefix_(headers, "GR% Bucketing as of");
	if (poColumn === -1 || currencyColumn === -1 || grAmountColumn === -1 || grColumn === -1) {
		return null;
	}

	const meta = {
		sourceLink: latestSource.link,
		sheetName: sheetName,
		headerRow: headerRow,
		dataStartRow: headerRow + 1,
		lastColumn: lastColumn,
		poColumn: poColumn,
		currencyColumn: currencyColumn,
		grAmountColumn: grAmountColumn,
		grColumn: grColumn,
	};
	setCachedJson_(cacheKey, meta, 900);
	return meta;
}

function findPoRowInColumn_(sheet, poColumn, dataStartRow, lastRow, poNumber) {
	const rowCount = lastRow - dataStartRow + 1;
	if (rowCount < 1) {
		return null;
	}

	const searchRange = sheet.getRange(dataStartRow, poColumn + 1, rowCount, 1);
	const finder = searchRange.createTextFinder(String(poNumber)).matchEntireCell(true);
	const found = finder.findNext();
	if (found) {
		return {
			row: found.getRow(),
			method: "textFinder",
		};
	}

	const values = searchRange.getValues();
	const target = String(poNumber).trim();
	for (let i = 0; i < values.length; i += 1) {
		if (String(values[i][0] || "").trim() === target) {
			return {
				row: dataStartRow + i,
				method: "scan",
			};
		}
	}

	return null;
}