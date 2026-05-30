/**
 * handlers_agg.js — Vendor/division aggregation and summary handlers.
 *
 * - `checkTotalPoAmountVendor`   → total PO amount per vendor (USD K preferred)
 * - `checkDownpaymentVendorOrPo`  → downpayment for a vendor or specific PO
 * - `checkTotalUnGrdVendor`       → total unGR'd value + PO counts per vendor
 * - `listTotalUnGrdVendor`        → table of all vendors ranked by unGR'd total
 * - `checkTotalUnGrdDivision`     → total unGR'd value + PO counts for a division
 * - `listTotalUnGrdDivision`      → table of all divisions ranked by unGR'd total
 *
 * The vendor handlers use `buildMatchedCurrencySummary_()` from format.js to
 * avoid repeating the fuzzy-match + currency-aggregation loop.
 * Division handlers use `buildDivisionDidYouMeanResponse_()` from fuzzy.js
 * for low-confidence matches, which increments EMAILS column F on suggestions.
 *
 * Dependencies: sheets.js (getCommschedRows_, lookupCommschedPoRow_),
 *               format.js (buildMatchedCurrencySummary_, parseDisplayAmount_,
 *               formatMoney_, formatCount_),
 *               fuzzy.js (buildDivisionDidYouMeanResponse_),
 *               messages.js (getMissingEntityMessage, buildTableResponse_,
 *               getCommschedNotFoundMessage_, getGrTicketNoDataMessage_,
 *               getCommschedDivisionDeniedMessage_),
 *               division.js (resolveCanonicalDivision_).
 * Routed from: routing.js (getGeminiResponse → handlers dispatch table).
 */

function checkTotalPoAmountVendor(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || '').trim();
	if (!rawVendor) return getMissingEntityMessage('VENDOR');

	const dataset = getCommschedRows_(['vendor','currency','poAmount','poAmountUsdK'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const summary = buildMatchedCurrencySummary_(dataset.rows, rawVendor, {
		entityField: 'vendor',
		amountFieldCandidates: ['poAmountUsdK', 'poAmount'],
		intentName: 'check_total_po_amount_vendor',
		entityType: 'vendor',
		noMatchMessage: 'No matching vendors found.',
	});
	if (!summary.matched) {
		return summary.response;
	}
	if (!summary.entries.length) return 'No matching POs found.';

	const formattedTotals = summary.entries.map(function(entry) {
		return (entry.currency ? entry.currency + ' ' : '') + formatMoney_(entry.total);
	}).join(', ');
	return 'Vendor <b>' + summary.chosen + '</b> has a total PO amount of ' + formattedTotals + '.';
}

function checkDownpaymentVendorOrPo(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || '').trim();
	const poNumber = String(entities.PO_NUMBER || '').trim();

	if (poNumber) {
		const lookup = lookupCommschedPoRow_(poNumber, ['downpaymentDp','currency'], context);
		if (lookup && lookup.accessDenied) return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
		if (!lookup || !lookup.found) return getCommschedNotFoundMessage_(poNumber);
		const rawDp = lookup.values ? (lookup.values.downpaymentDp || '') : '';
		if (!rawDp) return getGrTicketNoDataMessage_(poNumber);
		const num = parseDisplayAmount_(rawDp);
		const currency = String(lookup.values && lookup.values.currency ? lookup.values.currency : '').trim() || 'USD';
		if (isNaN(num)) return 'No downpayment data available for PO ' + poNumber + '.';
		return 'Downpayment release for <b>PO ' + poNumber + '</b>: ' + (currency ? currency + ' ' : '') + formatMoney_(num) + ' (Downpayment (DP) in USD as of May 23 [BQ]).';
	}

	if (!rawVendor) return getMissingEntityMessage('VENDOR');

	const dataset = getCommschedRows_(['vendor','currency','downpaymentDp'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const summary = buildMatchedCurrencySummary_(dataset.rows, rawVendor, {
		entityField: 'vendor',
		amountFieldCandidates: ['downpaymentDp'],
		intentName: 'check_downpayment_vendor_or_po',
		entityType: 'vendor',
		noMatchMessage: 'No matching vendors found.',
	});
	if (!summary.matched) {
		return summary.response;
	}
	if (!summary.entries.length) return 'No downpayment records found for vendor.';

	const formattedTotals = summary.entries.map(function(entry) {
		return (entry.currency ? entry.currency + ' ' : '') + formatMoney_(entry.total);
	}).join(', ');
	return 'Downpayment release for <b>' + summary.chosen + '</b>: ' + formattedTotals + ' (Downpayment (DP) in USD as of May 23 [BQ]).';
}

function checkTotalUnGrdVendor(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || '').trim();
	if (!rawVendor) return getMissingEntityMessage('VENDOR');

	const dataset = getCommschedRows_(['vendor','currency','remainingBalance'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const summary = buildMatchedCurrencySummary_(dataset.rows, rawVendor, {
		entityField: 'vendor',
		amountFieldCandidates: ['remainingBalance'],
		intentName: 'check_total_ungrd_vendor',
		entityType: 'vendor',
		noMatchMessage: 'No matching vendors found.',
	});
	if (!summary.matched) {
		return summary.response;
	}

	if (!summary.entries.length) return 'No matching POs found.';

	const totalRows = summary.entries.reduce(function(sum, entry) {
		return sum + Number(entry.rows || 0);
	}, 0);
	const totalPos = summary.entries.reduce(function(sum, entry) {
		return sum + Number(entry.posCount || 0);
	}, 0);
	const formattedTotals = summary.entries.map(function(entry) {
		return (entry.currency ? entry.currency + ' ' : '') + formatMoney_(entry.total);
	}).join(', ');
	return 'Vendor <b>' + summary.chosen + '</b> has a total unGR\'d value of ' + formattedTotals + ' from ' + formatCount_(totalPos) + ' to be GR\'d POs (out of ' + formatCount_(totalRows) + ').';
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
		return buildDivisionDidYouMeanResponse_(rawDivision, 'check_total_ungrd_division', { countError: true });
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
