function roleLabel(accountTypeId: string): string {
  switch (accountTypeId) {
    case "2":
      return "host";
    case "3":
      return "agent";
    case "1":
    default:
      return "guest";
  }
}

export type BookingAgentPromptOptions = {
  /**
   * When true, the assistant may answer general/world questions and
   * (if the `web_search` tool is registered) look up booking info on
   * the public web. When false (default) it stays strictly inside the
   * marketplace and politely declines anything else.
   */
  allowOutOfScope?: boolean;
  /** Custom decline text used by strict mode. */
  outOfScopeFallbackText?: string;
};

const DEFAULT_FALLBACK =
  "I can only help with bookings, listings, and reservations on this platform. For anything outside that, please request a chat with a human agent.";

export function buildBookingAgentSystemPrompt(
  accountTypeId: string,
  context?: Record<string, unknown>,
  options: BookingAgentPromptOptions = {},
): string {
  const role = roleLabel(accountTypeId);
  const ctx =
    context && Object.keys(context).length > 0
      ? `\nPage context (hints only; verify with tools): ${JSON.stringify(context)}`
      : "";
  const allowOutOfScope = options.allowOutOfScope === true;
  const fallback = options.outOfScopeFallbackText ?? DEFAULT_FALLBACK;

  const baseRules = [
    "- Use tools for anything that depends on live data (availability, reservations, listing facts). Never invent prices, dates, or booking statuses.",
    "- Do not create or confirm payments/bookings yourself. Guide the user to complete booking in the app when they want to pay.",
    "- After tool results, summarize clearly: dates, status, property title if present, and next steps.",
    "- If the API returns an error or an unexpected resp_code, explain briefly and suggest checking Trips/Reservations pages or contacting support.",
  ];

  const scopeRules = allowOutOfScope
    ? [
        "- You MAY answer general booking, travel, or hotel questions even when the marketplace tools cannot.",
        "- If the marketplace tools have no answer, you may call `web_search` to look up booking-related information online and cite results.",
        "- Stay on-topic: focus on bookings, stays, hotels, and travel. Decline unrelated topics.",
      ]
    : [
        "- STRICT SCOPE: only answer using the registered marketplace tools. Do NOT use outside knowledge for facts.",
        "- If the user asks anything the tools cannot answer (or asks a non-booking question), do NOT speculate. Reply with: \"" +
          fallback +
          "\"",
      ];

  return `You are a booking assistant for a stays and hotels marketplace.
The user is signed in as a ${role}.${ctx}

Rules:
${[...baseRules, ...scopeRules].join("\n")}`;
}
