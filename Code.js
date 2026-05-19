function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle('COMMSCHED Chat App');
}

function getMissingEntityMessage(entityKey) {
  const prompts = {
    PO_NUMBER: "Please provide a 10-digit PO number",
    DATE: "Please provide a date (MM/DD/YYYY)",
    YEAR: "Please provide a year",
  };

  return prompts[entityKey] || "Please provide more information";
}

function getGeminiResponse(userText, messages) {
  const CONFIDENCE_THRESHOLD = 0.5;
  const fallback = "Sorry, I’m not sure I understood that.";

  const parsed = parseInput(userText);
  if (parsed && parsed.error) {
    return parsed.error;
  }
  if (!parsed || !parsed.intent) {
    return fallback;
  }
  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    return showDidYouMean(parsed.suggestions);
  }

  const intent = INTENTS.find((i) => i.name === parsed.intent);
  if (!intent) return fallback;

  const required = intent.requiredEntities || [];
  const entities = parsed.entities || {};
  const missingRequired = required.find((key) => !entities[key]);
  if (missingRequired) {
    return getMissingEntityMessage(missingRequired);
  }

  const handlers = {
    checkPoStatus: checkPoStatus,
    checkPoGrStatus: checkPoGrStatus,
    checkPoRemainingBalance: checkPoRemainingBalance,
    checkPoLatestGrDate: checkPoLatestGrDate,
    checkPoAging: checkPoAging,
    checkPoAgingExceeded: checkPoAgingExceeded,
    checkPoAgingExceededList: checkPoAgingExceededList,
  };

  const handler = handlers[intent.handler];
  if (typeof handler !== "function") {
    return fallback;
  }

  return handler(entities);
}