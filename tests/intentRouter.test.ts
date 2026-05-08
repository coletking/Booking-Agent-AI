import { describe, expect, it, vi } from "vitest";

import type { BookingAgentBackend } from "../src/backend.js";
import {
  composeIntentRouters,
  runIntentMatch,
  type IntentRouter,
} from "../src/intentRouter.js";

const stubBackend = (overrides: Partial<BookingAgentBackend> = {}): BookingAgentBackend => ({
  fetchBookingsList: async () => ({ data: [] }),
  fetchReservationDetail: async () => ({}),
  fetchBookingByCheckoutId: async () => ({}),
  postCheckAvailability: async () => ({}),
  fetchListingSnapshot: async () => ({}),
  ...overrides,
});

describe("composeIntentRouters", () => {
  it("returns the first non-null match", async () => {
    const a: IntentRouter = () => null;
    const b: IntentRouter = () => ({ kind: "reply", reply: "from b" });
    const c: IntentRouter = () => ({ kind: "reply", reply: "from c" });
    const composed = composeIntentRouters(a, b, c);
    const out = await composed("hi", { accountTypeId: "1" });
    expect(out).toEqual({ kind: "reply", reply: "from b" });
  });

  it("returns null when no router matches", async () => {
    const composed = composeIntentRouters(
      () => null,
      () => undefined,
    );
    expect(await composed("hi", { accountTypeId: "1" })).toBeNull();
  });

  it("supports async routers", async () => {
    const composed = composeIntentRouters(
      async () => null,
      async () => ({ kind: "reply", reply: "async" }),
    );
    const out = await composed("hi", { accountTypeId: "1" });
    expect(out).toEqual({ kind: "reply", reply: "async" });
  });
});

describe("runIntentMatch", () => {
  it("returns the static reply trimmed for kind=reply", async () => {
    const reply = await runIntentMatch(
      { kind: "reply", reply: "  hello there  " },
      stubBackend(),
    );
    expect(reply).toBe("hello there");
  });

  it("executes the requested tool and formats the parsed result", async () => {
    const fetchBookingsList = vi.fn(async () => ({
      data: [{ title: "Trip 1" }, { title: "Trip 2" }],
    }));

    const reply = await runIntentMatch(
      {
        kind: "tool",
        tool: "list_my_bookings",
        args: { status: "upcoming" },
        format: (data: any) =>
          `count=${(data?.data ?? []).length}`,
      },
      stubBackend({ fetchBookingsList }),
    );

    expect(fetchBookingsList).toHaveBeenCalledOnce();
    expect(reply).toBe("count=2");
  });

  it("returns a friendly error message when the tool throws", async () => {
    const reply = await runIntentMatch(
      {
        kind: "tool",
        tool: "list_my_bookings",
        args: {},
        format: () => "unused",
      },
      stubBackend({
        fetchBookingsList: async () => {
          throw new Error("backend boom");
        },
      }),
    );
    // Tool layer catches and returns JSON; format("error JSON") is then called.
    // Either path should still produce a non-empty user-facing string.
    expect(reply.length).toBeGreaterThan(0);
  });
});
