/* intent.js

- defines what the users may ask
- maps the user input to the correct handler function

entities:
- PO_NUMBER: string of 10 digit numbers with no characters or spaces "1234567890"

*/

const INTENTS = [
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
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoRemainingBalance"
	},
	{
		name: "check_po_latest_gr_date",
		phrases: [
			"PO X latest GR date",
			"latest GR date of PO X",
			"when was the last GR posted for PO X",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoLatestGrDate"
	},

	/****************** PO AGING ******************/
	{
		name: "check_po_aging",
		phrases: [
			"PO X aging",
			"how old is PO X",
			"what is the age of PO X",
			"what is the aging of PO X"
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoAging"
	},
	{
		name: "check_po_aging_exceeded",
		phrases: [
			"has PO X exceeded standard SLA",
			"is PO X aging exceeded",
			"is PO X expired",
		],
		requiredEntities: ["PO_NUMBER"],
		handler: "checkPoAgingExceeded"
	},
	{
		name: "check_po_aging_exceeded_list",
		phrases: [
			"which POs have exceeded standard SLA",
			"list all POs that have exceeded standard SLA",
			"which POs are aging beyond 12 months?",
		],
		requiredEntities: [],
		handler: "checkPoAgingExceededList"
	}
];