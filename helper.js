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
		AGE_FILTER: `
		Please provide an aging filter:
			- <6 months
			- 6-9 months
			- 9-12 months
			- 12-24 months
			- >24 months
		`,
	};

	return prompts[entityKey] || "Please provide more information";
}

function getIntentInfo(userText) {
	const parsed = parseInput(userText);
	if (!parsed || !parsed.intent) {
		return {
			intent: null,
			isList: false,
			hasRequiredEntities: false,
			missingEntity: null,
		};
	}

	const intent = INTENTS.find((i) => i.name === parsed.intent);
	const required = intent && intent.requiredEntities ? intent.requiredEntities : [];
	const entities = parsed.entities || {};
	const missingRequired = required.find((key) => !entities[key]) || null;
	const isList = intent && String(intent.responseType || "").toLowerCase() === "list";

	return {
		intent: parsed.intent,
		isList: Boolean(isList),
		hasRequiredEntities: !missingRequired,
		missingEntity: missingRequired,
	};
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
		listPoAging: listPoAging,
	};

	const handler = handlers[intent.handler];
	if (typeof handler !== "function") {
		return fallback;
	}

	return handler(entities, parsed);
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

	const text = String(value || "").trim();
	if (!text) {
		return null;
	}

	const explicitFormats = [
		/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/,
		/^\s*(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\s*$/,
	];

	for (let i = 0; i < explicitFormats.length; i += 1) {
		const match = text.match(explicitFormats[i]);
		if (!match) {
			continue;
		}

		const month = Number(match[1]) - 1;
		const day = Number(match[2]);
		let year = Number(match[3]);
		if (match[3].length === 2) {
			year += 2000;
		}

		const parsedExplicit = new Date(year, month, day);
		if (
			!isNaN(parsedExplicit.getTime()) &&
			parsedExplicit.getFullYear() === year &&
			parsedExplicit.getMonth() === month &&
			parsedExplicit.getDate() === day
		) {
			return parsedExplicit;
		}
	}

	const parsed = new Date(text);
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

function formatCommschedSheetName_(dateValue, monthFormat) {
	const month = Utilities.formatDate(dateValue, Session.getScriptTimeZone(), monthFormat || "MMMM").toUpperCase();
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

function normalizeRequestedFields_(requestedFields) {
	const input = Array.isArray(requestedFields)
		? requestedFields
		: requestedFields
			? [requestedFields]
			: [];
	const seen = {};
	const normalized = [];
	for (let i = 0; i < input.length; i += 1) {
		const fieldKey = String(input[i] || "").trim();
		if (!fieldKey || seen[fieldKey]) {
			continue;
		}
		seen[fieldKey] = true;
		normalized.push(fieldKey);
	}
	return normalized;
}

function isVisibleSheet_(sheet) {
	if (!sheet) return false;
	try {
		if (typeof sheet.isSheetHidden === "function") {
			return !sheet.isSheetHidden();
		}
	} catch (error) {
		// If visibility cannot be determined, assume the sheet is usable.
	}
	return true;
}

function getSpreadsheetLinkFromCell_(range) {
	if (!range) return "";

	let link = null;
	try {
		const richText = typeof range.getRichTextValue === "function" ? range.getRichTextValue() : null;
		link = richText && typeof richText.getLinkUrl === "function" ? richText.getLinkUrl() : null;
	} catch (error) {
		link = null;
	}

	if (!link) {
		try {
			link = String((typeof range.getDisplayValue === "function" ? range.getDisplayValue() : range.getValue()) || "").trim();
		} catch (error) {
			link = "";
		}
	}

	return String(link || "").trim();
}

function getSourcesFromLinksRange_(startRow, dateColumn, linkColumn) {
	const linksSheet = getLinksSheet_();
	const lastRow = linksSheet.getLastRow();
	if (lastRow < startRow) {
		return [];
	}

	const rowCount = lastRow - startRow + 1;
	const dateValues = linksSheet.getRange(startRow, dateColumn, rowCount, 1).getValues();
	const linkRange = linksSheet.getRange(startRow, linkColumn, rowCount, 1);
	const linkValues = linkRange.getValues();
	const richTextValues = linkRange.getRichTextValues();

	const sources = [];
	for (let i = 0; i < rowCount; i += 1) {
		const rowDate = parseDateValue_(dateValues[i][0]);
		if (!rowDate) {
			continue;
		}

		const linkCell = richTextValues[i][0];
		let link = linkCell && typeof linkCell.getLinkUrl === "function" ? linkCell.getLinkUrl() : null;
		if (!link) {
			link = String(linkValues[i][0] || "").trim();
		}

		if (!link) {
			continue;
		}

		sources.push({
			date: rowDate,
			link: link,
			index: i,
			rowNumber: startRow + i,
		});
	}

	return sources;
}

function getSourceFromLinksCell_(cellA1) {
	const linksSheet = getLinksSheet_();
	const link = getSpreadsheetLinkFromCell_(linksSheet.getRange(cellA1));
	if (!link) {
		return null;
	}

	return {
		date: null,
		link: link,
		index: null,
		rowNumber: null,
		sourceType: "cell",
		sourceCell: cellA1,
	};
}

function getCommschedSheetNameCandidates_(dateValue) {
	return [
		formatCommschedSheetName_(dateValue, "MMM"),
		formatCommschedSheetName_(dateValue, "MMMM"),
	];
}

function resolveCommschedSheet_(workbook, sourceInfo) {
	if (!sourceInfo || !(sourceInfo.date instanceof Date)) {
		return null;
	}

	const candidates = getCommschedSheetNameCandidates_(sourceInfo.date);
	return findWorksheetByCandidates_(workbook, candidates, /commsched_working file/i);
}

function resolveRfpSheet_(workbook) {
	return findWorksheetByCandidates_(workbook, ["Form Responses 1"], /^Form Responses 1$/i);
}

function resolveGrSheet_(workbook) {
	return findWorksheetByCandidates_(workbook, ["Form Responses", "Form Responses 1"], /^Form Responses( 1)?$/i);
}

const DATASET_SPECS = {
	COMMSCHED: {
		sourceResolver: function(options) {
			return getCommschedSource_(options);
		},
		sheetResolver: resolveCommschedSheet_,
		headerRow: 3,
		dataStartRow: 4,
		cacheTtlSeconds: 900,
		fields: {
			poNumber: { match: "exact", value: "PO Number" },
			poDate: { match: "exact", value: "PO Date" },
			poSla: { match: "exact", value: "PO SLA" },
			currency: { match: "exact", value: "Currency" },
			deliveryComplete: { match: "rightmostPrefix", value: "DELIV COMPLETE?" },
			latestGrDate: { match: "rightmostPrefix", value: "Latest GR Date as of" },
			goodsReceiptAmount: { match: "rightmostPrefix", value: "Goods Receipt (as of" },
			grBucket: { match: "rightmostPrefix", value: "GR% Bucketing as of" },
			remainingBalance: { match: "rightmostPrefix", value: "To be GRed (PO Amount - GR) (as of" },
		},
		fieldPropertyNames: {
			poNumber: "poColumn",
			poDate: "poDateColumn",
			poSla: "poSlaColumn",
			currency: "currencyColumn",
			deliveryComplete: "delivColumn",
			latestGrDate: "latestGrDateColumn",
			goodsReceiptAmount: "grAmountColumn",
			grBucket: "grColumn",
			remainingBalance: "remainingBalanceColumn",
		},
	},
	RFP: {
		sourceResolver: function() {
			return getSourceFromLinksCell_("B2");
		},
		sheetResolver: resolveRfpSheet_,
		headerRow: 1,
		dataStartRow: 2,
		cacheTtlSeconds: 900,
		fields: {},
		fieldPropertyNames: {},
	},
	GR: {
		sourceResolver: function() {
			return getSourceFromLinksCell_("B4");
		},
		sheetResolver: resolveGrSheet_,
		headerRow: 1,
		dataStartRow: 2,
		cacheTtlSeconds: 900,
		fields: {},
		fieldPropertyNames: {},
	},
};

function compareSourceCandidates_(a, b) {
	const aTime = a && a.date instanceof Date ? a.date.getTime() : -Infinity;
	const bTime = b && b.date instanceof Date ? b.date.getTime() : -Infinity;
	if (aTime !== bTime) {
		return aTime - bTime;
	}

	const aRank = typeof (a && a.rowNumber) === "number" ? a.rowNumber : (typeof (a && a.index) === "number" ? a.index : -1);
	const bRank = typeof (b && b.rowNumber) === "number" ? b.rowNumber : (typeof (b && b.index) === "number" ? b.index : -1);
	return aRank - bRank;
}

function pickSourceFromCandidates_(sources, referenceDate) {
	const sorted = (sources || []).slice().sort(compareSourceCandidates_);
	if (sorted.length === 0) {
		return null;
	}

	const parsedReferenceDate = parseDateValue_(referenceDate);
	if (!parsedReferenceDate) {
		return sorted[sorted.length - 1];
	}

	const referenceTime = parsedReferenceDate.getTime();
	let chosenDateTime = null;
	for (let i = 0; i < sorted.length; i += 1) {
		const sourceTime = sorted[i].date.getTime();
		if (sourceTime >= referenceTime) {
			chosenDateTime = sourceTime;
			break;
		}
	}

	if (chosenDateTime === null) {
		return sorted[sorted.length - 1];
	}

	for (let i = sorted.length - 1; i >= 0; i -= 1) {
		if (sorted[i].date.getTime() === chosenDateTime) {
			return sorted[i];
		}
	}

	return sorted[sorted.length - 1];
}

function getCommschedSources_() {
	return getSourcesFromLinksRange_(6, 1, 2);
}

function getCommschedSource_(options) {
	return pickSourceFromCandidates_(getCommschedSources_(), options && options.referenceDate);
}

function getLatestCommschedSource_() {
	return getCommschedSource_();
}

function findWorksheetByCandidates_(workbook, candidates, fallbackPattern) {
	if (!workbook) {
		return null;
	}

	const candidateList = Array.isArray(candidates) ? candidates : [candidates];
	for (let i = 0; i < candidateList.length; i += 1) {
		const candidate = String(candidateList[i] || "").trim();
		if (!candidate) {
			continue;
		}

		const sheet = workbook.getSheetByName(candidate);
		if (sheet && isVisibleSheet_(sheet)) {
			return sheet;
		}
	}

	if (fallbackPattern) {
		const patternFlags = fallbackPattern instanceof RegExp ? String(fallbackPattern.flags || "").replace(/g/g, "") : "i";
		const pattern = fallbackPattern instanceof RegExp ? new RegExp(fallbackPattern.source, patternFlags) : new RegExp(String(fallbackPattern || ""), "i");
		const sheets = workbook.getSheets();
		for (let i = 0; i < sheets.length; i += 1) {
			const sheet = sheets[i];
			if (!sheet || !isVisibleSheet_(sheet)) {
				continue;
			}

			if (pattern.test(sheet.getName())) {
				return sheet;
			}
		}
	}

	return null;
}

function resolveHeaderColumnByRule_(headers, rule) {
	if (!rule) {
		return -1;
	}

	const matchType = String(rule.match || "exact").toLowerCase();
	if (matchType === "exact") {
		return findHeaderColumn_(headers, rule.value);
	}

	if (matchType === "rightmostprefix") {
		return findRightmostHeaderColumnByPrefix_(headers, rule.value);
	}

	return -1;
}

function resolveRequestedFieldColumns_(headers, fieldSpecs, requestedFieldKeys) {
	const columns = {};
	const fieldKeys = normalizeRequestedFields_(requestedFieldKeys);
	for (let i = 0; i < fieldKeys.length; i += 1) {
		const fieldKey = fieldKeys[i];
		const fieldSpec = fieldSpecs ? fieldSpecs[fieldKey] : null;
		if (!fieldSpec) {
			return null;
		}

		const columnIndex = resolveHeaderColumnByRule_(headers, fieldSpec);
		if (columnIndex === -1) {
			return null;
		}

		columns[fieldKey] = columnIndex;
	}

	return columns;
}

function buildDatasetMetaCacheKey_(datasetKey, sourceInfo, sheetName, requestedFieldKeys) {
	const sourceLink = String(sourceInfo && sourceInfo.link ? sourceInfo.link : "").trim();
	const sourceDateMs = sourceInfo && sourceInfo.date instanceof Date ? sourceInfo.date.getTime() : "";
	const fieldKey = normalizeRequestedFields_(requestedFieldKeys).slice().sort().join(",");
	return [datasetKey, sourceLink, String(sourceDateMs), String(sheetName || ""), fieldKey].join(":");
}

function getDatasetMeta_(datasetKey, requestedFieldKeys, options) {
	const spec = DATASET_SPECS[datasetKey];
	if (!spec) {
		return null;
	}

	const normalizedRequestedFields = normalizeRequestedFields_(requestedFieldKeys);
	const fieldKeys = normalizedRequestedFields.length > 0 ? normalizedRequestedFields : Object.keys(spec.fields || {});
	const sourceInfo = spec.sourceResolver ? spec.sourceResolver(options || {}) : null;
	if (!sourceInfo || !sourceInfo.link) {
		return null;
	}

	const workbook = openSpreadsheetFromLink_(sourceInfo.link);
	const sheet = spec.sheetResolver ? spec.sheetResolver(workbook, sourceInfo, options || {}) : null;
	if (!sheet) {
		return null;
	}

	const headerRow = Number.isInteger(spec.headerRow) ? spec.headerRow : 1;
	const lastColumn = sheet.getLastColumn();
	if (lastColumn < 1) {
		return null;
	}

	const cacheKey = buildDatasetMetaCacheKey_(datasetKey, sourceInfo, sheet.getName(), fieldKeys);
	const cached = getCachedJson_(cacheKey);
	if (cached && cached.sourceLink && cached.sheetName && Number.isInteger(cached.headerRow) && Number.isInteger(cached.dataStartRow) && Number.isInteger(cached.lastColumn)) {
		return cached;
	}

	const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0] || [];
	const fieldColumns = resolveRequestedFieldColumns_(headers, spec.fields || {}, fieldKeys);
	if (fieldColumns === null) {
		return null;
	}

	const meta = {
		dataset: datasetKey,
		sourceLink: sourceInfo.link,
		sourceDateMs: sourceInfo.date instanceof Date ? sourceInfo.date.getTime() : null,
		sheetName: sheet.getName(),
		headerRow: headerRow,
		dataStartRow: Number.isInteger(spec.dataStartRow) ? spec.dataStartRow : headerRow + 1,
		lastColumn: lastColumn,
		headers: headers,
		requestedFields: fieldKeys,
		fieldColumns: fieldColumns,
	};

	const aliasMap = spec.fieldPropertyNames || {};
	Object.keys(fieldColumns).forEach(function(fieldKey) {
		const alias = aliasMap[fieldKey];
		if (alias) {
			meta[alias] = fieldColumns[fieldKey];
		}
	});

	setCachedJson_(cacheKey, meta, spec.cacheTtlSeconds || 900);
	return meta;
}

function getCommschedMeta_(requestedFieldKeys, options) {
	return getDatasetMeta_("COMMSCHED", requestedFieldKeys, options);
}

function getDatasetRowsByField_(datasetKey, requestedFieldKeys, options) {
	const meta = getDatasetMeta_(datasetKey, requestedFieldKeys, options);
	if (!meta) {
		return null;
	}

	const workbook = openSpreadsheetFromLink_(meta.sourceLink);
	const sheet = workbook.getSheetByName(meta.sheetName);
	if (!sheet) {
		return null;
	}

	const lastRow = sheet.getLastRow();
	if (lastRow <= meta.headerRow) {
		return {
			meta: meta,
			rows: [],
		};
	}

	const rowCount = lastRow - meta.dataStartRow + 1;
	if (rowCount < 1) {
		return {
			meta: meta,
			rows: [],
		};
	}

	const range = sheet.getRange(meta.dataStartRow, 1, rowCount, meta.lastColumn);
	const rawRows = range.getValues();
	const displayRows = range.getDisplayValues();
	const fieldKeys = normalizeRequestedFields_(meta.requestedFields || requestedFieldKeys);
	const rows = [];

	for (let i = 0; i < rowCount; i += 1) {
		const rawRow = rawRows[i] || [];
		const displayRow = displayRows[i] || [];
		const row = {
			rowNumber: meta.dataStartRow + i,
			values: {},
			rawValues: {},
		};

		for (let j = 0; j < fieldKeys.length; j += 1) {
			const fieldKey = fieldKeys[j];
			const columnIndex = meta.fieldColumns[fieldKey];
			const hasColumn = typeof columnIndex === "number" && columnIndex >= 0;
			row.values[fieldKey] = hasColumn ? String(displayRow[columnIndex] || "").trim() : "";
			row.rawValues[fieldKey] = hasColumn ? rawRow[columnIndex] : "";
		}

		rows.push(row);
	}

	return {
		meta: meta,
		rows: rows,
	};
}

function getCommschedRows_(requestedFieldKeys, options) {
	return getDatasetRowsByField_("COMMSCHED", requestedFieldKeys, options);
}

function getRfpMeta_(requestedFieldKeys, options) {
	return getDatasetMeta_("RFP", requestedFieldKeys, options);
}

function getGrMeta_(requestedFieldKeys, options) {
	return getDatasetMeta_("GR", requestedFieldKeys, options);
}

function getCommschedLookupMeta_(options) {
	return getCommschedMeta_(["poNumber", "deliveryComplete"], options);
}

function getCommschedGrLookupMeta_(options) {
	return getCommschedMeta_(["poNumber", "currency", "goodsReceiptAmount", "grBucket"], options);
}

function getCommschedRemainingBalanceLookupMeta_(options) {
	return getCommschedMeta_(["poNumber", "currency", "remainingBalance"], options);
}

function lookupDatasetRowByField_(datasetKey, lookupFieldKey, lookupValue, requestedFieldKeys, options) {
	const normalizedRequestedFields = normalizeRequestedFields_(requestedFieldKeys);
	const meta = getDatasetMeta_(datasetKey, [lookupFieldKey].concat(normalizedRequestedFields), options);
	if (!meta) {
		return null;
	}

	const workbook = openSpreadsheetFromLink_(meta.sourceLink);
	const sheet = workbook.getSheetByName(meta.sheetName);
	if (!sheet) {
		return null;
	}

	const lastRow = sheet.getLastRow();
	if (lastRow <= meta.headerRow) {
		return {
			found: false,
			meta: meta,
			match: null,
			rowValues: [],
			values: {},
		};
	}

	const lookupColumn = meta.fieldColumns[lookupFieldKey];
	if (typeof lookupColumn !== "number" || lookupColumn < 0) {
		return null;
	}

	const match = findExactMatchRowInColumn_(sheet, lookupColumn, meta.dataStartRow, lastRow, lookupValue);
	if (!match) {
		return {
			found: false,
			meta: meta,
			match: null,
			rowValues: [],
			values: {},
		};
	}

	const rowValues = sheet.getRange(match.row, 1, 1, meta.lastColumn).getDisplayValues()[0] || [];
	const values = {};
	for (let i = 0; i < normalizedRequestedFields.length; i += 1) {
		const fieldKey = normalizedRequestedFields[i];
		const columnIndex = meta.fieldColumns[fieldKey];
		values[fieldKey] = typeof columnIndex === "number" && columnIndex >= 0 ? rowValues[columnIndex] : "";
	}

	return {
		found: true,
		meta: meta,
		match: match,
		rowValues: rowValues,
		values: values,
	};
}

function lookupCommschedRowByField_(lookupFieldKey, lookupValue, requestedFieldKeys, options) {
	return lookupDatasetRowByField_("COMMSCHED", lookupFieldKey, lookupValue, requestedFieldKeys, options);
}

function lookupCommschedPoRow_(poNumber, requestedFieldKeys, options) {
	return lookupCommschedRowByField_("poNumber", poNumber, requestedFieldKeys, options);
}

function lookupRfpRowByField_(lookupFieldKey, lookupValue, requestedFieldKeys, options) {
	return lookupDatasetRowByField_("RFP", lookupFieldKey, lookupValue, requestedFieldKeys, options);
}

function lookupGrRowByField_(lookupFieldKey, lookupValue, requestedFieldKeys, options) {
	return lookupDatasetRowByField_("GR", lookupFieldKey, lookupValue, requestedFieldKeys, options);
}

function findExactMatchRowInColumn_(sheet, columnIndex, dataStartRow, lastRow, targetValue) {
	if (!sheet || typeof columnIndex !== "number" || columnIndex < 0) {
		return null;
	}

	const rowCount = lastRow - dataStartRow + 1;
	if (rowCount < 1) {
		return null;
	}

	const searchRange = sheet.getRange(dataStartRow, columnIndex + 1, rowCount, 1);
	const finder = searchRange.createTextFinder(String(targetValue)).matchEntireCell(true);
	const found = finder.findNext();
	if (found) {
		return {
			row: found.getRow(),
			method: "textFinder",
		};
	}

	const values = searchRange.getValues();
	const target = String(targetValue).trim();
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

function findPoRowInColumn_(sheet, poColumn, dataStartRow, lastRow, poNumber) {
	return findExactMatchRowInColumn_(sheet, poColumn, dataStartRow, lastRow, poNumber);
}