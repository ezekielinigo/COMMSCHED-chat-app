/**
 * fuzzy.js — Text scoring and fuzzy entity matching against candidate lists.
 *
 * - `scoreTextCandidate_()` computes a weighted Jaccard + Levenshtein score
 *   between a user query and a candidate string.
 * - `buildTopTextMatches_()` scores and ranks a list of candidates, returning
 *   the top N with their scores.
 * - `collectUniqueColumnValues_()` extracts distinct non-empty values from a
 *   named column across dataset rows (used to build candidate lists on the fly).
 * - `buildFuzzyEntityMatch_()` is the main entry point for value-level fuzzy
 *   matching: it collects candidates, scores them, and either returns the
 *   high-confidence match (default threshold 0.9) or a `didYouMean` suggestion
 *   payload with `countError: true` so EMAILS column F gets incremented.
 * - `buildDivisionDidYouMeanResponse_()` is the division-specific wrapper that
 *   scores raw user input against CANONICAL_DIVISIONS_ from division.js.
 *
 * Dependencies: parser.js (normalizeText, tokenize, jaccardSimilarity,
 *               normalizedLevenshteinSimilarity), division.js
 *               (CANONICAL_DIVISIONS_, scoreDivisionSimilarity_),
 *               messages.js (showDidYouMean, buildFullQueryLabel).
 * Used by: handlers_list.js (listPoVendor, listPosByProject, …),
 *          handlers_agg.js (via format.js → buildMatchedCurrencySummary_),
 *          format.js (buildMatchedCurrencySummary_).
 */

function scoreTextCandidate_(queryText, candidateText) {
	const queryNorm = normalizeText(queryText || "");
	const candidateNorm = normalizeText(candidateText || "");
	if (!queryNorm || !candidateNorm) {
		return 0;
	}

	if (queryNorm === candidateNorm) {
		return 1;
	}

	const tokensA = tokenize(queryNorm);
	const tokensB = tokenize(candidateNorm);
	const jaccard = jaccardSimilarity(tokensA, tokensB);
	const levenshtein = normalizedLevenshteinSimilarity(queryNorm, candidateNorm);
	return jaccard * 0.6 + levenshtein * 0.4;
}

function buildTopTextMatches_(queryText, candidates, limit) {
	const inputCandidates = Array.isArray(candidates) ? candidates : [];
	const maxItems = Number.isInteger(limit) && limit > 0 ? limit : 3;
	const scored = inputCandidates.map(function(candidate) {
		return {
			value: String(candidate || "").trim(),
			score: scoreTextCandidate_(queryText, candidate),
		};
	}).filter(function(item) {
		return Boolean(item.value);
	});

	scored.sort(function(a, b) {
		if (b.score !== a.score) {
			return b.score - a.score;
		}

		return String(a.value || "").localeCompare(String(b.value || ""));
	});

	return scored.slice(0, maxItems);
}

function collectUniqueColumnValues_(rows, columnName) {
	const uniqueValues = [];
	const seen = {};
	const inputRows = Array.isArray(rows) ? rows : [];
	const key = String(columnName || "").trim();

	if (!key) {
		return uniqueValues;
	}

	for (let i = 0; i < inputRows.length; i += 1) {
		const row = inputRows[i] || {};
		const values = row.values || {};
		const value = String(values[key] || "").trim();
		if (!value || seen[value]) {
			continue;
		}

		seen[value] = true;
		uniqueValues.push(value);
	}

	return uniqueValues;
}

function buildFuzzyEntityMatch_(queryText, candidates, options) {
	const config = options || {};
	const maxItems = Number.isInteger(config.limit) && config.limit > 0 ? config.limit : 3;
	const threshold = typeof config.threshold === "number" ? config.threshold : 0.9;
	const entityType = String(config.entityType || "").trim();
	const intentName = String(config.intentName || "").trim();
	const labelBuilder = typeof config.labelBuilder === "function"
		? config.labelBuilder
		: function(value) {
			return buildFullQueryLabel(intentName, value);
		};
	const scoredItems = buildTopTextMatches_(queryText, candidates, maxItems);

	if (scoredItems.length === 0) {
		return {
			matched: false,
			value: "",
			score: 0,
			suggestions: [],
			didYouMean: null,
		};
	}

	const best = scoredItems[0];
	if (best.score < threshold) {
		const suggestions = scoredItems.map(function(item) {
			return {
				id: item.value,
				label: labelBuilder(item.value),
				displayText: item.value,
				query: buildFullQueryLabel(intentName, item.value),
				entityType: entityType,
			};
		});

		return {
			matched: false,
			value: "",
			score: best.score,
			suggestions: suggestions,
			didYouMean: showDidYouMean(suggestions, { countError: config.countError !== false }),
		};
	}

	return {
		matched: true,
		value: best.value,
		score: best.score,
		suggestions: [],
		didYouMean: null,
	};
}

function buildDivisionDidYouMeanResponse_(rawDivision, intentName, options) {
	const config = options || {};
	const limit = Number.isInteger(config.limit) && config.limit > 0 ? config.limit : 3;
	const entityType = String(config.entityType || "division").trim() || "division";
	const scoredItems = CANONICAL_DIVISIONS_.map(function(division) {
		return {
			value: division,
			score: scoreDivisionSimilarity_(rawDivision, division),
		};
	});

	scoredItems.sort(function(a, b) {
		if (b.score !== a.score) {
			return b.score - a.score;
		}

		return String(a.value || "").localeCompare(String(b.value || ""));
	});

	const suggestions = scoredItems.slice(0, limit).map(function(item) {
		return {
			id: item.value,
			label: buildFullQueryLabel(intentName, item.value),
			displayText: item.value,
			query: buildFullQueryLabel(intentName, item.value),
			entityType: entityType,
		};
	});

	return showDidYouMean(suggestions, { countError: config.countError !== false });
}
