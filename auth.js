/**
 * auth.js — User identity, EMAILS/METRICS sheet access, access control.
 *
 * - Resolves the current user via Session.getActiveUser() / getEffectiveUser()
 *   with plus-alias normalization so user+tag@domain.com matches user@domain.com.
 * - Reads worksheet "EMAILS" to map email → division, full name, and row number.
 *   Columns are resolved from header names first, then fall back to A:F.
 * - Reads worksheet "METRICS" to find per-handler counter rows.
 * - `getCurrentUserProfile_()` caches results in ScriptCache for 6 hours;
 *   pass { forceRefresh: true, incrementVisits: true } to bypass cache and
 *   increment the EMAILS visits column via counter.js.
 * - `rowMatchesUserDivision_()` compares a raw division string against the
 *   canonical user division; admins always pass.
 *
 * Dependencies: division.js (resolveCanonicalDivision_), sheets.js (cache),
 *               counter.js (incrementEmailCounter_).
 * Used by: routing.js (getGeminiResponse → getCurrentUserProfile_), Code.js
 *          (doGet → getCurrentUserProfile_), sheets.js (resolveDatasetUserProfile_).
 */

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

function getEmailSheetColumnMap_() {
	const fallback = {
		division: 0,
		email: 1,
		fullName: 2,
		visits: 3,
		queries: 4,
		errors: 5,
	};

	const sheet = getEmailsSheet_();
	if (!sheet) {
		return fallback;
	}

	const lastColumn = sheet.getLastColumn();
	if (lastColumn < 1) {
		return fallback;
	}

	let headerValues = [];
	try {
		headerValues = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0] || [];
	} catch (error) {
		return fallback;
	}

	const headerIndexByName = {};
	for (let i = 0; i < headerValues.length; i += 1) {
		const headerKey = normalizeHeaderText_(headerValues[i]);
		if (headerKey && typeof headerIndexByName[headerKey] !== "number") {
			headerIndexByName[headerKey] = i;
		}
	}

	const resolveIndex = function(candidateNames, fallbackIndex) {
		const names = Array.isArray(candidateNames) ? candidateNames : [candidateNames];
		for (let i = 0; i < names.length; i += 1) {
			const normalized = normalizeHeaderText_(names[i]);
			if (normalized && typeof headerIndexByName[normalized] === "number") {
				return headerIndexByName[normalized];
			}
		}

		return fallbackIndex;
	};

	return {
		division: resolveIndex(["division"], fallback.division),
		email: resolveIndex(["email"], fallback.email),
		fullName: resolveIndex(["full name", "fullname", "name"], fallback.fullName),
		visits: resolveIndex(["no. of visits", "no of visits", "visits"], fallback.visits),
		queries: resolveIndex(["no. of queries", "no of queries", "queries"], fallback.queries),
		errors: resolveIndex(["no. of errors", "no of errors", "errors"], fallback.errors),
	};
}

function findEmailRowByAddress_(email) {
	const sheet = getEmailsSheet_();
	const columnMap = getEmailSheetColumnMap_();
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

	const lastColumn = Math.max(sheet.getLastColumn(), columnMap.errors + 1, columnMap.fullName + 1);
	const rows = sheet.getRange(2, 1, lastRow - 1, lastColumn).getDisplayValues();
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || [];
		const rowEmail = normalizeEmailAddress_(row[columnMap.email] || "");
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
				columnMap: columnMap,
			};
		}
	}

	return null;
}

function buildUserProfileFromEmailRow_(email, rowInfo) {
	const values = rowInfo && rowInfo.values ? rowInfo.values : [];
	const columnMap = rowInfo && rowInfo.columnMap ? rowInfo.columnMap : getEmailSheetColumnMap_();
	const divisionRaw = String(values[columnMap.division] || "").trim();
	const rowEmail = String(values[columnMap.email] || email || "").trim().toLowerCase();
	const fullName = String(values[columnMap.fullName] || "").trim();
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
		emailColumns: columnMap,
	};
}

function getCurrentUserProfile_(options) {
	const shouldRefresh = Boolean(options && options.forceRefresh);
	const cacheKey = getCurrentUserSessionCacheKey_();
	if (!shouldRefresh) {
		const cachedProfile = getCachedJson_(cacheKey);
		if (cachedProfile && typeof cachedProfile === "object") {
			if (!cachedProfile.emailColumns) {
				cachedProfile.emailColumns = getEmailSheetColumnMap_();
			}
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
			emailColumns: getEmailSheetColumnMap_(),
		};

	if (options && options.incrementVisits && profile.rowNumber) {
		const visitColumn = profile.emailColumns && typeof profile.emailColumns.visits === "number"
			? profile.emailColumns.visits + 1
			: 4;
		incrementEmailCounter_(profile.rowNumber, visitColumn, 1);
	}

	if (!profile.emailColumns) {
		profile.emailColumns = getEmailSheetColumnMap_();
	}

	setCachedJson_(cacheKey, profile, 21600);

	return profile;
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
