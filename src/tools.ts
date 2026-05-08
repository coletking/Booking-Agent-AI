import type { BookingAgentBackend } from "./backend.js";
import {
  checkAvailabilitySchema,
  getBookingByPaymentIdSchema,
  getBookingDetailSchema,
  getListingSnapshotSchema,
  listMyBookingsSchema,
  schemaErrorJson,
  webSearchSchema,
} from "./toolSchemas.js";

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/**
 * Runs one marketplace tool and returns JSON text for the LLM (never throws).
 */
export async function executeBookingAgentTool(
  toolName: string,
  toolArguments: unknown,
  backend: BookingAgentBackend,
): Promise<string> {
  const args = parseToolArgs(toolArguments);

  try {
    switch (toolName) {
      case "list_my_bookings": {
        const parsed = listMyBookingsSchema.safeParse(args);
        if (!parsed.success) return schemaErrorJson(parsed.error);

        const status = parsed.data.status
          ? parsed.data.status.toLowerCase().replace(/ /g, "_")
          : "upcoming";
        const page = parsed.data.page ?? 1;
        const perPage = parsed.data.per_page ?? 10;

        const data = await backend.fetchBookingsList({
          status,
          page,
          perPage,
        });
        return JSON.stringify(data);
      }

      case "get_booking_detail": {
        const parsed = getBookingDetailSchema.safeParse(args);
        if (!parsed.success) return schemaErrorJson(parsed.error);

        const id = parsed.data.id ?? parsed.data.reservation_id;
        if (id === undefined || id === null || String(id).trim() === "") {
          return JSON.stringify({
            error: "Missing reservation id. Pass id or reservation_id.",
          });
        }

        const data = await backend.fetchReservationDetail(String(id));
        return JSON.stringify(data);
      }

      case "get_booking_by_payment_id": {
        const parsed = getBookingByPaymentIdSchema.safeParse(args);
        if (!parsed.success) return schemaErrorJson(parsed.error);

        const bookingId = String(parsed.data.booking_id).trim();
        if (!bookingId) {
          return JSON.stringify({ error: "booking_id is empty." });
        }

        const data = await backend.fetchBookingByCheckoutId(bookingId);
        return JSON.stringify(data);
      }

      case "check_availability": {
        const parsed = checkAvailabilitySchema.safeParse(args);
        if (!parsed.success) return schemaErrorJson(parsed.error);

        const data = await backend.postCheckAvailability(
          parsed.data.payload as Record<string, unknown>,
        );
        return JSON.stringify(data);
      }

      case "get_listing_snapshot": {
        const parsed = getListingSnapshotSchema.safeParse(args);
        if (!parsed.success) return schemaErrorJson(parsed.error);

        const url =
          typeof parsed.data.property_url === "string" &&
          parsed.data.property_url.trim()
            ? parsed.data.property_url.trim()
            : parsed.data.url.trim();

        const uuid =
          parsed.data.uuid?.trim() ||
          parsed.data.property_uuid?.trim() ||
          undefined;

        const platform =
          parsed.data.platform?.trim() && parsed.data.platform.trim().length > 0
            ? parsed.data.platform.trim()
            : "deityvillas";

        const hostView =
          parsed.data.use_my_listing === true ||
          parsed.data.host_view === true;

        const data = await backend.fetchListingSnapshot({
          url,
          uuid,
          platform,
          hostView,
        });
        return JSON.stringify(data);
      }

      case "web_search": {
        if (typeof backend.webSearch !== "function") {
          return JSON.stringify({
            error:
              "web_search is not available: backend does not implement webSearch.",
          });
        }
        const parsed = webSearchSchema.safeParse(args);
        if (!parsed.success) return schemaErrorJson(parsed.error);

        const data = await backend.webSearch({
          query: parsed.data.query.trim(),
          maxResults: parsed.data.max_results,
        });
        return JSON.stringify(data);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tool execution failed";
    return JSON.stringify({ error: message });
  }
}
