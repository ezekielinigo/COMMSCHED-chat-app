/**
 * format.js — Number parsing, formatting, SLA buckets, currency aggregation.
 *
 * - `parseDisplayAmount_()` converts cell display values (with K/M/B suffixes,
 *   parentheses for negatives, commas, currency symbols) into numeric values.
 * - `formatCount_()` and `formatMoney_()` produce human-readable strings.
 * - `buildCurrencySummaryEntries_()` groups dataset rows by entity+currency,
 *   supporting multiple amount-field fallbacks (e.g. try poAmountUsdK then
 *   poAmount). Used by the shared `buildMatchedCurrencySummary_()` helper.
 * - SLA bucket helpers: `getPoSlaBucketInfo_()` maps cell values like
 *   "a. <6 months" to structured { code, label, rank } objects.
 *   `resolvePoSlaBucketCellsForFilter_()` translates user-facing phrases
 *   ("high risk", "legacy", "at least 1 year") into the canonical bucket
 *   cell values used for filtering.
 *
 * Dependencies: division.js (normalizeDashCharacters_), sheets.js
 *               (normalizeRequestedFields_).
 * Used by: handlers_po.js (checkPoAging), handlers_list.js (listPoAging,
 *          listProjectDelayedClosure, listPoUrgentCleanup, …),
 *          handlers_agg.js (checkTotalPoAmountVendor, …),
 *          messages.js (buildPoAgingReply_).
 */

function parseDisplayAmount_(raw) {
	if (raw === undefined || raw === null) return NaN;
	if (typeof raw === "number") return Number(raw);
	let text = String(raw || "").trim();
	if (!text) return NaN;

	let negative = false;
	if (/^\(.*\)$/.test(text)) {
		negative = true;
		text = text.replace(/^\(|\)$/g, "");
	}

	// Detect unit suffixes like K, M, B (case-insensitive)
	let multiplier = 1;
	const sufMatch = text.match(/([kmb])\b/i);
	if (sufMatch) {
		const suf = String(sufMatch[1] || "").toLowerCase();
		if (suf === "k") multiplier = 1e3;
		else if (suf === "m") multiplier = 1e6;
		else if (suf === "b") multiplier = 1e9;
		text = text.replace(/([kmb])\b/i, "");
	}

	// Remove currency symbols and stray characters, keep digits, dots and commas
	text = text.replace(/[^0-9.,\-]/g, "");
	// Remove grouping commas
	text = text.replace(/,/g, "");

	const numeric = parseFloat(text);
	if (isNaN(numeric)) return NaN;
	const value = numeric * multiplier;
	return negative ? -Math.abs(value) : value;
}

function formatCount_(n) {
	const value = Math.max(0, Math.floor(Number(n || 0)));
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatMoney_(value) {
	const fixed = Number(value || 0).toFixed(2);
	const parts = fixed.split(".");
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return parts.join(".");
}

function formatCurrencySummaryTotals_(entries) {
	return (Array.isArray(entries) ? entries : []).map(function(entry) {
		return (entry.currency ? entry.currency + " " : "") + formatMoney_(entry.total);
	}).join(", ");
}

function buildCurrencySummaryEntries_(rows, options) {
	const config = options || {};
	const inputRows = Array.isArray(rows) ? rows : [];
	const entityField = String(config.entityField || "").trim();
	const currencyField = String(config.currencyField || "currency").trim();
	const amountField = String(config.amountField || "remainingBalance").trim();
	const amountFieldCandidates = Array.isArray(config.amountFieldCandidates)
		? normalizeRequestedFields_(config.amountFieldCandidates)
		: amountField
			? [amountField]
			: [];
	const filterEntityKey = String(config.filterEntityKey || "").trim();
	const resolveEntity = typeof config.resolveEntity === "function"
		? config.resolveEntity
		: function(value) {
			const text = String(value || "").trim();
			return text ? { matched: true, key: text, display: text } : { matched: false, key: "", display: "" };
		};
	const groups = {};

	if (!entityField) {
		return [];
	}

	for (let i = 0; i < inputRows.length; i += 1) {
		const row = inputRows[i] || {};
		const values = row.values || {};
		const resolvedEntity = resolveEntity(values[entityField], row);
		if (!resolvedEntity || !resolvedEntity.matched) {
			continue;
		}

		const entityKey = String(
			resolvedEntity.key ||
			resolvedEntity.canonicalDivision ||
			resolvedEntity.canonicalValue ||
			resolvedEntity.display ||
			resolvedEntity.value ||
			"",
		).trim();
		if (!entityKey || (filterEntityKey && entityKey !== filterEntityKey)) {
			continue;
		}

		const entityDisplay = String(
			resolvedEntity.display ||
			resolvedEntity.canonicalDivision ||
			resolvedEntity.canonicalValue ||
			entityKey,
		).trim();
		const currency = String(values[currencyField] || "").trim();
		let amountValue = values[amountField];
		for (let candidateIndex = 0; candidateIndex < amountFieldCandidates.length; candidateIndex += 1) {
			const candidateField = amountFieldCandidates[candidateIndex];
			if (Object.prototype.hasOwnProperty.call(values, candidateField)) {
				amountValue = values[candidateField];
				break;
			}
		}
		const amount = parseDisplayAmount_(amountValue);
		if (isNaN(amount)) {
			continue;
		}

		const groupKey = entityKey + "||" + currency;
		if (!groups[groupKey]) {
			groups[groupKey] = {
				entityKey: entityKey,
				entityDisplay: entityDisplay,
				currency: currency,
				total: 0,
				posCount: 0,
				rows: 0,
			};
		}

		groups[groupKey].total += amount;
		groups[groupKey].rows += 1;
		if (amount > 0) {
			groups[groupKey].posCount += 1;
		}
	}

	return Object.keys(groups).map(function(key) {
		return groups[key];
	});
}

function buildMatchedCurrencySummary_(rows, rawEntityValue, options) {
	const config = options || {};
	const inputRows = Array.isArray(rows) ? rows : [];
	const entityField = String(config.entityField || "vendor").trim();
	const intentName = String(config.intentName || "").trim();
	const entityType = String(config.entityType || entityField || "").trim();
	const noMatchMessage = String(config.noMatchMessage || "No matching values found.");
	const countError = config.countError !== false;
	const match = buildFuzzyEntityMatch_(rawEntityValue, collectUniqueColumnValues_(inputRows, entityField), {
		intentName: intentName,
		entityType: entityType,
		countError: countError,
		limit: Number.isInteger(config.limit) && config.limit > 0 ? config.limit : 3,
		threshold: typeof config.threshold === "number" ? config.threshold : 0.9,
	});

	if (!match.matched) {
		return {
			matched: false,
			response: match.didYouMean || noMatchMessage,
			chosen: "",
			entries: [],
		};
	}

	const entries = buildCurrencySummaryEntries_(inputRows, {
		entityField: entityField,
		currencyField: String(config.currencyField || "currency").trim() || "currency",
		amountField: String(config.amountField || "").trim(),
		amountFieldCandidates: config.amountFieldCandidates,
		filterEntityKey: match.value,
		resolveEntity: typeof config.resolveEntity === "function"
			? config.resolveEntity
			: function(value) {
				const text = String(value || "").trim();
				return text ? { matched: true, key: text, display: text } : { matched: false, key: "", display: "" };
			},
	});

	return {
		matched: true,
		response: null,
		chosen: match.value,
		entries: entries,
	};
}

function normalizePoSlaCellValue_(value) {
	return normalizeDashCharacters_(String(value || ""))
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
	const text = normalizeDashCharacters_(String(rawFilter || ""))
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
