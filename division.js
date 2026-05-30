/**
 * division.js — Division normalization, canonical resolution, similarity scoring.
 *
 * - `CANONICAL_DIVISIONS_` defines the 10 valid division names including "Admin".
 * - `resolveCanonicalDivision_()` is the primary entry point: given a raw
 *   division string from a sheet cell or user query, it returns { matched,
 *   canonicalDivision, score } using exact match first, then a weighted
 *   Jaccard + Levenshtein + acronym similarity score (threshold 0.58).
 * - `scoreDivisionSimilarity_()` strips parentheticals (e.g. "(CIPE)"),
 *   removes stop-words, tokenizes, and compares candidate tokens against
 *   each canonical division.
 * - `buildAcronymFromTokens_()` helps match acronyms like "CIPE" ↔
 *   "Common Infra Planning and Engineering".
 * - `extractFirstNameFromFullName_()` is included here because it shares the
 *   same text-cleaning concerns (strip non-alpha, title-case first token).
 *
 * Dependencies: parser.js (normalizeText, tokenize, jaccardSimilarity,
 *               normalizedLevenshteinSimilarity).
 * Used by: auth.js (buildUserProfileFromEmailRow_, rowMatchesUserDivision_),
 *          fuzzy.js (buildDivisionDidYouMeanResponse_), handlers_agg.js,
 *          handlers_list.js.
 */

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
