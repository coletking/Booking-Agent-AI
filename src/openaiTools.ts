/** OpenAI Chat Completions `tools` payload for this agent (JSON-schema parameters). */
export const BOOKING_AGENT_OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
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
  },
  {
    type: "function" as const,
    function: {
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
  },
  {
    type: "function" as const,
    function: {
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
  },
  {
    type: "function" as const,
    function: {
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
  },
  {
    type: "function" as const,
    function: {
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
  },
] as const;

/**
 * Optional out-of-scope tool: search the public web for booking-related
 * information (other listings, area info, travel guidance). Only
 * registered when the caller opts in via `allowOutOfScope: true` AND
 * the backend implements `webSearch`.
 */
export const WEB_SEARCH_OPENAI_TOOL = {
  type: "function" as const,
  function: {
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
  },
} as const;

/**
 * Build the OpenAI tools array for a turn. By default returns the
 * in-scope marketplace tools. Pass `includeWebSearch: true` to also
 * expose the `web_search` tool (only do this when the backend
 * implements `webSearch`).
 */
export function buildBookingAgentTools(
  options: { includeWebSearch?: boolean } = {},
): Array<(typeof BOOKING_AGENT_OPENAI_TOOLS)[number] | typeof WEB_SEARCH_OPENAI_TOOL> {
  if (options.includeWebSearch) {
    return [...BOOKING_AGENT_OPENAI_TOOLS, WEB_SEARCH_OPENAI_TOOL];
  }
  return [...BOOKING_AGENT_OPENAI_TOOLS];
}
