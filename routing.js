/**
 * routing.js — Intent routing, request context, historical date extraction.
 *
 * - `extractHistoricalReferenceDate_()` parses natural-language date references
 *   like "back in April 12" or "in May" from the user's raw text so COMMSCHED
 *   queries can select the correct historical source row from LINKS.
 * - `getRequestContext_(options)` assembles the { triggerSource, userProfile,
 *   referenceDate, confirmedUnGrdEntityType } context object passed to every
 *   handler. It derives referenceDate from the raw user text automatically.
 * - `getIntentInfo(userText)` is a lightweight server-side intent check used
 *   by the React client to decide whether to show a "please wait" message for
 *   list queries.
 * - `getGeminiResponse(userText, options)` is THE central routing function
 *   called by google.script.run from Index.html. It:
 *   1. Increments the EMAILS query counter (column E).
 *   2. Denies access if the user profile is invalid.
 *   3. Parses user text via parser.js.
 *   4. Routes low-confidence results to showDidYouMean with countError.
 *   5. Handles unGR'd vendor/division disambiguation.
 *   6. Dispatches to the appropriate handler function from the handlers map.
 *   7. Increments the METRICS counter (column B for query, C for menu).
 *   8. Handles missing entities with pendingIntent slot-filling metadata.
 *   9. Passes the handler result through finalizeBotResponse_ for error counting.
 *
 * Dependencies: parser.js (parseInput), intent.js (INTENTS), auth.js
 *               (getCurrentUserProfile_, getEmailSheetColumnMap_),
 *               counter.js (incrementEmailCounter_, incrementMetricCounter_),
 *               messages.js (showDidYouMean, getAccessDeniedMessage_,
 *               getMissingEntityMessage, buildUnGrdEntityDisambiguation_,
 *               finalizeBotResponse_), sheets.js (parseDateValue_),
 *               division.js (normalizeDashCharacters_).
 * Called from: Index.html (google.script.run.getGeminiResponse,
 *              google.script.run.getIntentInfo).
 */

function extractHistoricalReferenceDate_(rawText) {
	const text = String(rawText || "").trim();
	if (!text) {
		return null;
	}

	const normalizedText = normalizeDashCharacters_(text);
	const explicitDateMatch = normalizedText.match(/\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/);
	if (explicitDateMatch && explicitDateMatch[1]) {
		const explicitDate = parseDateValue_(explicitDateMatch[1]);
		if (explicitDate) {
			return explicitDate;
		}
	}

	const monthPattern = /\b(?:back\s+in\s+|in\s+|as\s+of\s+|on\s+|from\s+|for\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\.?)(?:\s+(\d{1,2}))?(?:,?\s*((?:19|20)\d{2}|\d{2}))?\b/i;
	const monthMatch = normalizedText.match(monthPattern);
	if (!monthMatch || !monthMatch[1]) {
		return null;
	}

	const monthName = String(monthMatch[1] || "").toLowerCase();
	const monthLookup = {
		jan: 0, january: 0,
		feb: 1, february: 1,
		mar: 2, march: 2,
		apr: 3, april: 3,
		may: 4,
		jun: 5, june: 5,
		jul: 6, july: 6,
		aug: 7, august: 7,
		sep: 8, sept: 8, september: 8,
		oct: 9, october: 9,
		nov: 10, november: 10,
		dec: 11, december: 11,
	};
	const monthIndex = typeof monthLookup[monthName] === "number"
		? monthLookup[monthName]
		: monthLookup[monthName.slice(0, 3)];
	if (typeof monthIndex !== "number") {
		return null;
	}

	const day = monthMatch[2] ? Number(monthMatch[2]) : 1;
	let year = monthMatch[3] ? Number(monthMatch[3]) : (new Date()).getFullYear();
	if (monthMatch[3] && String(monthMatch[3]).length === 2) {
		year += 2000;
	}

	const parsed = new Date(year, monthIndex, day);
	if (
		!isNaN(parsed.getTime()) &&
		parsed.getFullYear() === year &&
		parsed.getMonth() === monthIndex &&
		parsed.getDate() === day
	) {
		return parsed;
	}

	return null;
}

function getRequestContext_(options) {
	const userProfile = options && options.userProfile ? options.userProfile : getCurrentUserProfile_();
	const triggerSource =
		options && typeof options === "object" && !Array.isArray(options) && options.triggerSource
			? String(options.triggerSource || "query")
			: typeof options === "string"
				? String(options || "query")
				: "query";
	const rawText = options && typeof options === "object" && !Array.isArray(options) && options.rawText
		? String(options.rawText || "")
		: "";
	const confirmedUnGrdEntityType =
		options && typeof options === "object" && !Array.isArray(options) && options.confirmedUnGrdEntityType
			? String(options.confirmedUnGrdEntityType || "").trim().toLowerCase()
			: "";
	const confirmedEntityType =
		options && typeof options === "object" && !Array.isArray(options) && options.confirmedEntityType
			? String(options.confirmedEntityType || "").trim().toLowerCase()
			: confirmedUnGrdEntityType;
	const explicitReferenceDate = options && typeof options === "object" && !Array.isArray(options) && options.referenceDate
		? parseDateValue_(options.referenceDate)
		: null;
	const referenceDate = explicitReferenceDate || extractHistoricalReferenceDate_(rawText);

	return {
		triggerSource: triggerSource,
		userProfile: userProfile,
		confirmedUnGrdEntityType: confirmedUnGrdEntityType,
		confirmedEntityType: confirmedEntityType,
		referenceDate: referenceDate,
	};
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
	const fallback = "Sorry, I'm not sure I understood that.";
	const requestContext = getRequestContext_(Object.assign({}, options || {}, { rawText: userText }));
	const userProfile = requestContext.userProfile || getCurrentUserProfile_();
	const emailColumns = userProfile && userProfile.emailColumns ? userProfile.emailColumns : getEmailSheetColumnMap_();
	const queryColumn = typeof emailColumns.queries === "number" ? emailColumns.queries + 1 : 5;

	if (userProfile && userProfile.rowNumber) {
		incrementEmailCounter_(userProfile.rowNumber, queryColumn, 1);
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
	let parsedEntities = Object.assign({}, parsed.entities || {});
	const rawEntityText = String(parsedEntities.DIVISION || parsedEntities.VENDOR || "").trim();
	const entityHint = /\bdivision\b/i.test(userText)
		? "division"
		: (/\bvendor\b/i.test(userText) ? "vendor" : "");
	const confirmedEntityHint = String(requestContext.confirmedEntityType || "").trim().toLowerCase();

	if (intent.handler === "checkTotalPoAmountVendor") {
		if (confirmedEntityHint === "division") {
			const divisionIntent = INTENTS.find((i) => i && i.handler === "checkTotalPoAmountDivision");
			if (divisionIntent) {
				intent = divisionIntent;
				parsedEntities.DIVISION = rawEntityText || parsedEntities.DIVISION || "";
			}
		} else if (confirmedEntityHint === "vendor") {
			parsedEntities.VENDOR = rawEntityText || parsedEntities.VENDOR || "";
		} else {
			const resolvedDivision = rawEntityText ? resolveCanonicalDivision_(rawEntityText) : null;
			const confidentDivision = resolvedDivision ? isConfidentDivisionMatch_(resolvedDivision, 0.8) : false;

			if (entityHint === "division" || confidentDivision) {
				const divisionIntent = INTENTS.find((i) => i && i.handler === "checkTotalPoAmountDivision");
				if (divisionIntent) {
					intent = divisionIntent;
					parsedEntities.DIVISION = rawEntityText || parsedEntities.DIVISION || "";
				}
			} else {
				return buildVendorDivisionDisambiguation_(userText);
			}
		}
	}

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
		return finalizeBotResponse_(showDidYouMean(parsed.suggestions, { countError: true }), userProfile);
	}

	const handlers = {
		checkPoStatus: checkPoStatus,
		checkPoGrStatus: checkPoGrStatus,
		checkPoGrAmount: checkPoGrAmount,
		checkPoRemainingBalance: checkPoRemainingBalance,
		checkPoLatestGrDate: checkPoLatestGrDate,
		checkPoTotalValue: checkPoTotalValue,
		checkPoAging: checkPoAging,
		checkPoFullyGrd: checkPoFullyGrd,
		checkPoYear: checkPoYear,
		checkGrTicketStatus: checkGrTicketStatus,
		checkGrTicketSubmitted: checkGrTicketSubmitted,
		listPoAging: listPoAging,
		listProjectDelayedClosure: listProjectDelayedClosure,
		listPoUrgentCleanup: listPoUrgentCleanup,
		listPoVendor: listPoVendor,
		listOpenPosForVendor: listOpenPosForVendor,
		listGrMovement: listGrMovement,
		listGrStagnant: listGrStagnant,
		listPoTaggedForClosure: listPoTaggedForClosure,
		listPoNotForClosure: listPoNotForClosure,
		listPoLowGrPercent: listPoLowGrPercent,
		checkTotalUnGrdVendor: checkTotalUnGrdVendor,
		listTotalUnGrdVendor: listTotalUnGrdVendor,
		checkTotalUnGrdDivision: checkTotalUnGrdDivision,
		listTotalUnGrdDivision: listTotalUnGrdDivision,
		listPoDormant: listPoDormant,
		listPoVendorRemainingBalance: listPoVendorRemainingBalance,
		listVendorRemainingBalance: listVendorRemainingBalance,
		listVendorPendingGrAboveThreshold: listVendorPendingGrAboveThreshold,
		checkTotalPoAmountVendor: checkTotalPoAmountVendor,
		checkTotalPoAmountDivision: checkTotalPoAmountDivision,
		checkDownpaymentVendor: checkDownpaymentVendor,
		checkDownpaymentPO: checkDownpaymentPO,
		listPoValueByDivision: listPoValueByDivision,
		listPosByProject: listPosByProject,
		listProjectsByDivision: listProjectsByDivision,
		listActivePosForProponent: listActivePosForProponent,
		listServicesPosByDivisionAndType: listServicesPosByDivisionAndType,
	};

	const handler = handlers[intent.handler];
	if (typeof handler !== "function") {
		return fallback;
	}

	incrementMetricCounter_(intent.handler, requestContext.triggerSource);

	const required = intent.requiredEntities || [];
	const entities = parsedEntities;
	const missingRequired = required.find((key) => !entities[key]);
	if (missingRequired) {
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

		if (missingRequired === "PO_NUMBER" || missingRequired === "VENDOR" || missingRequired === "DIVISION" || missingRequired === "AGE_FILTER" || missingRequired === "GR_NUMBER") {
			const response = (typeof prompt === "object" && prompt) ? Object.assign({}, prompt) : { text: String(prompt || "") };
			response.pendingIntent = pending;
			return response;
		}

		return prompt;
	}
	return finalizeBotResponse_(handler(entities, parsed, requestContext), userProfile);
}
