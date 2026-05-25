/* handler.js

- intent-facing data lookup functions
- only the functions directly called by intent routing live here
- ex: checkPoStatus, checkPoGrStatus, checkPoRemainingBalance, checkPoLatestGrDate, checkPoTotalValue, checkPoAging, listPoAging, listPoDormant

*/
function checkPoStatus(entities, parsed, context) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["deliveryComplete"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const delivValue = String(lookup.values.deliveryComplete || "").trim().toUpperCase();

	if (delivValue === "YES") {
		return "<b>PO " + poNumber + "</b> is closed.";
	}
	if (delivValue === "NO") {
		return "<b>PO " + poNumber + "</b> is still open.";
	}

	return getCommschedNoDataMessage_(poNumber);
}

function checkPoGrStatus(entities, parsed, context) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "goodsReceiptAmount", "grBucket"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const currencyValue = String(lookup.values.currency || "").trim();
	const grAmountValue = String(lookup.values.goodsReceiptAmount || "").trim();
	const grValue = String(lookup.values.grBucket || "").trim().replace(/\s+/g, " ").toUpperCase();

	const bucketReplies = {
		"A. ZERO GR": "<b>PO " + poNumber + "</b> is not yet GR'd.",
		"B. 1-10% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (1-10% GR'd).",
		"C. 11-30% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (11-30% GR'd).",
		"D. 31-50% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (31-50% GR'd).",
		"E. 51-70% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (51-70% GR'd).",
		"F. 71-90% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (71-90% GR'd).",
		"G. 91-99% GRD": "<b>PO " + poNumber + "</b> has a GR'd value of " + currencyValue + " " + grAmountValue + " (91-99% GR'd).",
		"H. FULLY GRD": "<b>PO " + poNumber + "</b> is fully GR'd.",
	};

	return bucketReplies[grValue] || getCommschedNoDataMessage_(poNumber);
}

function checkPoRemainingBalance(entities, parsed, context) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "remainingBalance"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const currencyValue = String(lookup.values.currency || "").trim();
	const remainingBalanceValue = String(lookup.values.remainingBalance || "").trim();

	if (!currencyValue || !remainingBalanceValue) {
		return getCommschedNoDataMessage_(poNumber);
	}

	return "<b>PO " + poNumber + "</b> has a remaining balance of " + currencyValue + " " + remainingBalanceValue + ".";
}

function checkPoTotalValue(entities, parsed, context) { // done
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["currency", "poAmount", "goodsReceiptAmount"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const currencyValue = String(lookup.values.currency || "").trim();
	const poAmountValue = String(lookup.values.poAmount || "").trim();
	const grAmountValue = String(lookup.values.goodsReceiptAmount || "").trim();

	if (!currencyValue || !poAmountValue || !grAmountValue) {
		return getCommschedNoDataMessage_(poNumber);
	}

	return "<b>PO " + poNumber + "</b> has a total value of " + currencyValue + " " + poAmountValue + " and GR value of " + currencyValue + " " + grAmountValue + ".";
}

function checkPoLatestGrDate(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return "Cannot find PO X. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["latestGrDate"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const latestGrDateRaw = lookup.values ? lookup.values.latestGrDate : "";
	const latestGrDateValue = String(latestGrDateRaw || "").trim();
	if (!latestGrDateValue) {
		return "<b>PO " + poNumber + "</b> is not yet GR'd.";
	}

	const parsedDate = parseDateValue_(latestGrDateRaw);
	const formattedDate = parsedDate
		? Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "MMM d, yyyy")
		: latestGrDateValue;

	return "The last GR for <b>PO " + poNumber + "</b> was posted on " + formattedDate + ".";
}

function checkPoAging(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || "").trim();
	if (!poNumber) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const lookup = lookupCommschedPoRow_(poNumber, ["poSla"], context);
	if (lookup && lookup.accessDenied) {
		return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	}
	if (!lookup || !lookup.found) {
		return getCommschedNotFoundMessage_(poNumber);
	}

	const poSlaValue = lookup.values ? lookup.values.poSla : "";
	if (!poSlaValue) {
		return getCommschedNoDataMessage_(poNumber);
	}

	const bucketInfo = getPoSlaBucketInfo_(poSlaValue);
	if (!bucketInfo) {
		return getCommschedNoDataMessage_(poNumber);
	}

	const intentName = parsed && parsed.intent ? String(parsed.intent).trim() : "check_po_aging";
	return buildPoAgingReply_(poNumber, bucketInfo, intentName);
}

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

	// Collect unique vendor names
	const vendorSet = {};
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		if (vendorName) vendorSet[vendorName] = true;
	}

	const vendorList = Object.keys(vendorSet);
	const queryNorm = normalizeText(rawVendor || "");

	// score vendor candidates using shared helper
	const scoredItems = buildTopTextMatches_(queryNorm, vendorList, 3);
	const scored = scoredItems.map(function(it) { return { vendor: it.value, score: it.score }; });

	const top = scored.slice(0, 3);
	if (top.length === 0) return "No matching vendors found.";

	// If best candidate is a high-confidence match, list its POs directly
	if (top[0].score >= 0.9) {
		const chosen = top[0].vendor;
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

	// Otherwise present top candidates using full-query suggestion labels
	const suggestions = top.map(function(t) { return { id: t.vendor, label: buildFullQueryLabel('list_po_vendor', t.vendor) }; });
	return showDidYouMean(suggestions);
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

function listVendorRemainingBalance(entities, parsed, context) {
	const dataset = getCommschedRows_( ["vendor", "ungrdUsd"], context);
	if (!dataset || !dataset.rows) {
		return "Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.";
	}

	const vendorTotals = {};
	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : "").trim();
		const balanceRaw = String(row.values && row.values.ungrdUsd ? row.values.ungrdUsd : "").trim();
		if (!vendorName || !balanceRaw) {
			continue;
		}

		const numeric = parseDisplayAmount_(balanceRaw);
		if (isNaN(numeric)) {
			continue;
		}

		vendorTotals[vendorName] = (vendorTotals[vendorName] || 0) + numeric;
	}

	const totals = Object.keys(vendorTotals).map(function(vendor) {
		return { vendor: vendor, balance: vendorTotals[vendor] };
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

/* Helpers for unGR'd aggregation provided by helper.js (parseDisplayAmount_, formatMoney_, formatCount_) */

function checkTotalUnGrdVendor(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || '').trim();
	if (!rawVendor) return getMissingEntityMessage('VENDOR');

	const dataset = getCommschedRows_(['vendor','currency','remainingBalance'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	// Collect unique vendor names
	const vendorSet = {};
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : '').trim();
		if (vendorName) vendorSet[vendorName] = true;
	}
	const vendorList = Object.keys(vendorSet);
	const queryNorm = normalizeText(rawVendor || '');

	// score vendor candidates using shared helper
	const scoredItems = buildTopTextMatches_(queryNorm, vendorList, 3);
	const scored = scoredItems.map(function(it){ return { vendor: it.value, score: it.score }; });
	if (scored.length === 0) return 'No matching vendors found.';

	const top = scored.slice(0,3);
	if (top[0].score < 0.9) {
		const suggestions = top.map(function(t){ return { id: t.vendor, label: buildFullQueryLabel('check_total_ungrd_vendor', t.vendor), entityType: 'vendor' }; });
		return showDidYouMean(suggestions);
	}

	const chosen = top[0].vendor;
	const totalsByCurrency = {};
	let totalPos = 0;
	let totalRows = 0;

	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const vendorName = String(row.values && row.values.vendor ? row.values.vendor : '').trim();
		if (!vendorName || vendorName !== chosen) continue;
		const currency = String(row.values && row.values.currency ? row.values.currency : '').trim() || '';
		const rawAmt = row.values && row.values.remainingBalance !== undefined ? row.values.remainingBalance : '';
		const num = parseDisplayAmount_(rawAmt);
		if (isNaN(num)) continue;
		totalsByCurrency[currency] = totalsByCurrency[currency] || { total: 0, posCount: 0, rows: 0 };
		totalsByCurrency[currency].total += num;
		totalsByCurrency[currency].rows += 1;
		if (num > 0) totalsByCurrency[currency].posCount += 1;
		totalRows += 1;
		if (num > 0) totalPos += 1;
	}

	if (totalRows === 0) return 'No matching POs found.';

	const currencyParts = Object.keys(totalsByCurrency).map(function(curr){
		const info = totalsByCurrency[curr];
		return (curr ? curr + ' ' : '') + formatMoney_(info.total);
	});

	const formattedTotals = currencyParts.join(', ');
	return 'Vendor <b>' + chosen + '</b> has a total unGR\'d value of ' + formattedTotals + ' from ' + formatCount_(totalPos) + ' to be GR\'d POs (out of ' + formatCount_(totalRows) + ').';
}

function listTotalUnGrdVendor(entities, parsed, context) {
	const dataset = getCommschedRows_(['vendor','currency','remainingBalance'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const vendorCurrencyMap = {};
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const vendor = String(row.values && row.values.vendor ? row.values.vendor : '').trim();
		if (!vendor) continue;
		const currency = String(row.values && row.values.currency ? row.values.currency : '').trim() || '';
		const rawAmt = row.values && row.values.remainingBalance !== undefined ? row.values.remainingBalance : '';
		const num = parseDisplayAmount_(rawAmt);
		if (isNaN(num)) continue;
		const key = vendor + '||' + currency;
		vendorCurrencyMap[key] = vendorCurrencyMap[key] || { vendor: vendor, currency: currency, total: 0, posCount: 0, rows: 0 };
		vendorCurrencyMap[key].total += num;
		vendorCurrencyMap[key].rows += 1;
		if (num > 0) vendorCurrencyMap[key].posCount += 1;
	}

	const entries = Object.keys(vendorCurrencyMap).map(function(k){
		return vendorCurrencyMap[k];
	});

	if (entries.length === 0) return 'No matching vendors found.';

	// sort by total desc (numeric)
	entries.sort(function(a,b){ return b.total - a.total; });

	const rows = entries.map(function(v) {
		const formattedTotal = (v.currency ? v.currency + ' ' : '') + formatMoney_(v.total);
		return [v.vendor, formattedTotal, formatCount_(v.posCount), formatCount_(v.rows)];
	});

	const headers = ['Vendor','Total unGR\'d','Remaining POs','Total POs'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, rows, { includeCsvDownload: true, csvFilename: 'sia-ungrd-vendor-' + timestamp + '.csv' });
}

function checkTotalUnGrdDivision(entities, parsed, context) {
	const rawDivision = String(entities.DIVISION || '').trim();
	if (!rawDivision) return getMissingEntityMessage('DIVISION');

	const resolved = resolveCanonicalDivision_(rawDivision || '');
	if (!resolved.matched) {
		// suggest top canonical divisions by similarity
		const candidates = CANONICAL_DIVISIONS_.map(function(d){ return { id: d, score: scoreDivisionSimilarity_(rawDivision, d) }; });
		candidates.sort(function(a,b){ return b.score - a.score; });
		const top = candidates.slice(0,3).map(function(c){ return { id: c.id, label: buildFullQueryLabel('check_total_ungrd_division', c.id), entityType: 'division' }; });
		return showDidYouMean(top);
	}

	const dataset = getCommschedRows_(['division','currency','remainingBalance'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const totalsByCurrency = {};
	let totalPos = 0;
	let totalRows = 0;

	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const rowDivision = String(row.values && row.values.division ? row.values.division : '').trim();
		if (!rowDivision) continue;
		const resolvedRow = resolveCanonicalDivision_(rowDivision);
		if (!resolvedRow.matched || resolvedRow.canonicalDivision !== resolved.canonicalDivision) continue;
		const currency = String(row.values && row.values.currency ? row.values.currency : '').trim() || '';
		const rawAmt = row.values && row.values.remainingBalance !== undefined ? row.values.remainingBalance : '';
		const num = parseDisplayAmount_(rawAmt);
		if (isNaN(num)) continue;
		totalsByCurrency[currency] = totalsByCurrency[currency] || { total: 0, posCount: 0, rows: 0 };
		totalsByCurrency[currency].total += num;
		totalsByCurrency[currency].rows += 1;
		if (num > 0) totalsByCurrency[currency].posCount += 1;
		totalRows += 1;
		if (num > 0) totalPos += 1;
	}

	if (totalRows === 0) return 'No matching POs found.';

	const currencyParts = Object.keys(totalsByCurrency).map(function(curr){
		const info = totalsByCurrency[curr];
		return (curr ? curr + ' ' : '') + formatMoney_(info.total);
	});
	const formattedTotals = currencyParts.join(', ');
	return 'Division <b>' + resolved.canonicalDivision + '</b> has a total unGR\'d value of ' + formattedTotals + ' from ' + formatCount_(totalPos) + ' to be GR\'d POs (out of ' + formatCount_(totalRows) + ').';
}

function listTotalUnGrdDivision(entities, parsed, context) {
	const dataset = getCommschedRows_(['division','currency','remainingBalance'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const groupMap = {};
	for (let i=0;i<dataset.rows.length;i++){
		const row = dataset.rows[i] || {};
		const divisionRaw = String(row.values && row.values.division ? row.values.division : '').trim();
		if (!divisionRaw) continue;
		const resolved = resolveCanonicalDivision_(divisionRaw);
		if (!resolved.matched) continue;
		const division = resolved.canonicalDivision;
		const currency = String(row.values && row.values.currency ? row.values.currency : '').trim() || '';
		const rawAmt = row.values && row.values.remainingBalance !== undefined ? row.values.remainingBalance : '';
		const num = parseDisplayAmount_(rawAmt);
		if (isNaN(num)) continue;
		const key = division + '||' + currency;
		groupMap[key] = groupMap[key] || { division: division, currency: currency, total: 0, posCount: 0, rows: 0 };
		groupMap[key].total += num;
		groupMap[key].rows += 1;
		if (num > 0) groupMap[key].posCount += 1;
	}

	const entries = Object.keys(groupMap).map(function(k){ return groupMap[k]; });

	if (entries.length === 0) return 'No matching divisions found.';

	entries.sort(function(a,b){ return b.total - a.total; });

	const rows = entries.map(function(v) {
		const formattedTotal = (v.currency ? v.currency + ' ' : '') + formatMoney_(v.total);
		return [v.division, formattedTotal, formatCount_(v.posCount), formatCount_(v.rows)];
	});

	const headers = ['Division','Total unGR\'d','Remaining POs','Total POs'];
	const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
	return buildTableResponse_(headers, rows, { includeCsvDownload: true, csvFilename: 'sia-ungrd-division-' + timestamp + '.csv' });
}
