/* parser.js

- normalizes the input text
- extract entities like PO number, GR ticket case number, etc.
- compare the user text to the defined intents and find the best match
- decide whether confidence is high enough
- return the intent name, confidence score, and extracted entities

example input: "what is the status of PO 1234567890"
example output: 
{ 
	intent: "check_po_status", 
	confidence: 0.95, 
	entities: { 
		PO_NUMBER: "1234567890" 
	} 
}

*/

function normalizeText(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function escapeRegExp(text) {
	return String(text || "").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function extractAgeFilterMatches(rawText) {
	const input = String(rawText || "");
	const patterns = [
		/\b(?:a|b|c|d|e)\.\s*(?:<6 months|6-9 months|9-12 months|12-24 months|>24 months)\b/i,
		/\b(?:<6 months|6-9 months|9-12 months|12-24 months|>24 months)\b/i,
		/\bhigh[-\s]?risk\b/i,
		/\blegacy\b/i,
		/(?:^|\s)(?:at least|>=|greater than or equal to)\s*\d+\s*(?:months?|mos?|mo|years?|yrs?)\b/i,
		/(?:^|\s)(?:<|less than|under)\s*\d+\s*(?:months?|mos?|mo|years?|yrs?)\b/i,
		/(?:^|\s)(?:>|more than|over|beyond|older than)\s*\d+\s*(?:months?|mos?|mo|years?|yrs?)\b/i,
	];
	const matches = [];
	const seen = {};

	patterns.forEach((pattern) => {
		const found = input.match(pattern);
		if (!found || !found[0]) {
			return;
		}

		const value = String(found[0]).trim();
		const normalizedValue = normalizeText(value);
		if (!value || seen[normalizedValue]) {
			return;
		}

		seen[normalizedValue] = true;
		matches.push(value);
	});

	return matches;
}

function tokenize(text) {
	if (!text) return [];
	return text.split(/\s+/).filter(Boolean);
}

function jaccardSimilarity(tokensA, tokensB) {
	if (!tokensA.length && !tokensB.length) return 1;
	if (!tokensA.length || !tokensB.length) return 0;
	const setA = new Set(tokensA);
	const setB = new Set(tokensB);
	let intersection = 0;
	setA.forEach((tok) => {
		if (setB.has(tok)) intersection += 1;
	});
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function levenshteinDistance(a, b) {
	const s = a || "";
	const t = b || "";
	const m = s.length;
	const n = t.length;
	if (m === 0) return n;
	if (n === 0) return m;

	const dp = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	for (let i = 0; i <= m; i += 1) dp[i][0] = i;
	for (let j = 0; j <= n; j += 1) dp[0][j] = j;

	for (let i = 1; i <= m; i += 1) {
		for (let j = 1; j <= n; j += 1) {
			const cost = s[i - 1] === t[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost,
			);
		}
	}

	return dp[m][n];
}

function normalizedLevenshteinSimilarity(a, b) {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	const dist = levenshteinDistance(a, b);
	return 1 - dist / maxLen;
}

function extractEntitiesFromText(userText) {
	const rawText = String(userText || "");
	const poMatches = rawText.match(/\b\d{10}\b/g) || [];
	const dateMatches =
		rawText.match(/\b(?:0?[1-9]|1[0-2])[\/](?:0?[1-9]|[12]\d|3[01])[\/](?:19|20)\d{2}\b/g) ||
		rawText.match(/\b(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])-(?:19|20)\d{2}\b/g) ||
		[];
	const yearMatches = rawText.match(/\b(?:19|20)\d{2}\b/g) || [];
	const ageFilterMatches = extractAgeFilterMatches(rawText);

	return {
		PO_NUMBER: poMatches,
		DATE: dateMatches,
		YEAR: yearMatches,
		AGE_FILTER: ageFilterMatches,
	};
}

function normalizeEntityValue(entityKey, rawValue) {
	if (entityKey === "DATE") {
		return normalizeText(rawValue).replace(/\s+/g, " ").trim();
	}
	return normalizeText(rawValue);
}

function replaceEntityValuesForMatching(normalizedText, entityMatches) {
	let output = String(normalizedText || "");

	const replaceMatch = (entityKey, value) => {
		const normalizedValue = normalizeEntityValue(entityKey, value);
		if (!normalizedValue) return;
		const re = new RegExp("\\b" + escapeRegExp(normalizedValue) + "\\b", "g");
		output = output.replace(re, "x");
	};

	(entityMatches.DATE || []).forEach((value) => replaceMatch("DATE", value));
	(entityMatches.AGE_FILTER || []).forEach((value) => replaceMatch("AGE_FILTER", value));
	(entityMatches.PO_NUMBER || []).forEach((value) => replaceMatch("PO_NUMBER", value));
	(entityMatches.YEAR || []).forEach((value) => replaceMatch("YEAR", value));

	return output;
}

function replacePoWithPlaceholder(normalizedText, poNumber) {
	if (!poNumber) return normalizedText;
	const escaped = poNumber.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
	const re = new RegExp("\\b" + escaped + "\\b", "g");
	return normalizedText.replace(re, "x");
}

function scoreIntent(inputForMatch, phrase) {
	const normalizedPhrase = normalizeText(phrase);
	const tokensA = tokenize(inputForMatch);
	const tokensB = tokenize(normalizedPhrase);
	const jaccard = jaccardSimilarity(tokensA, tokensB);
	const levenshteinSim = normalizedLevenshteinSimilarity(
		inputForMatch,
		normalizedPhrase,
	);
	const score = jaccard * 0.6 + levenshteinSim * 0.4;
	return { score: score, jaccard: jaccard, levenshtein: levenshteinSim };
}

function formatSuggestionLabel(phrase, poNumber) {
	let label = String(phrase || "").trim();
	if (!label) return "";

	if (poNumber) {
		label = label.replace(/\bPO X\b/gi, "PO " + poNumber);
		label = label.replace(/\bX\b/gi, poNumber);
	} else {
		label = label.replace(/\bPO X\b/gi, "PO");
		label = label.replace(/\bX\b/gi, "");
	}

	label = label.replace(/\s+/g, " ").trim();
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function scoreIntentAgainstPhrases(inputForMatch, phrases) {
	let bestScore = 0;
	let bestPhrase = null;

	(phrases || []).forEach((phrase) => {
		const scored = scoreIntent(inputForMatch, phrase);
		if (scored.score > bestScore) {
			bestScore = scored.score;
			bestPhrase = phrase;
		}
	});

	return { score: bestScore, phrase: bestPhrase };
}

function buildIntentSuggestion(intent, inputForMatch, poNumber) {
	if (!intent || !intent.name) return null;
	const best = scoreIntentAgainstPhrases(inputForMatch, intent.phrases);
	if (!best.phrase) return null;

	return {
		id: intent.name,
		intent: intent.name,
		label: formatSuggestionLabel(best.phrase, poNumber),
		matchedPhrase: best.phrase,
		score: best.score,
	};
}

function parseInput(userText) {
	const rawText = String(userText || "");
	const normalized = normalizeText(userText);
	if (!normalized) {
		return {
			intent: null,
			confidence: 0,
			entities: {},
			matchedPhrase: null,
			suggestions: [],
		};
	}

	const entityMatches = extractEntitiesFromText(rawText);
	const normalizedForMatch = replaceEntityValuesForMatching(
		normalized,
		entityMatches,
	);
	const entities = {};
	Object.keys(entityMatches).forEach((key) => {
		const matches = entityMatches[key] || [];
		if (matches.length > 0) {
			entities[key] = matches[0];
		}
	});

	let bestIntent = null;
	let bestScore = 0;
	let bestPhrase = null;
	const suggestions = [];

	INTENTS.forEach((intent) => {
		const bestForIntent = scoreIntentAgainstPhrases(normalizedForMatch, intent.phrases);
		if (bestForIntent.score > bestScore) {
			bestScore = bestForIntent.score;
			bestIntent = intent;
			bestPhrase = bestForIntent.phrase;
		}

		const suggestion = buildIntentSuggestion(
			intent,
			normalizedForMatch,
			entities.PO_NUMBER,
		);
		if (suggestion) {
			suggestions.push(suggestion);
		}
	});

	suggestions.sort((a, b) => b.score - a.score);

	if (!bestIntent) {
		return {
			intent: null,
			confidence: 0,
			entities: entities,
			matchedPhrase: null,
		};
	}

	return {
		intent: bestIntent.name,
		confidence: bestScore,
		entities: entities,
		matchedPhrase: bestPhrase,
		suggestions: suggestions.slice(0, 3),
	};
}

