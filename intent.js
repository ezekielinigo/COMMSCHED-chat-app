/* intent.js

- defines what the users may ask
- maps the user input to the correct handler function

entities:
- PO_NUMBER: string of 10 digit numbers with no characters or spaces "1234567890"
- GR_NUMBER: short GR case number (typically 1-7 digits) when the text clearly refers to a GR ticket/case

*/


const INTENTS = [

	/********** COMMSCHED SHEET */
	// queries that are answered by the COMMSCHED SHEET
	{
		name: "check_po_status",
		phrases: [
			"PO X status",
			"status of PO X",
			"check PO X status",
			"check the status of PO X",
			"what is the status of PO X",
			"can you tell me the status of PO X",
			"what's the current status of PO X",
			"I want to know the status of PO X",
			"give me the status of PO X",
			"what's the update on PO X",
			"can you provide the status of PO X",
			"check if PO X is already closed",
			"is PO X already closed",
			"check if PO X is still open",
			"is PO X still open",
			"is the status of PO X open or closed",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoStatus"
	},
	{
		name: "check_po_gr_status", 
		phrases: [
			"PO X GR status",
			"GR status of PO X",
			"PO X GR bucketing",
			"GR bucketing of PO X",
			"what is the GR bucket of PO X",
			"what is the GR percentage of PO X"
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoGrStatus"
	},
	{
		name: "check_po_gr_amount",
		intentKeywords: ["gr", "goods receipt", "gred", "how much", "how much has been", "received"],
		conflictKeywords: ["vendor", "vendors", "project", "projects", "division", "divisions"],
		phrases: [
			"how much has been GRed for PO X",
			"how much has been GR'd for PO X",
			"how much has been received for PO X",
			"what is the GR amount for PO X",
			"what is the goods receipt value for PO X",
			"PO X GR amount",
			"PO X goods receipt value"
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoGrAmount"
	},
	{
		name: "check_po_remaining_balance",
		phrases: [
			"PO X remaining balance",
			"remaining balance of PO X",
			"check PO X remaining balance",
			"how much remaining balance is left on PO X",
			"what is the remaining balance of PO X",
			"can you tell me the remaining balance of PO X",
			"are there any remaining balance on PO X",
			"are there any pending transactions for PO X",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoRemainingBalance"
	},
	{
		name: "check_po_latest_gr_date",
		phrases: [
			"PO X latest GR date",
			"latest GR date of PO X",
			"last GR date of PO X",
			"last GR for PO X",
			"when was the last GR posted for PO X",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoLatestGrDate"
	},
	{
		name: "check_po_total_value",
		phrases: [
			"PO X total value",
			"total value of PO X",
			"check PO X total value",
			"what is the total value of PO X",
			"can you tell me the total value of PO X",
			"what is the total po value vs actual gr value of PO X",
			"compare total po value and actual gr value of PO X",
			"PO X gr value total",
			"check PO X gr total value"
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoTotalValue"
	},
	{
		name: "check_po_aging",
		phrases: [
			"What is the aging of PO X",
			"What is the age of PO X",
			"How old is PO X",
			"Check the aging of PO X",
			"Aging of PO X",
			"PO X aging",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoAging"
	},
	{
		name: "check_po_year",
		intentKeywords: ["year", "released"],
		phrases: [
			"what is the PO year of PO X",
			"what year was PO X released",
			"PO year of PO X",
			"what year was PO X",
			"when was PO X released"
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoYear"
	},
	{
		name: "check_po_aging_exceeded",
		phrases: [
			"Has PO X exceeded the standard SLA",
			"Has PO X exceeded SLA",
			"Did PO X exceed the standard SLA",
			"Is PO X beyond the standard SLA",
			"Check if PO X exceeded the standard SLA",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoAging"
	},
	{
		name: "check_po_high_risk",
		phrases: [
			"Is PO X high risk",
			"Is PO X a high risk PO",
			"Is PO X legacy",
			"Is PO X a legacy PO",
			"Check if PO X is high risk",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoAging"
	},
	{
		name: "list_po_aging",
		intentKeywords: ["po", "purchase order"],
		conflictKeywords: ["project", "projects"],
		phrases: [
			"Which POs are aging X",
			"Which POs are aging beyond 24 months",
			"List all X POs",
			"List all POs X old",
			"List of all POs X old",
			"List all POs <6 months old",
			"List all POs 6-9 months old",
			"List all POs 9-12 months old",
			"List all POs 12-24 months old",
			"List all POs >24 months old",
			"List all high risk POs",
			"List all legacy POs",
			"Which POs are older than X",
			"Show me all POs older than X",
			"Which POs are beyond X",
			"List of all POs at least 1 year old",
			"which POs are beyond SLA?",
			"list POs exceeding standard SLA",
		],
		requiredEntities: ["AGE_FILTER"],
		responseType: "list",
		handler: "listPoAging"
	},
	{
		name: "list_project_delayed_closure",
		intentKeywords: ["project", "projects"],
		conflictKeywords: ["po", "purchase order"],
		phrases: [
			"Which projects have delayed PO closure",
			"List all high risk projects",
			"Show me all projects aged >2 years",
			"List all delayed closure projects",
			"Which projects have delayed closure",
			"Show delayed PO closure projects",
			"List projects with POs older than 24 months",
			"Which projects have high risk POs",
			"Show me all high risk projects",
		],
		responseType: "list",
		handler: "listProjectDelayedClosure"
	},
	{
		name: "list_po_urgent_cleanup",
		intentKeywords: ["po", "purchase order"],
		conflictKeywords: ["project", "projects", "vendor", "vendors"],
		phrases: [
			"Which POs require urgent cleanup?",
			"List all POs requiring urgent cleanup",
			"Show me urgent cleanup POs",
			"Which POs need urgent cleanup",
			"List urgent cleanup POs",
			"Show POs for urgent cleanup",
		],
		responseType: "list",
		handler: "listPoUrgentCleanup"
	},
	{
		name: "list_po_vendor",
		phrases: [
			"List all POs from X",
			"Show me all POs from X",
			"List POs from X",
			"give me all POs from X",
			"which POs are from X",
			"all POs under X vendor"
		],
		requiredEntities: ["VENDOR"],
		responseType: "list",
		handler: "listPoVendor"
	},
	{
		name: "check_total_ungrd_vendor",
		phrases: [
			"What is the total unGR'd exposure for X",
			"What is the total unGR'd exposure for X?",
			"What is the total unGR'd exposure for {vendor}",
			"total ungrd exposure for X",
			"total unGR'd for X",
		],
		requiredEntities: ["VENDOR"],
		handler: "checkTotalUnGrdVendor"
	},
	{
		name: "list_total_ungrd_vendor",
		intentKeywords: ["vendor", "vendors"],
		conflictKeywords: ["po", "purchase order"],
		phrases: [
			"What is the total unGR'd exposure per vendor",
			"total unGR'd exposure per vendor",
			"show total unGR'd per vendor",
			"list total unGR'd per vendor"
		],
		responseType: "list",
		handler: "listTotalUnGrdVendor"
	},
	{
		name: "check_total_ungrd_division",
		phrases: [
			"What is the total unGR'd exposure for X",
			"What is the total unGR'd exposure for the X division",
			"total ungrd exposure for X division",
			"total unGR'd for X division",
		],
		requiredEntities: ["DIVISION"],
		handler: "checkTotalUnGrdDivision"
	},
	{
		name: "list_total_ungrd_division",
		intentKeywords: ["division", "divisions"],
		conflictKeywords: ["project", "projects", "po", "purchase order"],
		phrases: [
			"What is the total unGR'd exposure per division",
			"total unGR'd exposure per division",
			"show total unGR'd per division",
			"list total unGR'd per division",
			"which divisions have the highest unGR'd amount"
		],
		responseType: "list",
		handler: "listTotalUnGrdDivision"
	},
	{
		name: "list_po_dormant",
		phrases: [
			"Which POs are dormant",
			"Are there POs that have no activity",
			"List all dormant POs",
			"Show me dormant POs",
			"List POs with no activity",
			"Which POs have no GR activity",
			"Show POs with no activity",
		],
		responseType: "list",
		handler: "listPoDormant"
	},
	{
		name: "list_gr_movement",
		intentKeywords: ["gr movement", "gr movements", "latest gr date", "movement", "movements"],
		conflictKeywords: ["ticket", "case", "status", "submitted", "submission", "posting", "validation"],
		phrases: [
			"show all POs with GR movement between X and Y",
			"list POs with GR movement from X to Y",
			"show me all GR movements within the past week",
			"show me GR movements within the past week",
			"show me GR movements within the past month",
			"show me POs with GR movement within the past week",
			"show me POs with GR movement within the past month",
			"show me GR movements from the last X days",
			"show me POs with latest GR date between X and Y",
		],
		responseType: "list",
		handler: "listGrMovement"
	},
	{
		name: "list_gr_stagnant",
		intentKeywords: ["stagnant", "stale", "no movement", "no gr movement", "inactive", "idle"],
		conflictKeywords: ["ticket", "case", "status", "submitted", "submission", "posting", "validation"],
		phrases: [
			"list POs with stagnant GR for more than X days",
			"which POs are stagnant between X and Y",
			"which POs are stagnant for more than X days",
			"show POs with no GR movement for X days",
			"show me POs with no GR movement within the past week",
			"show me POs with no GR movement within the past month",
			"show me POs with no GR movement in the past week",
			"show me POs with no GR movement in the past month",
		],
		responseType: "list",
		handler: "listGrStagnant"
	},
	{
		name: "list_po_vendor_remaining_balance",
		intentKeywords: ["po", "purchase order"],
		conflictKeywords: ["vendor", "vendors"],
		phrases: [
			"List all POs with highest remaining balance",
			"Which PO have the highest unGR'd balance",
			"show me the POs with highest unGRd balance",
			"List top POs with highest unGR'd balance",
			"Which POs have the highest remaining balance",
		],
		responseType: "list",
		handler: "listPoVendorRemainingBalance"
	},
	{
		name: "list_vendor_remaining_balance",
		intentKeywords: ["vendor", "vendors"],
		conflictKeywords: ["po", "purchase order"],
		phrases: [
			"show me top vendors by remaining balance",
			"list top vendors by remaining balance",
			"which vendors have the highest remaining balance",
			"top vendors by remaining balance",
			"list all vendors with the highest balances"
		],
		responseType: "list",
		handler: "listVendorRemainingBalance"
	},
	
	/********** NEW: Additional PO queries requested by user */
	{
		name: "check_po_fully_grd",
		intentKeywords: ["gr", "goods receipt", "fully", "grd", "pending", "balance", "ungrd", "ungr'd", "still", "how much"],
		conflictKeywords: ["age", "aging", "old", "closure"],
		phrases: [
			"is PO X fully grd",
			"is PO X fully GR'd",
			"is PO X fully gred",
			"is PO X already fully gred",
			"is PO X fully grd?",
			"is PO X fully gr'd",
			"How much is still pending GR for PO X?",
			"What is the unGR'd balance for PO X?",
			"how much unGR'd is left for PO X?",
			"How much is still pending GR for PO 4540512443?",
			"What is the unGR'd balance for PO 4540512443?",
			"how much unGR'd is left for PO 4540512443?"
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoFullyGrd"
	},
	{
		name: "list_open_pos_for_vendor",
		intentKeywords: ["po", "purchase order", "open"],
		conflictKeywords: ["age", "aging", "project"],
		phrases: [
			"show all open POs for X",
			"show open POs for X",
			"list open POs for X",
			"all open POs from X",
			"open POs for X"
		],
		requiredEntities: ["VENDOR"],
		responseType: "list",
		handler: "listOpenPosForVendor"
	},
	{
		name: "list_po_tagged_for_closure",
		intentKeywords: ["closure", "tagged", "closure year"],
		conflictKeywords: ["age", "aging"],
		phrases: [
			"which POs are tagged for closure",
			"list POs tagged for closure",
			"which POs are tagged for closure 2023",
			"show POs tagged for closure"
		],
		// default behaviour: PO Date year <= 2023
		responseType: "list",
		handler: "listPoTaggedForClosure"
	},
	{
		name: "list_po_not_for_closure",
		intentKeywords: ["closure", "not for closure", "not for closure this year"],
		conflictKeywords: ["age", "aging"],
		phrases: [
			"which POs are not for closure this year",
			"which POs are not for closure",
			"list POs not for closure",
			"POs not for closure 2024"
		],
		// default behaviour: PO Date year >= 2024
		responseType: "list",
		handler: "listPoNotForClosure"
	},
	{
		name: "list_po_low_gr_percent",
		intentKeywords: ["gr", "gr%", "goods receipt", "gr percent", "below", "under", "percent", "percentage"],
		conflictKeywords: ["age", "aging", "ticket", "case", "submitted", "status", "stage"],
		phrases: [
			"show POs with low GR%",
			"show POs with low GR percent",
			"show POs with <=30% GRd",
			"show all 2024 POs with low GR%",
			"list POs with gr percent below 30",
			"which POs have GR% below X",
			"which POs have GR percent below X",
			"list POs with GR% below X",
			"show POs with GR% below X",
			"POs with GR% below X"
		],
		// optional YEAR entity can be provided
		responseType: "list",
		handler: "listPoLowGrPercent"
	},
	{
		name: "list_vendor_pending_gr_above_threshold",
		intentKeywords: ["vendor", "vendors", "pending", "gr", "above", "over", "greater", "balance", "ungrd", "million", "usd"],
		conflictKeywords: ["po", "purchase order", "age", "aging", "division", "project"],
		phrases: [
			"which vendors have pending GR above X",
			"which vendors have pending GR above X USD",
			"which vendors have pending GR above USD X",
			"which vendors have pending GR above $X",
			"which vendors have pending GR over X",
			"which vendors have pending GR greater than X",
			"vendors with pending GR above X",
			"vendors with pending GR over X",
			"vendors with pending GR greater than X",
			"list vendors with pending GR above X",
			"show vendors with pending GR above X"
		],
		requiredEntities: ["AMOUNT"],
		responseType: "list",
		handler: "listVendorPendingGrAboveThreshold"
	},

	/********** GR TICKET SHEET */
	// queries that are answered by the GR TICKET SHEET

	{
		name: "check_gr_ticket_status",
		phrases: [
			"GR ticket for GR X",
			"GR ticket status for GR X",
			"what is the current status of the GR ticket X",
			"what is the status of GR X",
			"status of GR X",
			"GR X status",
			"check GR X status",
			"what stage is GR X currently in",
			"status of GR case no X",
			"GR case X status",
			"is GR X already been posted in SAP",
			"is GR X still pending validation",
			"is GR X already completed",
			"is GR X still in process",
		],
		requiredEntities: ["GR_NUMBER"],
		handler: "checkGrTicketStatus"
	},
	{
		name: "check_gr_ticket_submitted",
		phrases: [
			"when was GR X submitted",
			"when was GR case no X submitted",
			"what is the submitted date of GR X",
			"date submitted for GR X",
			"submitted date of GR X",
			"GR X submitted",
			"when did GR X submit",
		],
		requiredEntities: ["GR_NUMBER"],
		handler: "checkGrTicketSubmitted"
	},
	{
		name: "check_total_po_amount_vendor",
		phrases: [
			"what is the total PO amount for X",
			"total PO amount for X",
			"total PO value for X",
			"what is the total PO amount for {vendor}",
		],
		requiredEntities: ["VENDOR"],
		handler: "checkTotalPoAmountVendor"
	},
	{
		name: "check_total_po_amount_division",
		phrases: [
			"what is the total PO amount for the X division",
			"total PO amount for X division",
			"total PO value for X division",
			"what is the total PO value by division X",
		],
		requiredEntities: ["DIVISION"],
		handler: "checkTotalPoAmountDivision"
	},
	{
		name: "check_downpayment_vendor",
		phrases: [
			"what is the total downpayment released for X",
			"how much downpayment for X",
			"downpayment for {vendor}",
		],
		requiredEntities: ["VENDOR"],
		handler: "checkDownpaymentVendor"
	},
	{
		name: "check_downpayment_po",
		phrases: [
			"downpayment for PO X",
			"downpayment for PO {PO_NUMBER}",
			"what is the downpayment for PO {PO_NUMBER}",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkDownpaymentPO"
	},
	{
		name: "list_po_value_by_division",
		phrases: [
			"what is the total PO value by division",
			"total PO value per division",
			"sum of PO values by division",
		],
		handler: "listPoValueByDivision"
	},
	{
		name: "list_pos_by_project",
		phrases: [
			"show all POs under X projects",
			"list POs for project X",
		],
		requiredEntities: ["PROJECT"],
		handler: "listPosByProject"
	},
	{
		name: "list_projects_by_division",
		phrases: [
			"which projects belong to X",
			"show projects under X division",
		],
		requiredEntities: ["DIVISION"],
		handler: "listProjectsByDivision"
	},
	{
		name: "list_active_pos_for_proponent",
		phrases: [
			"what are X's active POs",
			"show active POs for X",
		],
		requiredEntities: ["VENDOR"],
		handler: "listActivePosForProponent"
	},
	{
		name: "list_services_pos_by_division",
		phrases: [
			"show all services POs under X",
			"list service POs for X division",
		],
		requiredEntities: ["DIVISION"],
		handler: "listServicesPosByDivisionAndType"
	},

];