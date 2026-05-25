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
			displayText: item.displayText || item.label || item.matchedPhrase || "",
			query: item.query || item.sendText || "",
			entityType: item.entityType || "",
		})),
	};
}

function extractUnGrdSubjectText_(userText) {
	const raw = String(userText || "").trim();
	if (!raw) return "";

	const lower = normalizeText(raw);
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

	const vendorQuery = "what is the total unGR'd exposure for " + subjectText + " vendor";
	const divisionQuery = "what is the total unGR'd exposure for division " + subjectText;

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
function buildFullQueryLabel(intentName, entityValue) {
	if (!intentName) return String(entityValue || "");
	const intent = (typeof INTENTS !== "undefined" && Array.isArray(INTENTS)) ? INTENTS.find(function(i) { return i && i.name === intentName; }) : null;
	let template = null;
	if (intent && Array.isArray(intent.phrases) && intent.phrases.length > 0) {
		// Prefer a user-friendly phrasing that starts with 'Show' if available,
		// otherwise fall back to the first phrase.
		const showPhrase = intent.phrases.find(function(p) { return /^show\b/i.test(String(p || "")); });
		template = showPhrase || intent.phrases[0];
	}
	// Fallback templates for known intents
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

function normalizeDashCharacters_(text) {
	return String(text || "").replace(/[‐‑‒–—―−]/g, "-");
}

const CANONICAL_DIVISIONS_ = [
	"Admin",
	"Build and Deploy",
	"Common Infra Planning and Engineering",
	"Insights Analytics",
	"Network Digitalization",
	"Network Operations and Assurance",
	"Service Planning and Engineering",
	"Shared Services",
	"Strategic Partnerships and Programs",
	"Transformation and Strategy Execution",
];

const DIVISION_STOP_WORDS_ = {
	and: true,
	the: true,
	of: true,
	for: true,
	division: true,
	divisions: true,
};

function stripParentheticalText_(value) {
	return String(value || "").replace(/\([^)]*\)/g, " ");
}

function normalizeDivisionText_(value) {
	return normalizeText(stripParentheticalText_(value));
}

function tokenizeDivisionText_(value) {
	return tokenize(normalizeDivisionText_(value)).filter(function(token) {
		return !DIVISION_STOP_WORDS_[token];
	});
}

function buildAcronymFromTokens_(tokens) {
	return (tokens || [])
		.filter(function(token) {
			return Boolean(token);
		})
		.map(function(token) {
			return token.charAt(0);
		})
		.join("");
}

function scoreDivisionSimilarity_(candidateDivision, canonicalDivision) {
	const candidateNorm = normalizeDivisionText_(candidateDivision);
	const canonicalNorm = normalizeDivisionText_(canonicalDivision);
	if (!candidateNorm || !canonicalNorm) {
		return 0;
	}

	if (candidateNorm === canonicalNorm) {
		return 1;
	}

	if (
		candidateNorm.indexOf(canonicalNorm) !== -1 ||
		canonicalNorm.indexOf(candidateNorm) !== -1
	) {
		return 0.95;
	}

	const candidateTokens = tokenizeDivisionText_(candidateDivision);
	const canonicalTokens = tokenizeDivisionText_(canonicalDivision);
	const jaccard = jaccardSimilarity(candidateTokens, canonicalTokens);
	const levenshtein = normalizedLevenshteinSimilarity(
		candidateNorm,
		canonicalNorm,
	);
	const candidateAcronym = buildAcronymFromTokens_(candidateTokens);
	const canonicalAcronym = buildAcronymFromTokens_(canonicalTokens);
	const acronymScore =
		candidateAcronym &&
		canonicalAcronym &&
		candidateAcronym === canonicalAcronym
			? 1
			: 0;

	return jaccard * 0.45 + levenshtein * 0.35 + acronymScore * 0.2;
}

function resolveCanonicalDivision_(rawDivision) {
	const candidate = String(rawDivision || "").trim();
	if (!candidate) {
		return {
			matched: false,
			canonicalDivision: "",
			score: 0,
		};
	}

	const normalizedCandidate = normalizeDivisionText_(candidate);
	for (let i = 0; i < CANONICAL_DIVISIONS_.length; i += 1) {
		const canonicalDivision = CANONICAL_DIVISIONS_[i];
		if (normalizedCandidate === normalizeDivisionText_(canonicalDivision)) {
			return {
				matched: true,
				canonicalDivision: canonicalDivision,
				score: 1,
			};
		}
	}

	let bestDivision = "";
	let bestScore = 0;
	for (let i = 0; i < CANONICAL_DIVISIONS_.length; i += 1) {
		const canonicalDivision = CANONICAL_DIVISIONS_[i];
		const score = scoreDivisionSimilarity_(candidate, canonicalDivision);
		if (score > bestScore) {
			bestScore = score;
			bestDivision = canonicalDivision;
		}
	}

	if (bestScore >= 0.58) {
		return {
			matched: true,
			canonicalDivision: bestDivision,
			score: bestScore,
		};
	}

	return {
		matched: false,
		canonicalDivision: "",
		score: bestScore,
	};
}

function extractFirstNameFromFullName_(fullName) {
	const trimmedFullName = String(fullName || "").trim().replace(/\s+/g, " ");
	if (trimmedFullName) {
		const firstToken = trimmedFullName.split(" ")[0] || "";
		const cleanedFirstToken = firstToken.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "");
		if (cleanedFirstToken) {
			return cleanedFirstToken.charAt(0).toUpperCase() + cleanedFirstToken.slice(1);
		}
	}

	return "";
}

function getCurrentUserEmail_() {
	const candidates = getCurrentUserEmailCandidates_();
	return candidates.length > 0 ? candidates[0] : "";
}

function getCurrentUserEmailCandidates_() {
	const candidates = [];
	const pushCandidate = function(value) {
		const normalized = normalizeEmailAddress_(value);
		if (normalized && candidates.indexOf(normalized) === -1) {
			candidates.push(normalized);
		}

		const stripped = stripPlusAliasFromEmail_(normalized);
		if (stripped && candidates.indexOf(stripped) === -1) {
			candidates.push(stripped);
		}
	};

	try {
		const activeUser = Session.getActiveUser();
		if (activeUser && typeof activeUser.getEmail === "function") {
			pushCandidate(activeUser.getEmail());
		}
	} catch (error) {
		// If the active user cannot be resolved, treat the user as unauthenticated.
	}

	try {
		const effectiveUser = Session.getEffectiveUser();
		if (effectiveUser && typeof effectiveUser.getEmail === "function") {
			pushCandidate(effectiveUser.getEmail());
		}
	} catch (error) {
		// Ignore fallback lookup failures.
	}

	return candidates;
}

function getCurrentUserSessionCacheKey_() {
	try {
		const tempKey = String(Session.getTemporaryActiveUserKey() || "").trim();
		if (tempKey) {
			return "userProfile:" + tempKey;
		}
	} catch (error) {
		// Ignore and fall back to an email-based key.
	}

	const email = getCurrentUserEmail_();
	if (email) {
		return "userProfile:" + email;
	}

	return "userProfile:guest";
}

function normalizeEmailAddress_(value) {
	return String(value || "").trim().toLowerCase();
}

function stripPlusAliasFromEmail_(email) {
	const normalized = normalizeEmailAddress_(email);
	const atIndex = normalized.indexOf("@");
	if (atIndex === -1) {
		return normalized;
	}

	const localPart = normalized.slice(0, atIndex);
	const domainPart = normalized.slice(atIndex + 1);
	const plusIndex = localPart.indexOf("+");
	if (plusIndex === -1) {
		return normalized;
	}

	return `${localPart.slice(0, plusIndex)}@${domainPart}`;
}

function getCurrentUserAuthDebug_() {
	const debug = {
		authStatus: "unknown",
		authUrl: "",
		requiredScopes: [],
	};

	try {
		const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
		if (authInfo) {
			debug.authStatus = String(authInfo.getAuthorizationStatus() || "unknown");
			debug.authUrl = String(authInfo.getAuthorizationUrl() || "");
			const requiredScopes = (typeof authInfo.getRequiredScopes === "function")
				? authInfo.getRequiredScopes()
				: [];
			debug.requiredScopes = Array.isArray(requiredScopes)
				? requiredScopes.map(function(scope) {
					return String(scope || "");
				}).filter(function(scope) {
					return Boolean(scope);
				})
				: [];
		}
	} catch (error) {
		debug.authStatus = "error";
	}

	return debug;
}

function getEmailsSheet_() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	if (!ss) {
		return null;
	}

	return ss.getSheetByName("EMAILS");
}

function getMetricsSheet_() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	if (!ss) {
		return null;
	}

	return ss.getSheetByName("METRICS");
}

function findEmailRowByAddress_(email) {
	const sheet = getEmailsSheet_();
	const targetCandidates = Array.isArray(email)
		? email.map(function(candidate) {
			return normalizeEmailAddress_(candidate);
		}).filter(function(candidate, index, arr) {
			return Boolean(candidate) && arr.indexOf(candidate) === index;
		})
		: getCurrentUserEmailCandidates_().concat(normalizeEmailAddress_(email));
	const candidateSet = targetCandidates.concat(
		targetCandidates.map(function(candidate) {
			return stripPlusAliasFromEmail_(candidate);
		}),
	).filter(function(candidate, index, arr) {
		return Boolean(candidate) && arr.indexOf(candidate) === index;
	});

	if (!sheet || candidateSet.length === 0) {
		return null;
	}

	const lastRow = sheet.getLastRow();
	if (lastRow < 2) {
		return null;
	}

	const rows = sheet.getRange(2, 1, lastRow - 1, 6).getDisplayValues();
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || [];
		const rowEmail = normalizeEmailAddress_(row[1] || "");
		const normalizedRowCandidates = [rowEmail, stripPlusAliasFromEmail_(rowEmail)].filter(function(candidate, index, arr) {
			return Boolean(candidate) && arr.indexOf(candidate) === index;
		});
		const hasMatch = normalizedRowCandidates.some(function(candidate) {
			return candidateSet.indexOf(candidate) !== -1;
		});
		if (hasMatch) {
			return {
				rowNumber: i + 2,
				values: row,
			};
		}
	}

	return null;
}

function buildUserProfileFromEmailRow_(email, rowInfo) {
	const values = rowInfo && rowInfo.values ? rowInfo.values : [];
	const divisionRaw = String(values[0] || "").trim();
	const rowEmail = String(values[1] || email || "").trim().toLowerCase();
	const fullName = String(values[2] || "").trim();
	const divisionMatch = resolveCanonicalDivision_(divisionRaw);
	const firstName = extractFirstNameFromFullName_(fullName);
	const isAdmin = divisionMatch.matched && divisionMatch.canonicalDivision === "Admin";
	const accessAllowed = Boolean(rowInfo && divisionMatch.matched);

	return {
		email: rowEmail,
		rowNumber: rowInfo ? rowInfo.rowNumber : null,
		divisionRaw: divisionRaw,
		divisionCanonical: divisionMatch.canonicalDivision,
		divisionDisplay: divisionMatch.matched ? divisionMatch.canonicalDivision : divisionRaw,
		fullName: fullName,
		firstName: firstName,
		isAdmin: isAdmin,
		hasValidDivision: divisionMatch.matched,
		accessAllowed: accessAllowed,
	};
}

function getCurrentUserProfile_(options) {
	const shouldRefresh = Boolean(options && options.forceRefresh);
	const cacheKey = getCurrentUserSessionCacheKey_();
	if (!shouldRefresh) {
		const cachedProfile = getCachedJson_(cacheKey);
		if (cachedProfile && typeof cachedProfile === "object") {
			return cachedProfile;
		}
	}

	const email = getCurrentUserEmail_();
	const rowInfo = findEmailRowByAddress_(email);
	const profile = rowInfo
		? buildUserProfileFromEmailRow_(email, rowInfo)
		: {
			email: email,
			rowNumber: null,
			divisionRaw: "",
			divisionCanonical: "",
			divisionDisplay: "",
			fullName: "",
			firstName: "",
			isAdmin: false,
			hasValidDivision: false,
			accessAllowed: false,
		};

	if (options && options.incrementVisits && profile.rowNumber) {
		incrementEmailCounter_(profile.rowNumber, 4, 1);
	}

	setCachedJson_(cacheKey, profile, 21600);

	return profile;
}

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

function getAccessDeniedMessage_() {
	return "You do not have access to this chatbot, please contact an admin.";
}

function getCommschedDivisionDeniedMessage_(poNumber) {
	return "Your division does not have access to <b>PO " + poNumber + "</b>.";
}

function getRequestContext_(options) {
	const userProfile = options && options.userProfile ? options.userProfile : getCurrentUserProfile_();
	const triggerSource =
		options && typeof options === "object" && !Array.isArray(options) && options.triggerSource
			? String(options.triggerSource || "query")
			: typeof options === "string"
				? String(options || "query")
				: "query";
	const confirmedUnGrdEntityType =
		options && typeof options === "object" && !Array.isArray(options) && options.confirmedUnGrdEntityType
			? String(options.confirmedUnGrdEntityType || "").trim().toLowerCase()
			: "";

	return {
		triggerSource: triggerSource,
		userProfile: userProfile,
		confirmedUnGrdEntityType: confirmedUnGrdEntityType,
	};
}

function rowMatchesUserDivision_(rowDivisionValue, userProfile) {
	if (!userProfile || !userProfile.accessAllowed) {
		return false;
	}

	if (userProfile.isAdmin) {
		return true;
	}

	const resolvedRowDivision = resolveCanonicalDivision_(rowDivisionValue);
	if (!resolvedRowDivision.matched) {
		return false;
	}

	return resolvedRowDivision.canonicalDivision === userProfile.divisionCanonical;
}

/****************** COMMSCHED SHARED HELPERS ******************/

function getCommschedNotFoundMessage_(poNumber) {
	return "Cannot find <b>PO " + poNumber + "</b>. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
}

function getCommschedNoDataMessage_(poNumber) {
	return "No data found for <b>PO " + poNumber + "</b>.";
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

	text = text.replace(/[^0-9.\-]/g, "");
	const numeric = parseFloat(text);
	if (isNaN(numeric)) return NaN;
	return negative ? -Math.abs(numeric) : numeric;
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
		const amount = parseDisplayAmount_(values[amountField]);
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

function getGeminiResponse(userText, options) {
	const CONFIDENCE_THRESHOLD = 0.5;
	const fallback = "Sorry, I’m not sure I understood that.";
	const requestContext = getRequestContext_(options);
	const userProfile = requestContext.userProfile || getCurrentUserProfile_();

	if (userProfile && userProfile.rowNumber) {
		incrementEmailCounter_(userProfile.rowNumber, 5, 1);
	}

	if (!userProfile || !userProfile.accessAllowed) {
		return getAccessDeniedMessage_();
	}

	const parsed = parseInput(userText);
	if (parsed && parsed.error) {
		return parsed.error;
	}
	if (!parsed || !parsed.intent) {
		return fallback;
	}

	let intent = INTENTS.find((i) => i.name === parsed.intent);
	if (!intent) return fallback;

	const isUnGrdCheckIntent =
		intent.handler === "checkTotalUnGrdVendor" ||
		intent.handler === "checkTotalUnGrdDivision";
	const explicitHint = isUnGrdCheckIntent ? getUnGrdEntityHint_(userText) : "";
	const confirmedHint = isUnGrdCheckIntent ? String(requestContext.confirmedUnGrdEntityType || "").trim().toLowerCase() : "";
	const effectiveHint = explicitHint || confirmedHint;

	if (isUnGrdCheckIntent) {
		if (!effectiveHint) {
			return buildUnGrdEntityDisambiguation_(userText);
		}
		if (!explicitHint && confirmedHint) {
			// Keep the confirmed type active for follow-up fuzzy matches until the handler resolves cleanly.
			requestContext.confirmedUnGrdEntityType = confirmedHint;
		}

		if (effectiveHint === "division" && intent.handler !== "checkTotalUnGrdDivision") {
			const divisionIntent = INTENTS.find((i) => i && i.handler === "checkTotalUnGrdDivision");
			if (divisionIntent) {
				intent = divisionIntent;
			}
		} else if (effectiveHint === "vendor" && intent.handler !== "checkTotalUnGrdVendor") {
			const vendorIntent = INTENTS.find((i) => i && i.handler === "checkTotalUnGrdVendor");
			if (vendorIntent) {
				intent = vendorIntent;
			}
		}
	}

	if (parsed.confidence < CONFIDENCE_THRESHOLD) {
		const didYouMean = showDidYouMean(parsed.suggestions);
		if (
			didYouMean &&
			typeof didYouMean === "object" &&
			Array.isArray(didYouMean.suggestions) &&
			didYouMean.suggestions.length > 0 &&
			userProfile.rowNumber
		) {
			incrementEmailCounter_(userProfile.rowNumber, 6, 1);
		}
		return didYouMean;
	}

	const handlers = {
		checkPoStatus: checkPoStatus,
		checkPoGrStatus: checkPoGrStatus,
		checkPoRemainingBalance: checkPoRemainingBalance,
		checkPoLatestGrDate: checkPoLatestGrDate,
		checkPoTotalValue: checkPoTotalValue,
		checkPoAging: checkPoAging,
		listPoAging: listPoAging,
		listProjectDelayedClosure: listProjectDelayedClosure,
		listPoUrgentCleanup: listPoUrgentCleanup,
		listPoVendor: listPoVendor,
		checkTotalUnGrdVendor: checkTotalUnGrdVendor,
		listTotalUnGrdVendor: listTotalUnGrdVendor,
		checkTotalUnGrdDivision: checkTotalUnGrdDivision,
		listTotalUnGrdDivision: listTotalUnGrdDivision,
		listPoDormant: listPoDormant,
		listPoVendorRemainingBalance: listPoVendorRemainingBalance,
		listVendorRemainingBalance: listVendorRemainingBalance,
	};

	const handler = handlers[intent.handler];
	if (typeof handler !== "function") {
		return fallback;
	}

	incrementMetricCounter_(intent.handler, requestContext.triggerSource);

	const required = intent.requiredEntities || [];
	const entities = parsed.entities || {};
	const missingRequired = required.find((key) => !entities[key]);
	if (missingRequired) {
		// Provide structured pendingIntent metadata so the client
		// can remember the original intent and slot type for one-turn slot-filling.
		const prompt = getMissingEntityMessage(missingRequired);
		const pending = {
			intent: parsed && parsed.intent ? parsed.intent : null,
			missingEntity: missingRequired,
			phrase:
				missingRequired === "AGE_FILTER"
					? "List all POs X old"
					: parsed && parsed.matchedPhrase
						? parsed.matchedPhrase
						: null,
		};

		// For safer behavior: return pendingIntent for vendor, division and PO number so the
		// client can stitch a short reply (vendor/division name or 10-digit PO) back into the
		// original intent. Other missing entities still receive a plain prompt.
		if (missingRequired === "PO_NUMBER" || missingRequired === "VENDOR" || missingRequired === "DIVISION" || missingRequired === "AGE_FILTER") {
			const response = (typeof prompt === "object" && prompt) ? Object.assign({}, prompt) : { text: String(prompt || "") };
			response.pendingIntent = pending;
			return response;
		}

		return prompt;
	}
	return handler(entities, parsed, requestContext);
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
		// normalize non-breaking and other odd space characters to regular space
		.replace(/\u00A0/g, " ")
		// normalize fancy apostrophes/quotes to straight apostrophe
		.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`’‘]/g, "'")
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
	return findFirstVisibleSheet_(workbook);
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
			vendor: { match: "exact", value: "Vendor’s Name" },
			division: { match: "exact", value: "Division" },
			project: { match: "exact", value: "Project" },
			poNumber: { match: "exact", value: "PO Number" },
			poDate: { match: "exact", value: "PO Date" },
			poSla: { match: "exact", value: "PO SLA" },
			currency: { match: "exact", value: "Currency" },
			poAmount: { match: "exact", value: "PO Amount" },
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
		fields: {},
		fieldPropertyNames: {},
	},
};

function resolveDatasetUserProfile_(options) {
	if (options && options.userProfile) {
		return options.userProfile;
	}
	if (
		options &&
		typeof options === "object" &&
		!Array.isArray(options) &&
		options.email !== undefined &&
		options.accessAllowed !== undefined
	) {
		return options;
	}

	return getCurrentUserProfile_();
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