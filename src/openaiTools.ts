import type { LlmTool } from "./llm.js";

/**
 * Provider-agnostic catalog of marketplace tools the agent can call.
 * Concrete providers serialize this into their own wire format.
 */
export const BOOKING_AGENT_TOOLS: LlmTool[] = [
  {
    name: "list_my_bookings",
    description:
      "List the signed-in user's bookings: guest trips, host reservations, or agent trips (the host app wires the correct API). Use status filters like upcoming, completed, or pending as supported by the app.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter status, lower-case with underscores (e.g. upcoming, completed).",
        },
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "get_booking_detail",
    description:
      "Fetch full reservation/trip detail by reservation id (same endpoint as Trips / Reservations detail).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Reservation / trip id" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_booking_by_payment_id",
    description:
      "Look up a booking by checkout booking_id (payment success flow).",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
      },
      required: ["booking_id"],
    },
  },
  {
    name: "check_availability",
    description:
      "Check availability for dates/guests. The payload must match the marketplace listing flow (property_id, uuid, platform, stay types, dates, rooms for hotels).",
    parameters: {
      type: "object",
      properties: {
        payload: {
          type: "object",
          description: "Exact JSON body forwarded to check-availability.",
        },
      },
      required: ["payload"],
    },
  },
  {
    name: "get_listing_snapshot",
    description:
      "Load listing/property details by public URL slug (optional uuid). Read-only.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Listing URL key/slug from the site",
        },
        uuid: { type: "string" },
        platform: { type: "string" },
        use_my_listing: {
          type: "boolean",
          description:
            "If true, uses the host/user property view endpoint for own listings.",
        },
      },
      required: ["url"],
    },
  },
];

export const WEB_SEARCH_TOOL: LlmTool = {
  name: "web_search",
  description:
    "Search the public web for booking, hotel, or travel information not available in this app's database. Use only when the marketplace tools cannot answer.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Plain-language search query.",
      },
      max_results: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Optional cap on the number of results to return.",
      },
    },
    required: ["query"],
  },
};

/** Provider-agnostic builder used by the agent loop. */
export function buildBookingAgentTools(
  options: { includeWebSearch?: boolean } = {},
): LlmTool[] {
  return options.includeWebSearch
    ? [...BOOKING_AGENT_TOOLS, WEB_SEARCH_TOOL]
    : [...BOOKING_AGENT_TOOLS];
}

// ---------------------------------------------------------------------------
// Backwards-compatible OpenAI shape
// ---------------------------------------------------------------------------

/** OpenAI Chat Completions `tools` payload (kept for back-compat). */
export const BOOKING_AGENT_OPENAI_TOOLS = BOOKING_AGENT_TOOLS.map(
  toOpenAiToolShape,
);

export const WEB_SEARCH_OPENAI_TOOL = toOpenAiToolShape(WEB_SEARCH_TOOL);

/** Convert one normalized tool to OpenAI's wrapped `{ type: "function", function: {...} }` shape. */
export function toOpenAiToolShape(tool: LlmTool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Convert one normalized tool to Anthropic's `{ name, description, input_schema }` shape. */
export function toAnthropicToolShape(tool: LlmTool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}
