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

function checkTotalPoAmountDivision(entities, parsed, context) {
	const rawDivision = String(entities.DIVISION || '').trim();
	if (!rawDivision) return getMissingEntityMessage('DIVISION');

	const resolved = resolveCanonicalDivision_(rawDivision || '');
	if (!resolved.matched) {
		return buildDivisionDidYouMeanResponse_(rawDivision, 'check_total_po_amount_division', { countError: true });
	}

	const dataset = getCommschedRows_(['division','currency','poAmount','poAmountUsdK'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const totalsByCurrency = {};
	let totalRows = 0;

	for (let i = 0; i < dataset.rows.length; i += 1) {
		const row = dataset.rows[i] || {};
		const rowDivision = String(row.values && row.values.division ? row.values.division : '').trim();
		if (!rowDivision) continue;
		const resolvedRow = resolveCanonicalDivision_(rowDivision);
		if (!resolvedRow.matched || resolvedRow.canonicalDivision !== resolved.canonicalDivision) continue;

		const currency = String(row.values && row.values.currency ? row.values.currency : '').trim() || '';
		const rawAmt = row.values && row.values.poAmountUsdK !== undefined ? row.values.poAmountUsdK : (row.values && row.values.poAmount !== undefined ? row.values.poAmount : '');
		const num = parseDisplayAmount_(rawAmt);
		if (isNaN(num)) continue;

		totalsByCurrency[currency] = totalsByCurrency[currency] || { total: 0, rows: 0 };
		totalsByCurrency[currency].total += num;
		totalsByCurrency[currency].rows += 1;
		totalRows += 1;
	}

	if (totalRows === 0) return 'No matching POs found.';

	const currencyParts = Object.keys(totalsByCurrency).map(function(curr) {
		const info = totalsByCurrency[curr];
		return (curr ? curr + ' ' : '') + formatMoney_(info.total);
	});
	return 'Division <b>' + resolved.canonicalDivision + '</b> has a total PO amount of ' + currencyParts.join(', ') + '.';
}

function extractAsOfDateFromMeta_(meta, fieldKey) {
	try {
		if (!meta || !Array.isArray(meta.headers) || !meta.fieldColumns) return '';
		const idx = meta.fieldColumns[fieldKey];
		if (typeof idx !== 'number' || idx < 0) return '';
		const header = String(meta.headers[idx] || '').trim();
		const m = header.match(/as of\s*(.*)$/i);
		if (m && m[1]) return m[1].trim();
		if (meta.sourceDateMs) {
			return Utilities.formatDate(new Date(meta.sourceDateMs), Session.getScriptTimeZone(), 'MMM dd, yyyy');
		}
		return '';
	} catch (e) {
		return '';
	}
}

function checkDownpaymentPO(entities, parsed, context) {
	const poNumber = String(entities.PO_NUMBER || '').trim();
	if (!poNumber) return getMissingEntityMessage('PO_NUMBER');

	const lookup = lookupCommschedPoRow_(poNumber, ['downpayment','downpaymentDp','currency'], context);
	if (lookup && lookup.accessDenied) return lookup.message || getCommschedDivisionDeniedMessage_(poNumber);
	if (!lookup || !lookup.found) return getCommschedNotFoundMessage_(poNumber);

	const rawLocal = lookup.values ? (lookup.values.downpayment || '') : '';
	const rawUsd = lookup.values ? (lookup.values.downpaymentDp || '') : '';
	if (!rawLocal && !rawUsd) return getGrTicketNoDataMessage_(poNumber);

	const localNum = parseDisplayAmount_(rawLocal);
	const usdNum = parseDisplayAmount_(rawUsd);
	const currency = String(lookup.values && lookup.values.currency ? lookup.values.currency : '').trim() || '';

	if ((rawLocal && isNaN(localNum)) && (rawUsd && isNaN(usdNum))) return 'No downpayment data available for PO ' + poNumber + '.';

	const dateStr = extractAsOfDateFromMeta_(lookup.meta, (rawLocal ? 'downpayment' : 'downpaymentDp')) || extractAsOfDateFromMeta_(lookup.meta, 'downpaymentDp');

	let primary = '';
	if (!isNaN(localNum) && localNum !== 0) {
		primary = (currency ? currency + ' ' : '') + formatMoney_(localNum);
		if (!isNaN(usdNum) && usdNum !== 0 && String(currency || '').toUpperCase() !== 'USD') {
			primary += ' (USD ' + formatMoney_(usdNum) + ')';
		}
	} else if (!isNaN(usdNum)) {
		primary = 'USD ' + formatMoney_(usdNum);
	}

	const asOf = dateStr ? ' as of ' + dateStr : '';
	return 'Downpayment release for <b>PO ' + poNumber + '</b>: ' + primary + asOf;
}

function checkDownpaymentVendor(entities, parsed, context) {
	const rawVendor = String(entities.VENDOR || '').trim();
	if (!rawVendor) return getMissingEntityMessage('VENDOR');

	const dataset = getCommschedRows_(['vendor','currency','downpayment','downpaymentDp'], context);
	if (!dataset || !dataset.rows) return 'Cannot find the latest monitoring sheet. Please contact the admin team at ntg-bmsocapexsettlement@globe.com.ph for further assistance.';

	const summary = buildMatchedCurrencySummary_(dataset.rows, rawVendor, {
		entityField: 'vendor',
		amountFieldCandidates: ['downpayment','downpaymentDp'],
		currencyField: 'currency',
		intentName: 'check_downpayment_vendor',
		entityType: 'vendor',
		noMatchMessage: 'No matching vendors found.',
	});
	if (!summary.matched) {
		return summary.response;
	}
	if (!summary.entries.length) return 'No downpayment records found for vendor.';

	// Pair common local currency (e.g., PHP) with USD if both exist
	const entriesByCurrency = {};
	summary.entries.forEach(function(e){ entriesByCurrency[String(e.currency||'').toUpperCase()] = e; });

	let formatted = '';
	if (entriesByCurrency['PHP'] && entriesByCurrency['USD']) {
		formatted = 'PHP ' + formatMoney_(entriesByCurrency['PHP'].total) + ' (USD ' + formatMoney_(entriesByCurrency['USD'].total) + ')';
	} else {
		formatted = summary.entries.map(function(entry) { return (entry.currency ? entry.currency + ' ' : '') + formatMoney_(entry.total); }).join(', ');
	}

	// determine as-of date from dataset meta (prefer downpayment header)
	const dateStr = extractAsOfDateFromMeta_(dataset.meta, 'downpayment') || extractAsOfDateFromMeta_(dataset.meta, 'downpaymentDp') || (dataset.meta && dataset.meta.sourceDateMs ? Utilities.formatDate(new Date(dataset.meta.sourceDateMs), Session.getScriptTimeZone(), 'MMM dd, yyyy') : '');

	const asOf = dateStr ? ' as of ' + dateStr : '';
	return 'Downpayment release for <b>' + summary.chosen + '</b>: ' + formatted + asOf;
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
