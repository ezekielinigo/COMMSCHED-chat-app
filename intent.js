/* intent.js

- defines what the users may ask
- maps the user input to the correct handler function

entities:
- PO_NUMBER: string of 10 digit numbers with no characters or spaces "1234567890"

*/

const INTENTS = [
	{
		name: "check_po_status", // g rephrase mo na
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
		name: "check_po_gr_status", // g rephrase mo na
		phrases: [
			"PO X GR status",
			"GR status of PO X",
			"PO X GR bucketing",
			"GR bucketing of PO X",
			"what is the GR bucket of PO X",
			"is PO X fully GR'd",
			"is PO X already fully GRed",
			"check if PO X is fully GRed",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoGrStatus"
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

	/****************** PO AGING ******************/
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
		],
		requiredEntities: ["AGE_FILTER"],
		responseType: "list",
		handler: "listPoAging"
	},

];