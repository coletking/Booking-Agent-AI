import { describe, expect, it, vi } from "vitest";

import type { BookingAgentBackend } from "../src/backend.js";
import { executeBookingAgentTool } from "../src/tools.js";

const stubBackend = (overrides: Partial<BookingAgentBackend> = {}): BookingAgentBackend => ({
  fetchBookingsList: async () => ({ data: [] }),
  fetchReservationDetail: async () => ({}),
  fetchBookingByCheckoutId: async () => ({}),
  postCheckAvailability: async () => ({}),
  fetchListingSnapshot: async () => ({}),
  ...overrides,
});

describe("executeBookingAgentTool", () => {
  it("list_my_bookings normalizes status and applies defaults", async () => {
    const fetchBookingsList = vi.fn(async () => ({ data: [{ id: "x" }] }));
    const out = await executeBookingAgentTool(
      "list_my_bookings",
      { status: "My Trips" },
      stubBackend({ fetchBookingsList }),
    );
    expect(fetchBookingsList).toHaveBeenCalledWith({
      status: "my_trips",
      page: 1,
      perPage: 10,
    });
    expect(JSON.parse(out)).toEqual({ data: [{ id: "x" }] });
  });

  it("get_booking_detail accepts id or reservation_id", async () => {
    const fetchReservationDetail = vi.fn(async (id: string) => ({ id }));
    const a = await executeBookingAgentTool(
      "get_booking_detail",
      { id: "123" },
      stubBackend({ fetchReservationDetail }),
    );
    const b = await executeBookingAgentTool(
      "get_booking_detail",
      { reservation_id: "456" },
      stubBackend({ fetchReservationDetail }),
    );
    expect(JSON.parse(a)).toEqual({ id: "123" });
    expect(JSON.parse(b)).toEqual({ id: "456" });
  });

  it("get_booking_detail returns error when id missing", async () => {
    const out = await executeBookingAgentTool(
      "get_booking_detail",
      {},
      stubBackend(),
    );
    expect(JSON.parse(out)).toMatchObject({ error: expect.stringMatching(/id/i) });
  });

  it("check_availability forwards payload to backend", async () => {
    const postCheckAvailability = vi.fn(async (p) => ({ echo: p }));
    const out = await executeBookingAgentTool(
      "check_availability",
      { payload: { property_id: "p1", nights: 2 } },
      stubBackend({ postCheckAvailability }),
    );
    expect(postCheckAvailability).toHaveBeenCalledWith({
      property_id: "p1",
      nights: 2,
    });
    expect(JSON.parse(out)).toEqual({ echo: { property_id: "p1", nights: 2 } });
  });

  it("get_listing_snapshot prefers property_url over url and resolves platform/hostView", async () => {
    const fetchListingSnapshot = vi.fn(async (i) => ({ ok: true, ...i }));
    const out = await executeBookingAgentTool(
      "get_listing_snapshot",
      {
        url: "fallback",
        property_url: "primary",
        property_uuid: "uuid-123",
        platform: "deityvillas",
        use_my_listing: true,
      },
      stubBackend({ fetchListingSnapshot }),
    );
    expect(fetchListingSnapshot).toHaveBeenCalledWith({
      url: "primary",
      uuid: "uuid-123",
      platform: "deityvillas",
      hostView: true,
    });
    expect(JSON.parse(out)).toMatchObject({ ok: true });
  });

  it("web_search returns error when backend has no impl", async () => {
    const out = await executeBookingAgentTool(
      "web_search",
      { query: "best hotels in lagos" },
      stubBackend(), // no webSearch
    );
    expect(JSON.parse(out)).toMatchObject({
      error: expect.stringMatching(/web_search.*not available/i),
    });
  });

  it("web_search calls backend.webSearch when implemented", async () => {
    const webSearch = vi.fn(async (i) => ({ results: [i.query] }));
    const out = await executeBookingAgentTool(
      "web_search",
      { query: "best hotels" },
      stubBackend({ webSearch }),
    );
    expect(webSearch).toHaveBeenCalledWith({
      query: "best hotels",
      maxResults: undefined,
    });
    expect(JSON.parse(out)).toEqual({ results: ["best hotels"] });
  });

  it("returns Unknown tool for unrecognized names", async () => {
    const out = await executeBookingAgentTool(
      "definitely_not_a_tool",
      {},
      stubBackend(),
    );
    expect(JSON.parse(out)).toMatchObject({ error: expect.stringMatching(/Unknown tool/) });
  });

  it("never throws when the backend errors", async () => {
    const out = await executeBookingAgentTool(
      "list_my_bookings",
      {},
      stubBackend({
        fetchBookingsList: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(JSON.parse(out)).toMatchObject({ error: "network down" });
  });
});
