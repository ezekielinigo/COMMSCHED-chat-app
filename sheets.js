/**
 * sheets.js — Spreadsheet resolution, worksheet discovery, header lookup,
 *            dataset meta retrieval, and row lookups.
 *
 * ** LINKS sheet **
 * - `getLinksSheet_()` returns the "LINKS" worksheet. B2 = RFP link, B4 = GR
 *   link, B6+ = COMMSCHED links with corresponding dates in A6+.
 * - `getCommschedSource_(options)` picks the right COMMSCHED source row from
 *   LINKS using `pickSourceFromCandidates_()`, which sorts sources by date and
 *   selects the one whose date ≥ the reference date (default: latest).
 *
 * ** Worksheet discovery **
 * - `resolveCommschedSheet_()` expects "{MONTH} COMMSCHED_working file" naming;
 *   `resolveRfpSheet_()` uses header lookup for "Division per Proponent Name:";
 *   `resolveGrSheet_()` tries "Form Responses" / "Form Responses 1" first.
 * - All resolvers fall back to `findWorksheetByCandidates_()` with a regex
 *   pattern and `findFirstVisibleSheet_()` as last resort.
 *
 * ** Header resolution **
 * - `findHeaderColumn_()` does exact normalized header matching.
 * - `findRightmostHeaderColumnByPrefix_()` scans right-to-left for dynamic
 *   columns whose names include an "as of" date suffix.
 * - `resolveHeaderColumnByRule_()` dispatches between exact and rightmostPrefix.
 *
 * ** DATASET_SPECS **
 * - The three datasets (COMMSCHED, RFP, GR) are defined here with their
 *   source resolvers, sheet resolvers, header rows, field definitions
 *   (exact vs rightmostPrefix), and field property name aliases.
 *
 * ** Dataset meta & row lookups **
 * - `getDatasetMeta_()` resolves headers, builds a cache key, and returns a
 *   meta object with column indices for every requested field.
 * - `getDatasetRowsByField_()` reads all data rows from the resolved sheet,
 *   applies division filtering, and returns { meta, rows[] }.
 * - `lookupDatasetRowByField_()` looks up a single row by exact match on a
 *   lookup field (e.g. PO Number), with division-access enforcement.
 * - `lookupCommschedPoRow_()` and `lookupGrTicketRow_()` are thin wrappers.
 * - `findExactMatchRowInColumn_()` tries TextFinder first, then falls back to
 *   a linear scan.
 *
 * Dependencies: auth.js (rowMatchesUserDivision_, resolveDatasetUserProfile_),
 *               division.js, messages.js (getCommschedDivisionDeniedMessage_).
 * Used by: routing.js (via handlers), all handler files.
 */

/* ---- LINKS sheet & link resolution ---- */

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

/* ---- Date / sheet-name helpers ---- */

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

/* ---- Header lookup helpers ---- */

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
		.replace(/\u00A0/g, " ")
		.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`'']/g, "'")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
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

/* ---- Cache helpers ---- */

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

/* ---- General sheet utilities ---- */

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

/* ---- Worksheet resolution ---- */

function resolveCommschedSheet_(workbook, sourceInfo) {
	if (!sourceInfo || !(sourceInfo.date instanceof Date)) {
		return null;
	}

	const candidates = [
		formatCommschedSheetName_(sourceInfo.date, "MMM"),
		formatCommschedSheetName_(sourceInfo.date, "MMMM"),
	];
	return findWorksheetByCandidates_(workbook, candidates, /commsched_working file/i);
}

function findFirstVisibleSheet_(workbook) {
	if (!workbook) {
		return null;
	}

	const sheets = workbook.getSheets();
	for (let i = 0; i < sheets.length; i += 1) {
		const sheet = sheets[i];
		if (sheet && isVisibleSheet_(sheet)) {
			return sheet;
		}
	}

	return null;
}

function resolveSheetByHeader_(workbook, headerRow, headerName) {
	if (!workbook) {
		return null;
	}

	const sheets = workbook.getSheets();
	for (let i = 0; i < sheets.length; i += 1) {
		const sheet = sheets[i];
		if (!sheet || !isVisibleSheet_(sheet)) {
			continue;
		}

		const lastColumn = sheet.getLastColumn();
		if (lastColumn < 1) {
			continue;
		}

		const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0] || [];
		if (findHeaderColumn_(headers, headerName) !== -1) {
			return sheet;
		}
	}

	return null;
}

function resolveRfpSheet_(workbook) {
	return resolveSheetByHeader_(workbook, 1, "Division per Proponent Name:") || findFirstVisibleSheet_(workbook);
}

function resolveGrSheet_(workbook) {
	return findWorksheetByCandidates_(workbook, ["Form Responses", "Form Responses 1"], /form responses/i)
		|| resolveSheetByHeader_(workbook, 1, "Case No")
		|| resolveSheetByHeader_(workbook, 1, "GR Stages:")
		|| findFirstVisibleSheet_(workbook);
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

/* ---- COMMSCHED source selection ---- */

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

function getCommschedSource_(options) {
	return pickSourceFromCandidates_(getSourcesFromLinksRange_(6, 1, 2), options && options.referenceDate);
}

function getLatestCommschedSource_() {
	return getCommschedSource_();
}

/* ---- DATASET_SPECS: Three data sources ---- */

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
			vendor: { match: "exact", value: "Vendor's Name" },
			division: { match: "exact", value: "Division" },
			project: { match: "exact", value: "Project" },
			poNumber: { match: "exact", value: "PO Number" },
			poDate: { match: "exact", value: "PO Date" },
			poSla: { match: "exact", value: "PO SLA" },
			currency: { match: "exact", value: "Currency" },
			poAmount: { match: "exact", value: "PO Amount" },
			poAmountUsdK: { match: "rightmostPrefix", value: "PO Amount (in USD" },
			downpaymentDp: { match: "rightmostPrefix", value: "Downpayment (DP) in USD" },
			poType: { match: "exact", value: "PO Type" },
			proponent: { match: "exact", value: "Proponent" },
			deliveryComplete: { match: "rightmostPrefix", value: "DELIV COMPLETE?" },
			latestGrDate: { match: "rightmostPrefix", value: "Latest GR Date as of" },
			goodsReceiptAmount: { match: "rightmostPrefix", value: "Goods Receipt (as of" },
			ungrdUsd: { match: "rightmostPrefix", value: "unGRd in USD (as of" },
			grBucket: { match: "rightmostPrefix", value: "GR% Bucketing as of" },
			remainingBalance: { match: "rightmostPrefix", value: "To be GRed (PO Amount - GR) (as of" },
		},
		fieldPropertyNames: {
			vendor: "vendorColumn",
			division: "divisionColumn",
			project: "projectColumn",
			poNumber: "poColumn",
			poDate: "poDateColumn",
			poSla: "poSlaColumn",
			currency: "currencyColumn",
			poAmount: "poAmountColumn",
			poAmountUsdK: "poAmountUsdKColumn",
			downpaymentDp: "downpaymentDpColumn",
			poType: "poTypeColumn",
			proponent: "proponentColumn",
			deliveryComplete: "delivColumn",
			latestGrDate: "latestGrDateColumn",
			goodsReceiptAmount: "grAmountColumn",
			ungrdUsd: "ungrdUsdColumn",
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
		fields: {
			division: { match: "exact", value: "Division per Proponent Name:" },
		},
		fieldPropertyNames: {
			division: "divisionColumn",
		},
	},
	GR: {
		sourceResolver: function() {
			return getSourceFromLinksCell_("B4");
		},
		sheetResolver: resolveGrSheet_,
		headerRow: 1,
		dataStartRow: 2,
		cacheTtlSeconds: 900,
		fields: {
			caseNo: { match: "exact", value: "Case No" },
			grStages: { match: "exact", value: "GR Stages:" },
			dateSubmitted: { match: "exact", value: "Date Submitted:" },
			poNumber: { match: "exact", value: "PO Number:" },
		},
		fieldPropertyNames: {
			caseNo: "caseNoColumn",
			grStages: "grStagesColumn",
			dateSubmitted: "dateSubmittedColumn",
			poNumber: "poNumberColumn",
		},
	},
};

/* ---- Dataset meta retrieval & row lookups ---- */

function shouldApplyDivisionFilter_(spec, userProfile) {
	return Boolean(
		spec &&
		spec.fields &&
		spec.fields.division &&
		userProfile &&
		userProfile.accessAllowed &&
		!userProfile.isAdmin,
	);
}

function getRequestedFieldKeysForDataset_(datasetKey, requestedFieldKeys, userProfile) {
	const spec = DATASET_SPECS[datasetKey];
	const normalizedRequestedFields = normalizeRequestedFields_(requestedFieldKeys);
	const fieldKeys = normalizedRequestedFields.length > 0 ? normalizedRequestedFields : Object.keys(spec && spec.fields ? spec.fields : {});
	if (shouldApplyDivisionFilter_(spec, userProfile) && fieldKeys.indexOf("division") === -1) {
		fieldKeys.push("division");
	}

	return fieldKeys;
}

function buildLookupMissResult_(meta) {
	return {
		found: false,
		meta: meta,
		match: null,
		rowValues: [],
		values: {},
	};
}

function buildLookupResultFromRow_(meta, rowNumber, rowValues, requestedFieldKeys, method) {
	const values = {};
	for (let i = 0; i < requestedFieldKeys.length; i += 1) {
		const fieldKey = requestedFieldKeys[i];
		const columnIndex = meta.fieldColumns[fieldKey];
		values[fieldKey] = typeof columnIndex === "number" && columnIndex >= 0 ? rowValues[columnIndex] : "";
	}

	return {
		found: true,
		meta: meta,
		match: {
			row: rowNumber,
			method: method || "scan",
		},
		rowValues: rowValues,
		values: values,
	};
}

function buildDatasetMetaCacheKey_(datasetKey, sourceInfo, sheetName, requestedFieldKeys) {
	const sourceLink = String(sourceInfo && sourceInfo.link ? sourceInfo.link : "").trim();
	const sourceDateMs = sourceInfo && sourceInfo.date instanceof Date ? sourceInfo.date.getTime() : "";
	const fieldKey = normalizeRequestedFields_(requestedFieldKeys).slice().sort().join(",");
	return ["v2", datasetKey, sourceLink, String(sourceDateMs), String(sheetName || ""), fieldKey].join(":");
}

function getDatasetMeta_(datasetKey, requestedFieldKeys, options) {
	const spec = DATASET_SPECS[datasetKey];
	if (!spec) {
		return null;
	}

	const userProfile = resolveDatasetUserProfile_(options);
	if (!userProfile || !userProfile.accessAllowed) {
		return null;
	}

	const fieldKeys = getRequestedFieldKeysForDataset_(datasetKey, requestedFieldKeys, userProfile);
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

function getDatasetRowsByField_(datasetKey, requestedFieldKeys, options) {
	const userProfile = resolveDatasetUserProfile_(options);
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
	const shouldFilterByDivision = shouldApplyDivisionFilter_(DATASET_SPECS[datasetKey], userProfile);

	for (let i = 0; i < rowCount; i += 1) {
		const rawRow = rawRows[i] || [];
		const displayRow = displayRows[i] || [];
		const rowDivisionValue = typeof meta.fieldColumns.division === "number" && meta.fieldColumns.division >= 0 ? String(displayRow[meta.fieldColumns.division] || "").trim() : "";
		if (shouldFilterByDivision && !rowMatchesUserDivision_(rowDivisionValue, userProfile)) {
			continue;
		}

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

function lookupDatasetRowByField_(datasetKey, lookupFieldKey, lookupValue, requestedFieldKeys, options) {
	const userProfile = resolveDatasetUserProfile_(options);
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

	const divisionColumnIndex = typeof meta.fieldColumns.division === "number" ? meta.fieldColumns.division : -1;
	const shouldFilterByDivision = shouldApplyDivisionFilter_(DATASET_SPECS[datasetKey], userProfile);
	const match = findExactMatchRowInColumn_(sheet, lookupColumn, meta.dataStartRow, lastRow, lookupValue);
	if (!match) {
		return buildLookupMissResult_(meta);
	}

	if (shouldFilterByDivision && typeof divisionColumnIndex === "number" && divisionColumnIndex >= 0) {
		const divisionValue = String((sheet.getRange(match.row, divisionColumnIndex + 1).getDisplayValue() || "")).trim();
		if (!rowMatchesUserDivision_(divisionValue, userProfile)) {
			return {
				found: false,
				accessDenied: true,
				message: getCommschedDivisionDeniedMessage_(lookupValue),
				meta: meta,
				match: {
					row: match.row,
					method: match.method || "scan",
				},
				rowValues: [],
				values: {},
			};
		}
	}

	const rowValues = sheet.getRange(match.row, 1, 1, meta.lastColumn).getDisplayValues()[0] || [];
	return buildLookupResultFromRow_(meta, match.row, rowValues, normalizedRequestedFields, match.method);
}

function lookupCommschedPoRow_(poNumber, requestedFieldKeys, options) {
	return lookupDatasetRowByField_("COMMSCHED", "poNumber", poNumber, requestedFieldKeys, options);
}

function lookupGrTicketRow_(grNumber, requestedFieldKeys, options) {
	return lookupDatasetRowByField_("GR", "caseNo", grNumber, requestedFieldKeys, options);
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

function findRowsInDatasetByExactColumn_(datasetKey, columnFieldKey, targetValue, requestedFieldKeys, options) {
	const userProfile = resolveDatasetUserProfile_(options);
	const normalizedRequested = normalizeRequestedFields_(requestedFieldKeys || []);
	const meta = getDatasetMeta_(datasetKey, [columnFieldKey].concat(normalizedRequested), options);
	if (!meta) return null;

	const workbook = openSpreadsheetFromLink_(meta.sourceLink);
	const sheet = workbook.getSheetByName(meta.sheetName);
	if (!sheet) return null;

	const lastRow = sheet.getLastRow();
	if (lastRow <= meta.headerRow) {
		return { meta: meta, rows: [] };
	}

	const lookupColumn = meta.fieldColumns[columnFieldKey];
	if (typeof lookupColumn !== 'number' || lookupColumn < 0) return null;

	const rowCount = lastRow - meta.dataStartRow + 1;
	if (rowCount < 1) return { meta: meta, rows: [] };

	const searchRange = sheet.getRange(meta.dataStartRow, lookupColumn + 1, rowCount, 1);
	let matches = [];
	try {
		const finder = searchRange.createTextFinder(String(targetValue)).matchEntireCell(true);
		const found = finder.findAll();
		if (Array.isArray(found) && found.length > 0) {
			for (let i = 0; i < found.length; i += 1) {
				const r = found[i];
				matches.push({ row: r.getRow(), method: 'textFinder' });
			}
		}
	} catch (e) {
		// ignore and fallback to scanning
	}

	if (matches.length === 0) {
		const values = searchRange.getValues();
		const target = String(targetValue || '').trim();
		for (let i = 0; i < values.length; i += 1) {
			if (String(values[i][0] || '').trim() === target) {
				matches.push({ row: meta.dataStartRow + i, method: 'scan' });
			}
		}
	}

	const shouldFilterByDivision = shouldApplyDivisionFilter_(DATASET_SPECS[datasetKey], userProfile);
	const divisionColumnIndex = typeof meta.fieldColumns.division === 'number' ? meta.fieldColumns.division : -1;
	const rows = [];

	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		const rowNum = match.row;

		if (shouldFilterByDivision && divisionColumnIndex >= 0) {
			const divVal = String(sheet.getRange(rowNum, divisionColumnIndex + 1).getDisplayValue() || '').trim();
			if (!rowMatchesUserDivision_(divVal, userProfile)) {
				continue;
			}
		}

		const rawRow = sheet.getRange(rowNum, 1, 1, meta.lastColumn).getValues()[0] || [];
		const displayRow = sheet.getRange(rowNum, 1, 1, meta.lastColumn).getDisplayValues()[0] || [];
		const rowObj = { rowNumber: rowNum, values: {}, rawValues: {} };

		for (let j = 0; j < normalizedRequested.length; j += 1) {
			const key = normalizedRequested[j];
			const colIndex = meta.fieldColumns[key];
			rowObj.values[key] = (typeof colIndex === 'number' && colIndex >= 0) ? String(displayRow[colIndex] || '').trim() : '';
			rowObj.rawValues[key] = (typeof colIndex === 'number' && colIndex >= 0) ? rawRow[colIndex] : '';
		}

		rows.push(rowObj);
	}

	return { meta: meta, rows: rows };
}

function findMatchingRowInColumnWithDivision_(sheet, columnIndex, divisionColumnIndex, dataStartRow, lastRow, targetValue, userProfile) {
	if (!sheet || typeof columnIndex !== "number" || columnIndex < 0) {
		return null;
	}

	const rowCount = lastRow - dataStartRow + 1;
	if (rowCount < 1) {
		return null;
	}

	const target = String(targetValue || "").trim();
	if (!target) {
		return null;
	}

	const lookupRange = sheet.getRange(dataStartRow, columnIndex + 1, rowCount, 1);
	const lookupValues = lookupRange.getDisplayValues();
	const divisionValues =
		typeof divisionColumnIndex === "number" && divisionColumnIndex >= 0
			? sheet.getRange(dataStartRow, divisionColumnIndex + 1, rowCount, 1).getDisplayValues()
			: null;

	for (let i = 0; i < rowCount; i += 1) {
		const cellValue = String((lookupValues[i] || [])[0] || "").trim();
		if (cellValue !== target) {
			continue;
		}

		const rowDivisionValue = divisionValues ? String((divisionValues[i] || [])[0] || "").trim() : "";
		if (!rowMatchesUserDivision_(rowDivisionValue, userProfile)) {
			continue;
		}

		return {
			row: dataStartRow + i,
			method: "scan",
		};
	}

	return null;
}
