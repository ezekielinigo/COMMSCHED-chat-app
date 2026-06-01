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
	const input = String(rawText || "").replace(/[‐‑‒–—―−]/g, "-");
	const patterns = [
		/\b(?:a|b|c|d|e)\.\s*(?:<6 months|6-9 months|9-12 months|12-24 months|>24 months)\b/i,
		/\b(?:<6 months|6-9 months|9-12 months|12-24 months|>24 months)\b/i,
		/\bhigh[-\s]?risk\b/i,
		/\blegacy\b/i,
		/\b(?:exceed(?:ing)?|beyond|over|older than)\s+(?:the\s+)?(?:standard\s+)?sla\b/i,
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

function extractDaysMatches(rawText) {
	const input = String(rawText || "").replace(/[‐‑‒–—―−]/g, "-");
	const matches = [];
	const seen = {};

	function addDays(value) {
		const num = parseInt(String(value || "").trim(), 10);
		if (isNaN(num) || num <= 0) {
			return;
		}
		const normalizedValue = String(num);
		if (seen[normalizedValue]) {
			return;
		}
		seen[normalizedValue] = true;
		matches.push(normalizedValue);
	}

	if (/\b(?:past|last)\s+week\b/i.test(input)) {
		addDays(7);
	}

	if (/\b(?:past|last)\s+month\b/i.test(input)) {
		addDays(30);
	}

	const weekPattern = /\b(\d+)\s*weeks?\b/gi;
	let weekMatch = null;
	while ((weekMatch = weekPattern.exec(input)) !== null) {
		addDays(parseInt(weekMatch[1], 10) * 7);
	}

	const monthPattern = /\b(\d+)\s*months?\b/gi;
	let monthMatch = null;
	while ((monthMatch = monthPattern.exec(input)) !== null) {
		addDays(parseInt(monthMatch[1], 10) * 30);
	}

	const dayPattern = /\b(\d+)\s*(?:days?|d)\b/gi;
	let dayMatch = null;
	while ((dayMatch = dayPattern.exec(input)) !== null) {
		addDays(dayMatch[1]);
	}

	return matches;
}

function extractPercentMatches(rawText) {
	const input = String(rawText || "").replace(/[‐‑‒–—―−]/g, "-");
	const patterns = [
		/\b\d+(?:\.\d+)?\s*%/gi,
		/\b\d+(?:\.\d+)?\s*(?:percent|pct)\b/gi,
	];
	const matches = [];
	const seen = {};

	patterns.forEach((pattern) => {
		let match = null;
		while ((match = pattern.exec(input)) !== null) {
			const value = String(match[0] || "").trim();
			const normalizedValue = normalizeText(value);
			if (!value || seen[normalizedValue]) {
				continue;
			}

			seen[normalizedValue] = true;
			matches.push(value);
		}
	});

	return matches;
}

function parseAmountExpression_(value) {
	if (value === undefined || value === null) return NaN;
	if (typeof value === "number") return Number(value);

	let text = String(value || "").trim().toLowerCase();
	if (!text) return NaN;

	let negative = false;
	if (/^\(.*\)$/.test(text)) {
		negative = true;
		text = text.replace(/^\(|\)$/g, "");
	}

	text = text.replace(/[$₱€£]/g, " ");
	text = text.replace(/\b(?:usd|php|ph|peso|pesos|dollars?|us dollars?)\b/g, " ");
	text = text.replace(/\s+/g, " ").trim();

	let multiplier = 1;
	const unitMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(k|m|b|thousand|million|billion)\b/);
	if (unitMatch) {
		const unit = String(unitMatch[2] || "");
		if (unit === "k" || unit === "thousand") multiplier = 1e3;
		else if (unit === "m" || unit === "million") multiplier = 1e6;
		else if (unit === "b" || unit === "billion") multiplier = 1e9;
		text = String(unitMatch[1] || "");
	} else {
		text = text.replace(/[^0-9.\-]/g, "");
	}

	const numeric = parseFloat(text);
	if (isNaN(numeric)) return NaN;
	const amount = numeric * multiplier;
	return negative ? -Math.abs(amount) : amount;
}

function extractAmountMatches(rawText) {
	const input = String(rawText || "");
	const patterns = [
		/\b((?:usd|php|ph|peso|pesos|dollars?|us dollars?)\s*[$₱]?\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|thousand|million|billion))?)\b/gi,
		/\b([$₱]\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|thousand|million|billion))?)\b/gi,
		/\b(?:above|over|more than|greater than|at least|>=|greater than or equal to)\s*((?:usd|php|ph|peso|pesos|dollars?|us dollars?)?\s*[$₱]?\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|thousand|million|billion))?(?:\s*(?:usd|php|ph|peso|pesos|dollars?|us dollars?))?)\b/gi,
		/\b(\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|thousand|million|billion))\s*(?:usd|php|ph|peso|pesos|dollars?|us dollars?))\b/gi,
		/\b(\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|thousand|million|billion)))\b/gi,
	];
	const matches = [];
	const seen = {};

	patterns.forEach((pattern) => {
		let match = null;
		while ((match = pattern.exec(input)) !== null) {
			const value = String(match[1] || match[0] || "").trim();
			const normalizedValue = normalizeText(value);
			if (!value || seen[normalizedValue]) {
				continue;
			}

			seen[normalizedValue] = true;
			matches.push(value);
		}
	});

	return matches;
}

function getGrTicketQueryType(rawText) {
	const text = normalizeText(rawText);
	if (!text) {
		return "";
	}

	if (/\b(submitted|submit|date submitted)\b/.test(text)) {
		return "submitted";
	}

	const hasExplicitTicketReference = /\bgr\s*(?:ticket|case(?:\s*(?:no\.?|number))?|no\.?|number)\b/.test(text) || /\b(?:ticket|case)\b/.test(text);
	const hasStatusContext = /\b(status|stage|stages|posting|posted|validation|validated|complete|completed|cancel|cancellation|revalidation|resubmitted|sap|wbs)\b/.test(text);
	if (hasExplicitTicketReference && /\b\d+\b/.test(text)) {
		return "status";
	}

	if (hasStatusContext && /\bgr\b/.test(text)) {
		return "status";
	}

	return "";
}

function extractGrTicketMatches(rawText) {
	const input = String(rawText || "");
	const queryType = getGrTicketQueryType(input);
	if (!queryType) {
		return [];
	}

	const patterns = [
		/\b(?:gr(?:\s*ticket|\s*case(?:\s*no\.?|\s*number)?|\s*no\.?|\s*number)?\s*[:#\.\-]*)?(\d{1,9})\b/gi,
	];
	const matches = [];
	const seen = {};

	patterns.forEach((pattern) => {
		let match = null;
		while ((match = pattern.exec(input)) !== null) {
			const value = String(match[1] || "").trim();
			if (!value) {
				continue;
			}

			if (/^\d{4}$/.test(value) && Number(value) >= 1900 && Number(value) <= 2099) {
				continue;
			}

			const normalizedValue = normalizeText(value);
			if (seen[normalizedValue]) {
				continue;
			}

			seen[normalizedValue] = true;
			matches.push(value);
		}
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
	const grMatches = extractGrTicketMatches(rawText);
	const percentMatches = extractPercentMatches(rawText);
	const amountMatches = extractAmountMatches(rawText);
	const daysMatches = extractDaysMatches(rawText);
	// vendor capture: phrases like "from huawei" or "for nokia"
	const vendorMatches = [];
	const vendorRegex = /\b(?:from|for)\s+([A-Za-z0-9&.,'()\-\/\s]{2,60})/i;
	const vendorM = rawText.match(vendorRegex);
	if (vendorM && vendorM[1]) {
		const vendorCandidate = String(vendorM[1]).trim().replace(/\b(?:vendor|vendors)\b$/i, "").trim();
		if (vendorCandidate && !/\bpo\b|purchase order|\bgr\b|ticket|case|status|submitted|submission|posting|validation/i.test(vendorCandidate)) {
			vendorMatches.push(vendorCandidate);
		}
	}

	// division capture: phrases like "belong to common infra", "under shared services",
	// or explicit forms like "for shared services division".
	const divisionMatches = [];
	const divisionRegexes = [
		/\b(?:belong(?:s|ing)?\s+to|under|of)\s+(?:the\s+)?(?:division\s+)?([A-Za-z0-9&.,'()\-\/\s]{2,60})(?:\s+division)?\b/i,
		/\b(?:for|in|from)\s+(?:the\s+)?(?:division\s+)?([A-Za-z0-9&.,'()\-\/\s]{2,60})(?:\s+division)?\b/i,
	];

	divisionRegexes.forEach(function(divisionRegex) {
		const divisionM = rawText.match(divisionRegex);
		if (!divisionM || !divisionM[1]) {
			return;
		}

		// Heuristic: if the captured phrase contains words like 'vendor' or 'po ' it's likely not a division
		const candidate = String(divisionM[1]).trim().replace(/^\bdivision\b\s*/i, "").replace(/\bdivision\b$/i, "").trim();
		if (candidate && !/\bpo\b|vendor|purchase order|\bgr\b|ticket|case|status|submitted|submission|posting|validation/i.test(candidate)) {
			divisionMatches.push(candidate);
		}
	});
	const dateMatches =
		rawText.match(/\b(?:0?[1-9]|1[0-2])[\/](?:0?[1-9]|[12]\d|3[01])[\/](?:19|20)\d{2}\b/g) ||
		rawText.match(/\b(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])-(?:19|20)\d{2}\b/g) ||
		[];
	const yearMatches = rawText.match(/\b(?:19|20)\d{2}\b/g) || [];
	const ageFilterMatches = extractAgeFilterMatches(rawText);

	return {
		PO_NUMBER: poMatches,
		GR_NUMBER: grMatches,
		PERCENT: percentMatches,
		AMOUNT: amountMatches,
		DAYS: daysMatches,
		VENDOR: vendorMatches,
		DIVISION: divisionMatches,
		DATE: dateMatches,
		YEAR: yearMatches,
		AGE_FILTER: ageFilterMatches,
	};
}

function normalizeEntityValue(entityKey, rawValue) {
	if (!rawValue && rawValue !== 0) return "";
	if (entityKey === "DATE") {
		return normalizeText(rawValue).replace(/\s+/g, " ").trim();
	}
	if (entityKey === "PERCENT") {
		// keep only digits for percent normalization (e.g., "30", "30%")
		return String(rawValue || "").replace(/[^0-9]/g, "").trim();
	}
	if (entityKey === "AMOUNT") {
		return normalizeText(rawValue).replace(/\s+/g, " ").trim();
	}
	if (entityKey === "DAYS") {
		return String(rawValue || "").replace(/[^0-9]/g, "").trim();
	}
	if (entityKey === "DATE_RANGE") {
		// keep the range text normalized but handlers will split on the separator
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
	(entityMatches.DATE_RANGE || []).forEach((value) => {
		if (!value) return;
		// dateRange stored as "start||end" — replace both parts to avoid biasing phrase match
		const parts = String(value).split("||").map(function(p) { return p.trim(); }).filter(Boolean);
		parts.forEach(function(part) { replaceMatch("DATE", part); });
	});
	(entityMatches.PERCENT || []).forEach((value) => replaceMatch("PERCENT", value));
	(entityMatches.AMOUNT || []).forEach((value) => replaceMatch("AMOUNT", value));
	(entityMatches.DAYS || []).forEach((value) => replaceMatch("DAYS", value));
	(entityMatches.AGE_FILTER || []).forEach((value) => replaceMatch("AGE_FILTER", value));
	(entityMatches.GR_NUMBER || []).forEach((value) => replaceMatch("GR_NUMBER", value));
	(entityMatches.PO_NUMBER || []).forEach((value) => replaceMatch("PO_NUMBER", value));
	(entityMatches.VENDOR || []).forEach((value) => replaceMatch("VENDOR", value));
	(entityMatches.DIVISION || []).forEach((value) => replaceMatch("DIVISION", value));
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

function scoreIntentAgainstInputVariants(inputVariants, phrases) {
	let bestScore = 0;
	let bestPhrase = null;

	(inputVariants || []).forEach((inputForMatch) => {
		const scored = scoreIntentAgainstPhrases(inputForMatch, phrases);
		if (scored.score > bestScore) {
			bestScore = scored.score;
			bestPhrase = scored.phrase;
		}
	});

	return { score: bestScore, phrase: bestPhrase };
}

function buildKeywordTokenSet(normalizedText) {
	const tokens = tokenize(normalizeText(normalizedText));
	const set = new Set(tokens);

	tokens.forEach((token) => {
		if (token.length > 2 && token.endsWith("s")) {
			set.add(token.slice(0, -1));
		}
	});

	return set;
}

function textContainsKeyword(normalizedText, keyword, keywordTokenSet) {
	const term = normalizeText(keyword);
	if (!term) {
		return false;
	}

	if (term.indexOf(" ") !== -1) {
		return normalizeText(normalizedText).indexOf(term) !== -1;
	}

	return keywordTokenSet.has(term);
}

function scoreIntentSignals(normalizedText, intent) {
	const text = normalizeText(normalizedText);
	if (!text || !intent) {
		return 0;
	}

	const keywordTokenSet = buildKeywordTokenSet(text);

	const scoreTerms = (terms, weight) => {
		let total = 0;
		(terms || []).forEach((term) => {
			if (textContainsKeyword(text, term, keywordTokenSet)) {
				total += weight;
			}
		});
		return total;
	};

	const boost = scoreTerms(intent.intentKeywords, 0.12);
	const penalty = scoreTerms(intent.conflictKeywords, 0.16);
	return boost - penalty;
}

function scoreIntentCandidate(intent, inputVariants, normalizedText) {
	const phraseScore = scoreIntentAgainstInputVariants(inputVariants, intent && intent.phrases);
	const signalScore = scoreIntentSignals(normalizedText, intent);
	const combinedScore = Math.max(0, Math.min(1, phraseScore.score + signalScore));

	return {
		score: combinedScore,
		phrase: phraseScore.phrase,
	};
}

function buildIntentSuggestion(intent, inputVariants, normalizedText, poNumber) {
	if (!intent || !intent.name) return null;
	const best = scoreIntentCandidate(intent, inputVariants, normalizedText);
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
			rawText: rawText,
		};
	}

	const entityMatches = extractEntitiesFromText(rawText);
	const grTicketQueryType = getGrTicketQueryType(rawText);
	const normalizedForMatch = replaceEntityValuesForMatching(
		normalized,
		entityMatches,
	);
	const inputVariants = [normalizedForMatch];
	if (normalizedForMatch !== normalized) {
		inputVariants.push(normalized);
	}
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
	let bestGrTicketStatus = null;
	let bestGrTicketSubmitted = null;
	const suggestions = [];
	const suggestionEntityValue = entities.PO_NUMBER || entities.GR_NUMBER || "";

	INTENTS.forEach((intent) => {
		const bestForIntent = scoreIntentCandidate(intent, inputVariants, normalized);
		if (bestForIntent.score > bestScore) {
			bestScore = bestForIntent.score;
			bestIntent = intent;
			bestPhrase = bestForIntent.phrase;
		}

		if (intent && intent.handler === "checkGrTicketStatus") {
			bestGrTicketStatus = {
				intent: intent,
				score: bestForIntent.score,
				phrase: bestForIntent.phrase,
			};
		}

		if (intent && intent.handler === "checkGrTicketSubmitted") {
			bestGrTicketSubmitted = {
				intent: intent,
				score: bestForIntent.score,
				phrase: bestForIntent.phrase,
			};
		}

		const suggestion = buildIntentSuggestion(
			intent,
			inputVariants,
			normalized,
			suggestionEntityValue,
		);
		if (suggestion) {
			suggestions.push(suggestion);
		}
	});

	suggestions.sort((a, b) => b.score - a.score);

	if ((entityMatches.GR_NUMBER || []).length > 0 && (entityMatches.PO_NUMBER || []).length === 0 && grTicketQueryType) {
		const chosenGrIntent = grTicketQueryType === "submitted" ? bestGrTicketSubmitted : bestGrTicketStatus;
		if (chosenGrIntent && chosenGrIntent.intent) {
			bestIntent = chosenGrIntent.intent;
			bestPhrase = chosenGrIntent.phrase;
			bestScore = Math.min(1, (chosenGrIntent.score || 0) + 0.35);
		}
	}

	if (!bestIntent) {
		return {
			intent: null,
			confidence: 0,
			entities: entities,
			matchedPhrase: null,
			rawText: rawText,
		};
	}

	return {
		intent: bestIntent.name,
		confidence: bestScore,
		entities: entities,
		matchedPhrase: bestPhrase,
		suggestions: suggestions.slice(0, 3),
		rawText: rawText,
	};
}

