/**
 * handlers_list.js — List and table-response handlers.
 *
 * Each handler returns either a markdown table string, a structured
 * { text, download } object (via buildTableResponse_), or a short text reply.
 *
 * - `listPoAging`                → POs matching an aging bucket filter
 * - `listProjectDelayedClosure`  → one row per project, oldest Latest GR Date,
 *                                  only PO SLA = e. >24 months
 * - `listPoUrgentCleanup`        → e. >24 months AND DELIV COMPLETE? = NO
 * - `listPoVendor`               → all POs from a fuzzy-matched vendor
 * - `listPoDormant`              → POs with blank/zero Goods Receipt
 * - `listPoVendorRemainingBalance` → top 10 POs by unGR'd balance
 * - `listVendorRemainingBalance` → top 10 vendors by remaining balance
 * - `listPoValueByDivision`      → total PO amount grouped by division+currency
 * - `listPosByProject`           → all POs under a fuzzy-matched project
 * - `listProjectsByDivision`     → distinct project names in a division
 * - `listActivePosForProponent`  → open POs for a vendor/proponent
 * - `listServicesPosByDivisionAndType` → service POs in a division
 * - `listOpenPosForVendor`       → open POs (not YES deliveryComplete)
 * - `listPoTaggedForClosure`     → canned text reply (2023 and earlier)
 * - `listPoNotForClosure`        → canned text reply (2024 onwards)
 * - `listPoLowGrPercent`         → POs with GR bucket cells below a threshold (default 30%)
 * - `listGrMovement`             → POs with Latest GR Date in a date range
 * - `listGrStagnant`             → POs with no GR movement in N days
 *
 * Backward-compatible aliases:
 * - `listPosWithGrMovementBetween` → `listGrMovement`
 * - `listPosStagnantGr`            → `listGrStagnant`
 *
 * `extractDatesFromText_()` is a shared helper for date-range list handlers.
 *
 * Dependencies: sheets.js (getCommschedRows_, parseDateValue_),
 *               format.js (parseDisplayAmount_, formatMoney_, formatCount_,
 *               getPoSlaBucketInfo_, resolvePoSlaBucketCellsForFilter_),
 *               fuzzy.js (collectUniqueColumnValues_, buildFuzzyEntityMatch_,
 *               buildDivisionDidYouMeanResponse_),
 *               messages.js (getMissingEntityMessage, buildTableResponse_,
 *               buildCsvContent_).
 * Routed from: routing.js (getGeminiResponse → handlers dispatch table).
 */

function listPoAging(entities, parsed, context) {
	const rawAgeFilter = String(entities.AGE_FILTER || "").trim();
	const allowedBuckets = resolvePoSlaBucketCellsForFilter_(rawAgeFilter);
	if (!allowedBuckets || allowedBuckets.length === 0) {
		const prompt = getMissingEntityMessage("AGE_FILTER");
		const response = (typeof prompt === "object" && prompt) ? Object.assign({}, prompt) : { text: String(prompt || "") };
		response.pendingIntent = {
			intent: parsed && parsed.intent ? parsed.intent : "list_po_aging",
			missingEntity: "AGE_FILTER",
			phrase: "List all POs X old",
		};
		return response;
	}

	const dataset = getCommschedRows_( ["poNumber", "poSla"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const matches = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const poSlaValue = String(row.values && row.values.poSla ? row.values.poSla : "").trim();
		const bucketInfo = getPoSlaBucketInfo_(poSlaValue);
		if (!poNumber || !bucketInfo) {
			continue;
		}

		if (allowedBuckets.indexOf(bucketInfo.cellValue) === -1) {
			continue;
		}

		matches.push({
			poNumber: poNumber,
			poSla: bucketInfo.cellValue,
			rank: bucketInfo.rank,
		});
	}

	if (matches.length === 0) {
		return "No matching POs found.";
	}

	matches.sort(function(a, b) {
		if (a.rank !== b.rank) {
			return a.rank - b.rank;
		}

		return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
	});

	const headers = ["PO Number", "PO SLA"];
	const csvRows = matches.map(function(match) {
		return [match.poNumber, match.poSla];
	});
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, csvRows, {
		includeCsvDownload: true,
		csvFilename: "sia-response-" + timestamp + ".csv",
	});
}

function listProjectDelayedClosure(entities, parsed, context) {
	const dataset = getCommschedRows_(["project", "poNumber", "poSla", "latestGrDate"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const selectedByProject = {};

	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const projectName = String(row.values && row.values.project ? row.values.project : "").trim();
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const poSlaValue = String(row.values && row.values.poSla ? row.values.poSla : "").trim();
		if (!projectName || !poNumber || !poSlaValue) {
			continue;
		}

		const bucketInfo = getPoSlaBucketInfo_(poSlaValue);
		if (!bucketInfo || bucketInfo.cellValue !== "e. >24 months") {
			continue;
		}

		const latestGrDateRaw = row.rawValues && Object.prototype.hasOwnProperty.call(row.rawValues, "latestGrDate")
			? row.rawValues.latestGrDate
			: "";
		const parsedLatestGrDate = parseDateValue_(latestGrDateRaw);
		const existing = selectedByProject[projectName];
		if (!existing) {
			selectedByProject[projectName] = {
				project: projectName,
				poNumber: poNumber,
				latestGrDate: parsedLatestGrDate,
				latestGrDateValue: String(row.values && row.values.latestGrDate ? row.values.latestGrDate : "").trim(),
				rowNumber: row.rowNumber || 0,
			};
			continue;
		}

		const existingHasDate = existing.latestGrDate instanceof Date && !isNaN(existing.latestGrDate.getTime());
		const candidateHasDate = parsedLatestGrDate instanceof Date && !isNaN(parsedLatestGrDate.getTime());

		let shouldReplace = false;
		if (!existingHasDate && candidateHasDate) {
			shouldReplace = true;
		} else if (existingHasDate && candidateHasDate) {
			const existingTime = existing.latestGrDate.getTime();
			const candidateTime = parsedLatestGrDate.getTime();
			if (candidateTime < existingTime) {
				shouldReplace = true;
			} else if (candidateTime === existingTime) {
				const existingPo = String(existing.poNumber || "").trim();
				shouldReplace = String(poNumber).localeCompare(existingPo) < 0;
			}
		} else if (!existingHasDate && !candidateHasDate) {
			const existingRowNumber = Number(existing.rowNumber || 0);
			const candidateRowNumber = Number(row.rowNumber || 0);
			if (candidateRowNumber < existingRowNumber) {
				shouldReplace = true;
			}
		}

		if (shouldReplace) {
			selectedByProject[projectName] = {
				project: projectName,
				poNumber: poNumber,
				latestGrDate: parsedLatestGrDate,
				latestGrDateValue: String(row.values && row.values.latestGrDate ? row.values.latestGrDate : "").trim(),
				rowNumber: row.rowNumber || 0,
			};
		}
	}

	const matches = Object.keys(selectedByProject).map(function(projectName) {
		const item = selectedByProject[projectName];
		return {
			project: item.project,
			poNumber: item.poNumber,
			latestGrDate: item.latestGrDate instanceof Date && !isNaN(item.latestGrDate.getTime())
				? item.latestGrDate
				: null,
			latestGrDateValue: item.latestGrDateValue || "",
			rowNumber: item.rowNumber || 0,
		};
	});

	if (matches.length === 0) {
		return "No delayed closure projects found.";
	}

	matches.sort(function(a, b) {
		const aHasDate = a.latestGrDate instanceof Date && !isNaN(a.latestGrDate.getTime());
		const bHasDate = b.latestGrDate instanceof Date && !isNaN(b.latestGrDate.getTime());
		if (aHasDate && bHasDate) {
			const diff = a.latestGrDate.getTime() - b.latestGrDate.getTime();
			if (diff !== 0) {
				return diff;
			}
		}
		if (aHasDate !== bHasDate) {
			return aHasDate ? -1 : 1;
		}
		const projectCompare = String(a.project || "").localeCompare(String(b.project || ""));
		if (projectCompare !== 0) {
			return projectCompare;
		}
		return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
	});

	function formatLatestGrDate(value, fallback) {
		if (value instanceof Date && !isNaN(value.getTime())) {
			return Utilities.formatDate(value, Session.getScriptTimeZone(), "MMM d, yyyy");
		}
		return String(fallback || "").trim();
	}

	const headers = ["Project", "PO Number", "Latest GR Date"];
	const csvRows = matches.map(function(match) {
		return [
			match.project,
			match.poNumber,
			formatLatestGrDate(match.latestGrDate, match.latestGrDateValue),
		];
	});
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, csvRows, {
		includeCsvDownload: true,
		csvFilename: "sia-project-delayed-closure-" + timestamp + ".csv",
	});
}

function listPoUrgentCleanup(entities, parsed, context) {
	const dataset = getCommschedRows_(["vendor", "poNumber", "poSla", "deliveryComplete"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const matches = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const poSlaValue = String(row.values && row.values.poSla ? row.values.poSla : "").trim();
		const deliveryCompleteValue = String(row.values && row.values.deliveryComplete ? row.values.deliveryComplete : "").trim().toUpperCase();

		if (!vendorName || !poNumber || !poSlaValue) {
			continue;
		}

		const bucketInfo = getPoSlaBucketInfo_(poSlaValue);
		if (!bucketInfo || bucketInfo.cellValue !== "e. >24 months") {
			continue;
		}

		if (deliveryCompleteValue !== "NO") {
			continue;
		}

		matches.push({
			vendor: vendorName,
			poNumber: poNumber,
		});
	}

	if (matches.length === 0) {
		return "No urgent cleanup POs found.";
	}

	matches.sort(function(a, b) {
		const vendorCompare = String(a.vendor || "").localeCompare(String(b.vendor || ""));
		if (vendorCompare !== 0) {
			return vendorCompare;
		}

		return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
	});

	const headers = ["Vendor", "PO Number"];
	const csvRows = matches.map(function(match) {
		return [match.vendor, match.poNumber];
	});
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	const tableText = buildTableResponse_(headers, csvRows, {
		includeCsvDownload: false,
	});

	return {
		text: tableText,
		download: {
			filename: "sia-urgent-cleanup-po-response-" + timestamp + ".csv",
			content: buildCsvContent_(headers, csvRows),
			mimeType: "text/csv",
		},
	};
}

function listPoVendor(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || "").trim();
	if (!rawVendor) {
		return getMissingEntityMessage("VENDOR");
	}

	const dataset = getCommschedRows_(["poNumber", "vendor"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const vendorList = collectUniqueColumnValues_(dataset.rows, "vendor");
	const match = buildFuzzyEntityMatch_(rawVendor, vendorList, {
		intentName: "list_po_vendor",
		entityType: "vendor",
		countError: true,
	});

	if (!match.matched) {
		return match.didYouMean || "No matching vendors found.";
	}

	const chosen = match.value;
	const matches = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		if (!poNumber) continue;
		if (vendorName === chosen) {
			matches.push({poNumber: poNumber, vendor: vendorName});
		}
	}

	if (matches.length === 0) return "No matching POs found.";

	const headers = ["PO Number", "Vendor"];
	const csvRows = matches.map(function(m) { return [m.poNumber, m.vendor]; });
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, csvRows, {
		includeCsvDownload: true,
		csvFilename: "sia-response-" + timestamp + ".csv",
	});
}

function listPoDormant(entities, parsed, context) {
	const dataset = getCommschedRows_(["vendor", "poNumber", "goodsReceiptAmount"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const matches = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const goodsReceiptValue = String(row.values && row.values.goodsReceiptAmount ? row.values.goodsReceiptAmount : "").trim();

		if (!vendorName || !poNumber) {
			continue;
		}

		if (!goodsReceiptValue) {
			matches.push({ vendor: vendorName, poNumber: poNumber });
			continue;
		}

		const parsedAmount = parseDisplayAmount_(goodsReceiptValue);
		if (!isNaN(parsedAmount) && parsedAmount === 0) {
			matches.push({ vendor: vendorName, poNumber: poNumber });
		}
	}

	if (matches.length === 0) {
		return "No dormant POs found.";
	}

	matches.sort(function(a, b) {
		const vendorCompare = String(a.vendor || "").localeCompare(String(b.vendor || ""));
		if (vendorCompare !== 0) {
			return vendorCompare;
		}

		return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
	});

	const headers = ["Vendor", "PO Number"];
	const csvRows = matches.map(function(match) {
		return [match.vendor, match.poNumber];
	});
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, csvRows, {
		includeCsvDownload: true,
		csvFilename: "sia-dormant-po-response-" + timestamp + ".csv",
	});
}

function listPoVendorRemainingBalance(entities, parsed, context) {
	const dataset = getCommschedRows_( ["poNumber", "vendor", "ungrdUsd"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const rows = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		const balanceRaw = String(row.values && row.values.ungrdUsd ? row.values.ungrdUsd : "").trim();
		if (!poNumber || !balanceRaw) continue;
		const numeric = parseDisplayAmount_(balanceRaw);
		if (isNaN(numeric)) continue;
		rows.push({ poNumber: poNumber, vendor: vendorName, balance: numeric });
	}

	if (rows.length === 0) return "No matching POs found.";

	rows.sort(function(a,b){ return b.balance - a.balance; });
	const top10 = rows.slice(0, 10);

	const lines = [
		"| PO Number | Vendor | Remaining Balance |",
		"| --- | --- | ---: |",
	];
	for (let i = 0; i < top10.length; i += 1) {
		const r = top10[i];
		lines.push("| " + r.poNumber + " | " + r.vendor + " | USD " + formatMoney_(r.balance) + " |");
	}

	return lines.join("\n");
}

function collectVendorRemainingBalanceEntries_(rows) {
	return buildCurrencySummaryEntries_(rows, {
		entityField: "vendor",
		currencyField: "currency",
		amountFieldCandidates: ["remainingBalance", "ungrdUsd"],
		resolveEntity: function(value) {
			const text = String(value || "").trim();
			return text ? { matched: true, key: text, display: text } : { matched: false, key: "", display: "" };
		},
	});
}

function listVendorRemainingBalance(entities, parsed, context) {
	const dataset = getCommschedRows_( ["vendor", "ungrdUsd"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const totals = collectVendorRemainingBalanceEntries_(dataset.rows).map(function(entry) {
		return {
			vendor: entry.entityDisplay || entry.entityKey || "",
			currency: entry.currency || "",
			balance: Number(entry.total || 0),
		};
	});

	if (totals.length === 0) {
		return "No matching vendors found.";
	}

	totals.sort(function(a, b) {
		return b.balance - a.balance;
	});

	const top10 = totals.slice(0, 10);
	const lines = [
		"| Vendor | Remaining Balance |",
		"| --- | ---: |",
	];

	for (let i = 0; i < top10.length; i += 1) {
		const item = top10[i];
		lines.push("| " + item.vendor + " | USD " + formatMoney_(item.balance) + " |");
	}

	return lines.join("\n");
}

function listVendorPendingGrAboveThreshold(entities, parsed, context) {
	const rawAmount = String(entities.AMOUNT || "").trim();
	if (!rawAmount) {
		return getMissingEntityMessage("AMOUNT");
	}

	const threshold = parseAmountExpression_(rawAmount);
	if (isNaN(threshold) || threshold <= 0) {
		return "Please provide a valid amount threshold.";
	}

	const rawText = String(parsed && parsed.rawText ? parsed.rawText : "");
	const currencyHint = /\busd\b|\$/i.test(rawText)
		? "USD"
		: (/\bphp\b|\bph\b|₱/i.test(rawText) ? "PHP" : "");

	const dataset = getCommschedRows_(["vendor", "currency", "remainingBalance", "ungrdUsd"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const entries = collectVendorRemainingBalanceEntries_(dataset.rows).filter(function(entry) {
		const currency = String(entry.currency || "").trim();
		const total = Number(entry.total || 0);
		if (currencyHint && currency && currency.toUpperCase() !== currencyHint) {
			return false;
		}
		return total > threshold;
	});

	if (entries.length === 0) {
		return "No vendors found with pending GR above " + (currencyHint ? currencyHint + " " : "") + formatMoney_(threshold) + ".";
	}

	entries.sort(function(a, b) {
		return Number(b.total || 0) - Number(a.total || 0);
	});

	const rows = entries.map(function(entry) {
		const currency = String(entry.currency || "").trim();
		return [
			entry.entityDisplay || entry.entityKey || "",
			(currency ? currency + " " : "") + formatMoney_(entry.total),
			formatCount_(entry.posCount),
		];
	});

	const headers = ["Vendor", "Remaining Balance", "PO Count"];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, rows, {
		includeCsvDownload: true,
		csvFilename: "sia-vendors-pending-gr-above-" + String(threshold).replace(/\./g, "-") + "-" + timestamp + ".csv",
	});
}

function listPoValueByDivision(entities, parsed, context) {
	const rawDivision = String(entities.DIVISION || '').trim();
	const dataset = getCommschedRows_(['division','currency','poAmount','poAmountUsdK'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const groupMap = {};
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const divisionRaw = String(row.values && row.values.division ? row.values.division : '').trim();
		if (!divisionRaw) continue;
		const resolved = resolveCanonicalDivision_(divisionRaw);
		if (!resolved.matched) continue;
		if (rawDivision) {
			const want = resolveCanonicalDivision_(rawDivision || '');
			if (!want.matched || want.canonicalDivision !== resolved.canonicalDivision) continue;
		}
		const division = resolved.canonicalDivision;
		const currency = String(row.values && row.values.currency ? row.values.currency : '').trim() || '';
		const rawAmt = row.values && row.values.poAmountUsdK !== undefined ? row.values.poAmountUsdK : (row.values && row.values.poAmount !== undefined ? row.values.poAmount : '');
		const num = parseDisplayAmount_(rawAmt);
		if (isNaN(num)) continue;
		const key = division + '||' + currency;
		groupMap[key] = groupMap[key] || { division: division, currency: currency, total: 0, rows: 0 };
		groupMap[key].total += num;
		groupMap[key].rows += 1;
	}

	const entries = Object.keys(groupMap).map(function(k){ return groupMap[k]; });
	if (entries.length === 0) return 'No matching divisions found.';
	entries.sort(function(a,b){ return b.total - a.total; });
	const rows = entries.map(function(v){ return [v.division, (v.currency ? v.currency + ' ' : '') + formatMoney_(v.total), formatCount_(v.rows)]; });
	const headers = ['Division','Total PO Amount','PO Count'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, rows, { includeCsvDownload: true, csvFilename: 'sia-po-value-by-division-' + timestamp + '.csv' });
}

function listPosByProject(entities, parsed, context) {
	const rawProject = String(entities.PROJECT || '').trim();
	if (!rawProject) return getMissingEntityMessage('PROJECT');
	const dataset = getCommschedRows_(['project','poNumber','vendor','poAmount','poAmountUsdK'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const projectList = collectUniqueColumnValues_(dataset.rows, 'project');
	const match = buildFuzzyEntityMatch_(rawProject, projectList, {
		intentName: 'list_pos_by_project',
		entityType: 'project',
		countError: true,
	});
	if (!match.matched) {
		return match.didYouMean || 'No matching projects found.';
	}

	const chosen = match.value;
	const matches = [];
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const projectName = String(row.values && row.values.project ? row.values.project : '').trim();
		if (!projectName || projectName !== chosen) continue;
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : '').trim();
		const vendor = String(row.values && row.values.vendor ? row.values.vendor : '').trim();
		const rawAmt = row.values && row.values.poAmountUsdK !== undefined ? row.values.poAmountUsdK : (row.values && row.values.poAmount !== undefined ? row.values.poAmount : '');
		matches.push([poNumber, vendor, (rawAmt || '')]);
	}
	if (matches.length === 0) return 'No matching POs found for project.';
	const headers = ['PO Number','Vendor','PO Amount'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, matches, { includeCsvDownload: true, csvFilename: 'sia-pos-by-project-' + timestamp + '.csv' });
}

function listProjectsByDivision(entities, parsed, context) {
	const rawDivision = String(entities.DIVISION || '').trim();
	if (!rawDivision) return getMissingEntityMessage('DIVISION');
	const resolved = resolveCanonicalDivision_(rawDivision || '');
	if (!resolved.matched) {
		return buildDivisionDidYouMeanResponse_(rawDivision, 'list_projects_by_division', { countError: true });
	}

	const dataset = getCommschedRows_(['division','project'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';
	const projects = {};
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const rowDivision = String(row.values && row.values.division ? row.values.division : '').trim();
		if (!rowDivision) continue;
		const r = resolveCanonicalDivision_(rowDivision);
		if (!r.matched || r.canonicalDivision !== resolved.canonicalDivision) continue;
		const project = String(row.values && row.values.project ? row.values.project : '').trim();
		if (project) projects[project] = true;
	}
	const list = Object.keys(projects).sort();
	if (list.length === 0) return 'No projects found for division ' + resolved.canonicalDivision + '.';
	const rows = list.map(function(p){ return [p]; });
	const headers = ['Project'];
	return buildTableResponse_(headers, rows, { includeCsvDownload: false });
}

function listActivePosForProponent(entities, parsed, context) {
	const rawName = String(entities.VENDOR || entities.PROPONENT || '').trim();
	if (!rawName) return getMissingEntityMessage('VENDOR');
	const dataset = getCommschedRows_(['vendor','proponent','poNumber','poAmount','deliveryComplete'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const nameList = collectUniqueColumnValues_(dataset.rows, 'vendor').concat(collectUniqueColumnValues_(dataset.rows, 'proponent')).filter(function(value, index, arr) {
		return Boolean(value) && arr.indexOf(value) === index;
	});
	const match = buildFuzzyEntityMatch_(rawName, nameList, {
		intentName: 'list_active_pos_for_proponent',
		entityType: 'vendor',
		countError: true,
	});
	if (!match.matched) {
		return match.didYouMean || 'No matching proponent/vendor found.';
	}

	const chosen = match.value;
	const matches = [];
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const vendor = String(row.values && row.values.vendor ? row.values.vendor : '').trim();
		const proponent = String(row.values && row.values.proponent ? row.values.proponent : '').trim();
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : '').trim();
		const deliveryCompleteValue = String(row.values && row.values.deliveryComplete ? row.values.deliveryComplete : '').trim().toUpperCase();
		const rawAmt = row.values && row.values.poAmountUsdK !== undefined ? row.values.poAmountUsdK : (row.values && row.values.poAmount !== undefined ? row.values.poAmount : '');
		if (!poNumber) continue;
		if (vendor !== chosen && proponent !== chosen) continue;
		if (deliveryCompleteValue === 'YES') continue;
		matches.push([poNumber, vendor || proponent, rawAmt || '']);
	}
	if (matches.length === 0) return 'No active POs found for ' + chosen + '.';
	const headers = ['PO Number','Vendor/Proponent','PO Amount'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, matches, { includeCsvDownload: true, csvFilename: 'sia-active-pos-' + timestamp + '.csv' });
}

function listServicesPosByDivisionAndType(entities, parsed, context) {
	const rawDivision = String(entities.DIVISION || '').trim();
	if (!rawDivision) return getMissingEntityMessage('DIVISION');
	const resolved = resolveCanonicalDivision_(rawDivision || '');
	if (!resolved.matched) {
		return buildDivisionDidYouMeanResponse_(rawDivision, 'list_services_pos_by_division_and_type', { countError: true });
	}

	const dataset = getCommschedRows_(['division','poType','poNumber','poAmount','poAmountUsdK'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';
	const matches = [];
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const rowDivision = String(row.values && row.values.division ? row.values.division : '').trim();
		if (!rowDivision) continue;
		const r = resolveCanonicalDivision_(rowDivision);
		if (!r.matched || r.canonicalDivision !== resolved.canonicalDivision) continue;
		const poType = String(row.values && row.values.poType ? row.values.poType : '').trim().toLowerCase();
		if (!poType || poType.indexOf('service') === -1) continue;
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : '').trim();
		const rawAmt = row.values && row.values.poAmountUsdK !== undefined ? row.values.poAmountUsdK : (row.values && row.values.poAmount !== undefined ? row.values.poAmount : '');
		matches.push([poNumber, row.values && row.values.poType ? row.values.poType : '', rawAmt || '']);
	}
	if (matches.length === 0) return 'No service POs found for ' + resolved.canonicalDivision + '.';
	const headers = ['PO Number','PO Type','PO Amount'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, matches, { includeCsvDownload: true, csvFilename: 'sia-services-pos-' + timestamp + '.csv' });
}

function listOpenPosForVendor(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || "").trim();
	if (!rawVendor) return getMissingEntityMessage("VENDOR");

	const dataset = getCommschedRows_( ["vendor", "currency", "poNumber", "deliveryComplete", "remainingBalance", "ungrdUsd"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const vendorList = collectUniqueColumnValues_(dataset.rows, "vendor");
	const match = buildFuzzyEntityMatch_(rawVendor, vendorList, {
		intentName: "list_open_pos_for_vendor",
		entityType: "vendor",
		countError: true,
	});
	if (!match.matched) {
		return match.didYouMean || "No matching vendors found.";
	}

	const chosen = match.value;
	const matches = [];
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		const currencyValue = String(row.values && row.values.currency ? row.values.currency : "").trim();
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const deliveryCompleteValue = String(row.values && row.values.deliveryComplete ? row.values.deliveryComplete : "").trim().toUpperCase();
		const remainingBalanceValue = String(row.values && row.values.remainingBalance ? row.values.remainingBalance : "").trim();
		if (!poNumber || vendorName !== chosen) continue;
		if (deliveryCompleteValue === "YES") continue;
		matches.push([
			poNumber,
			vendorName,
			(currencyValue ? currencyValue + " " : "") + (remainingBalanceValue || ""),
		]);
	}

	if (matches.length === 0) return "No matching open POs found.";

	const headers = ["PO Number", "Vendor", "Remaining Balance"];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, matches, { includeCsvDownload: true, csvFilename: "sia-open-pos-" + timestamp + ".csv" });
}

function listPoTaggedForClosure(entities, parsed, context) {
	return "POs with PO date 2023 and earlier (older than ~2.5 years) are tagged for closure.";
}

function listPoNotForClosure(entities, parsed, context) {
	return "POs from 2024 onwards are not considered for closure this year.";
}

function normalizeGrBucketCellValue_(value) {
	return String(value || "")
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/\s+/g, " ")
		.toUpperCase()
		.trim();
}

function getGrBucketInfo_(value) {
	const normalized = normalizeGrBucketCellValue_(value);
	const buckets = {
		"A. ZERO GR": { cellValue: "A. ZERO GR", code: "a", label: "A. ZERO GR", rank: 1 },
		"B. 1-10% GRD": { cellValue: "B. 1-10% GRD", code: "b", label: "1-10% GRD", rank: 2 },
		"C. 11-30% GRD": { cellValue: "C. 11-30% GRD", code: "c", label: "11-30% GRD", rank: 3 },
		"D. 31-50% GRD": { cellValue: "D. 31-50% GRD", code: "d", label: "31-50% GRD", rank: 4 },
		"E. 51-70% GRD": { cellValue: "E. 51-70% GRD", code: "e", label: "51-70% GRD", rank: 5 },
		"F. 71-90% GRD": { cellValue: "F. 71-90% GRD", code: "f", label: "71-90% GRD", rank: 6 },
		"G. 91-99% GRD": { cellValue: "G. 91-99% GRD", code: "g", label: "91-99% GRD", rank: 7 },
		"H. FULLY GRD": { cellValue: "H. FULLY GRD", code: "h", label: "FULLY GRD", rank: 8 },
	};

	return buckets[normalized] || null;
}

function resolveGrBucketCellsForFilter_(percentThreshold) {
	const threshold = Number(percentThreshold);
	if (isNaN(threshold)) {
		return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD", "D. 31-50% GRD"];
	}

	if (threshold <= 0) {
		return ["A. ZERO GR"];
	}
	if (threshold <= 10) {
		return ["A. ZERO GR", "B. 1-10% GRD"];
	}
	if (threshold <= 30) {
		return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD"];
	}
	if (threshold <= 50) {
		return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD", "D. 31-50% GRD"];
	}
	if (threshold <= 70) {
		return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD", "D. 31-50% GRD", "E. 51-70% GRD"];
	}
	if (threshold <= 90) {
		return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD", "D. 31-50% GRD", "E. 51-70% GRD", "F. 71-90% GRD"];
	}
	if (threshold < 100) {
		return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD", "D. 31-50% GRD", "E. 51-70% GRD", "F. 71-90% GRD", "G. 91-99% GRD"];
	}

	return ["A. ZERO GR", "B. 1-10% GRD", "C. 11-30% GRD", "D. 31-50% GRD", "E. 51-70% GRD", "F. 71-90% GRD", "G. 91-99% GRD", "H. FULLY GRD"];
}

function listPoLowGrPercent(entities, parsed, context) {
	const dataset = getCommschedRows_(["poNumber", "poDate", "vendor", "grBucket"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const yearFilter = entities.YEAR ? parseInt(String(entities.YEAR || "").trim(), 10) : null;
	const percentFilterRaw = entities.PERCENT ? String(entities.PERCENT || "").trim() : "";
	let percentThreshold = 30;
	if (percentFilterRaw) {
		const p = parseInt(percentFilterRaw, 10);
		if (!isNaN(p)) percentThreshold = p;
	}
	const allowedBuckets = resolveGrBucketCellsForFilter_(percentThreshold);
	const matches = [];

	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const poNumber = String(row.values && row.values.poNumber ? row.values.poNumber : "").trim();
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		const rawGrBucket = row.values && row.values.grBucket ? row.values.grBucket : "";
		const bucketInfo = getGrBucketInfo_(rawGrBucket);
		if (!poNumber || !vendorName || !bucketInfo) continue;
		if (allowedBuckets.indexOf(bucketInfo.cellValue) === -1) continue;

		let year = null;
		const rawPoDate = row.rawValues && Object.prototype.hasOwnProperty.call(row.rawValues, 'poDate') ? row.rawValues.poDate : (row.values && row.values.poDate ? row.values.poDate : "");
		const parsedDate = parseDateValue_(rawPoDate);
		if (parsedDate instanceof Date && !isNaN(parsedDate.getTime())) {
			year = parsedDate.getFullYear();
		} else {
			const display = String(row.values && row.values.poDate ? row.values.poDate : "");
			const m = display.match(/\b(19|20)\d{2}\b/);
			if (m) year = parseInt(m[0], 10);
		}
		if (yearFilter && year !== yearFilter) continue;

		matches.push({
			poNumber: poNumber,
			vendor: vendorName,
			grBucket: bucketInfo.cellValue,
			rank: bucketInfo.rank,
		});
	}

	if (matches.length === 0) return "No matching POs found.";

	matches.sort(function(a, b) {
		if (a.rank !== b.rank) {
			return a.rank - b.rank;
		}

		const vendorCompare = String(a.vendor || "").localeCompare(String(b.vendor || ""));
		if (vendorCompare !== 0) {
			return vendorCompare;
		}

		return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
	});

	const headers = ["PO Number", "Vendor", "GR Bucket"];
	const rows = matches.map(function(match) {
		return [match.poNumber, match.vendor, match.grBucket];
	});
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
	return buildTableResponse_(headers, rows, { includeCsvDownload: true, csvFilename: "sia-low-gr-percent-" + percentThreshold + "-" + (yearFilter || "all") + "-" + timestamp + ".csv" });
}

function extractDatesFromText_(text) {
	const raw = String(text || "").trim();
	if (!raw) return [];
	const candidates = [];
	const numericRe = /(\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b)/g;
	let m;
	while ((m = numericRe.exec(raw)) !== null) {
		candidates.push(m[1]);
	}

	const monthRe = /(\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\.)?\s+\d{1,2}(?:,\s*\d{4})?\b)/ig;
	while ((m = monthRe.exec(raw)) !== null) {
		candidates.push(m[1]);
	}

	const dates = [];
	for (let i = 0; i < candidates.length; i++) {
		let txt = candidates[i];
		if (/^\d{1,2}[\/\-]\d{1,2}$/.test(txt)) {
			const now = new Date();
			txt = txt + '/' + now.getFullYear();
		}
		const parsed = parseDateValue_(txt);
		if (parsed) dates.push(parsed);
	}
	return dates;
}

function listGrMovement(entities, parsed, context) {
	const rawText = parsed && parsed.rawText ? String(parsed.rawText) : '';
	const dates = extractDatesFromText_(rawText);
	let from = null;
	let to = null;
	const relativeDays = entities && entities.DAYS ? parseInt(String(entities.DAYS || ''), 10) : NaN;
	if (dates && dates.length >= 2) {
		const d1 = dates[0];
		const d2 = dates[1];
		from = d1 <= d2 ? d1 : d2;
		to = d2 >= d1 ? d2 : d1;
	} else if (!isNaN(relativeDays) && relativeDays > 0) {
		const now = new Date();
		from = new Date(now.getTime() - relativeDays * 24 * 60 * 60 * 1000);
		to = now;
	} else {
		return getMissingEntityMessage('DATE');
	}

	const dataset = getCommschedRows_(['poNumber','latestGrDate'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';
	const matches = [];
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const po = String(row.values && row.values.poNumber ? row.values.poNumber : '').trim();
		const grRaw = row.values && row.values.latestGrDate ? row.values.latestGrDate : '';
		const grDate = parseDateValue_(grRaw);
		if (!po || !grDate) continue;
		if (grDate >= from && grDate <= to) {
			const fmt = Utilities.formatDate(grDate, Session.getScriptTimeZone(), 'MMM d, yyyy');
			matches.push([po, fmt]);
		}
	}
	if (matches.length === 0) return 'No POs with GR movement found in the specified range.';
	const headers = ['PO Number','Latest GR Date'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, matches, { includeCsvDownload: true, csvFilename: 'sia-pos-gr-movement-' + timestamp + '.csv' });
}

function listPosWithGrMovementBetween(entities, parsed, context) {
	return listGrMovement(entities, parsed, context);
}

function listGrStagnant(entities, parsed, context) {
	const rawText = parsed && parsed.rawText ? String(parsed.rawText) : '';
	const dates = extractDatesFromText_(rawText);
	let days = 30;
	if (entities && entities.DAYS) {
		const n = parseInt(String(entities.DAYS || ''), 10);
		if (!isNaN(n) && n > 0) days = n;
	}
	const now = new Date();
	const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
	const hasDateRange = dates && dates.length >= 2;
	let from = null;
	let to = null;
	if (hasDateRange) {
		const d1 = dates[0];
		const d2 = dates[1];
		from = d1 <= d2 ? d1 : d2;
		to = d2 >= d1 ? d2 : d1;
	}

	const dataset = getCommschedRows_(['poNumber','latestGrDate'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';
	const matches = [];
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const po = String(row.values && row.values.poNumber ? row.values.poNumber : '').trim();
		const grRaw = row.values && row.values.latestGrDate ? row.values.latestGrDate : '';
		const grDate = parseDateValue_(grRaw);
		if (!po) continue;
		if (!grDate) {
			matches.push([po, 'No GR movement']);
			continue;
		}
		if ((hasDateRange && grDate < from) || (!hasDateRange && grDate < cutoff)) {
			const fmt = Utilities.formatDate(grDate, Session.getScriptTimeZone(), 'MMM d, yyyy');
			matches.push([po, fmt]);
		}
	}
	if (matches.length === 0) return hasDateRange ? 'No POs found with stagnant GR in the specified date range.' : 'No POs found with stagnant GR for more than ' + days + ' days.';
	const headers = ['PO Number','Latest GR Date'];
	return buildTableResponse_(headers, matches, { includeCsvDownload: false });
}

function listPosStagnantGr(entities, parsed, context) {
	return listGrStagnant(entities, parsed, context);
}
