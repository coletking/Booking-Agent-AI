import type { BookingAgentBackend } from "./backend.js";
import { executeBookingAgentTool } from "./tools.js";

export type IntentMatchContext = {
  accountTypeId: string;
  pageContext?: Record<string, unknown>;
};

/**
 * The result of a router that wants to short-circuit OpenAI for this turn.
 *
 * - `kind: "reply"` — the router has the full answer; return it as-is.
 * - `kind: "tool"` — execute a backend tool with the given args, then
 *   format the JSON result into a user-facing string.
 */
export type IntentMatch =
  | { kind: "reply"; reply: string }
  | {
      kind: "tool";
      tool: string;
      args: Record<string, unknown>;
      format: (data: unknown) => string;
    };

/**
 * Inspect the latest user message and optionally bypass OpenAI for this turn.
 * Return `null`/`undefined` to let the LLM handle the request as normal.
 */
export type IntentRouter = (
  message: string,
  context: IntentMatchContext,
) => IntentMatch | null | undefined | Promise<IntentMatch | null | undefined>;

/** Run multiple routers in order; first non-null match wins. */
export function composeIntentRouters(
  ...routers: IntentRouter[]
): IntentRouter {
  return async (message, context) => {
    for (const router of routers) {
      const result = await router(message, context);
      if (result) return result;
    }
    return null;
  };
}

/**
 * Internal: execute a matched intent against the backend and return the
 * user-facing reply string. Errors from the tool are surfaced as a short
 * apology so the caller still gets a usable reply.
 */
export async function runIntentMatch(
  match: IntentMatch,
  backend: BookingAgentBackend,
): Promise<string> {
  if (match.kind === "reply") return match.reply.trim();

  try {
    const raw = await executeBookingAgentTool(match.tool, match.args, backend);
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    return match.format(parsed).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "intent execution failed";
    return `I hit an error trying to handle that locally (${msg}). Please try rephrasing.`;
  }
}
