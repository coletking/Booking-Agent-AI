import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookingAgentBackend } from "../src/backend.js";
import { InMemoryConversationStore } from "../src/conversationStore.js";
import { generateSdkApiKeys } from "../src/security.js";
import {
  runBookingAgentTurn,
  type BookingAgentUserMessage,
} from "../src/runTurn.js";

/**
 * Build a fetch mock that returns the next queued OpenAI completion on
 * each call. Each entry is `{ content?, tool_calls? }` (the message
 * portion of OpenAI's response).
 */
function mockOpenAi(
  responses: Array<{
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  }>,
) {
  let i = 0;
  return vi.fn(async () => {
    const msg = responses[i++] ?? { content: "(no more responses)" };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: msg }] }),
    } as unknown as Response;
  });
}

const stubBackend = (overrides: Partial<BookingAgentBackend> = {}): BookingAgentBackend => ({
  fetchBookingsList: async () => ({ data: [] }),
  fetchReservationDetail: async () => ({}),
  fetchBookingByCheckoutId: async () => ({}),
  postCheckAvailability: async () => ({}),
  fetchListingSnapshot: async () => ({}),
  ...overrides,
});

const baseTurn = (
  overrides: Partial<Parameters<typeof runBookingAgentTurn>[0]> = {},
) => ({
  messages: [{ role: "user", content: "hi" }] as BookingAgentUserMessage[],
  backend: stubBackend(),
  accountTypeId: "1",
  openAiApiKey: "sk-test",
  ...overrides,
});

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("runBookingAgentTurn — basic", () => {
  it("returns MISSING_OPENAI_KEY when key is empty", async () => {
    const result = await runBookingAgentTurn(
      baseTurn({ openAiApiKey: "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MISSING_OPENAI_KEY");
  });

  it("returns the assistant reply on a single non-tool turn", async () => {
    globalThis.fetch = mockOpenAi([{ content: "hi back" }]) as never;
    const result = await runBookingAgentTurn(baseTurn());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("hi back");
  });

  it("loops through tool calls and returns the final reply", async () => {
    const fetchBookingsList = vi.fn(async () => ({ data: [{ id: "T1" }] }));
    globalThis.fetch = mockOpenAi([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "list_my_bookings",
              arguments: JSON.stringify({ status: "upcoming" }),
            },
          },
        ],
      },
      { content: "Here is your trip." },
    ]) as never;

    const result = await runBookingAgentTurn(
      baseTurn({ backend: stubBackend({ fetchBookingsList }) }),
    );

    expect(fetchBookingsList).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("Here is your trip.");
  });
});

describe("runBookingAgentTurn — security", () => {
  it("rejects with INVALID_API_KEY when sdkApiKey is missing", async () => {
    const keys = generateSdkApiKeys(1);
    const result = await runBookingAgentTurn(
      baseTurn({
        security: { apiKeys: keys },
        // no sdkApiKey
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_API_KEY");
  });

  it("blocks SQL-injection-looking input", async () => {
    const result = await runBookingAgentTurn(
      baseTurn({
        messages: [{ role: "user", content: "'; DROP TABLE users; --" }],
        security: { blockSqlInjection: true },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BLOCKED_INPUT");
  });

  it("blocks messages over the word limit", async () => {
    const big = "word ".repeat(20).trim();
    const result = await runBookingAgentTurn(
      baseTurn({
        messages: [{ role: "user", content: big }],
        security: { maxWordsPerMessage: 10 },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MESSAGE_TOO_LONG");
  });
});

describe("runBookingAgentTurn — chat limit", () => {
  it("returns the WhatsApp fallback once limit is exceeded", async () => {
    const store = new InMemoryConversationStore();
    // Seed 4 user/assistant pairs.
    for (let i = 1; i <= 4; i++) {
      await store.append("s1", [
        { role: "user", content: `user-${i}` },
        { role: "assistant", content: `assistant-${i}` },
      ]);
    }

    // The mock should NOT be called — limit short-circuits.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const result = await runBookingAgentTurn(
      baseTurn({
        store,
        sessionId: "s1",
        messages: [{ role: "user", content: "user-5" }],
        chatLimit: { maxTurns: 4, whatsappNumber: "2348000000000" },
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.limited).toBe(true);
      expect(result.reply).toContain("https://wa.me/2348000000000");
    }
  });

  it("does not trigger when within the limit", async () => {
    const store = new InMemoryConversationStore();
    await store.append("s1", [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ]);
    globalThis.fetch = mockOpenAi([{ content: "ok" }]) as never;

    const result = await runBookingAgentTurn(
      baseTurn({
        store,
        sessionId: "s1",
        messages: [{ role: "user", content: "u2" }],
        chatLimit: { maxTurns: 4 },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reply).toBe("ok");
      expect(result.limited).toBeUndefined();
    }
  });
});

describe("runBookingAgentTurn — intent router", () => {
  it("short-circuits OpenAI when an intent matches (kind=reply)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const result = await runBookingAgentTurn(
      baseTurn({
        messages: [{ role: "user", content: "help" }],
        intentRouter: (msg) =>
          msg === "help" ? { kind: "reply", reply: "I can help with bookings." } : null,
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("I can help with bookings.");
  });

  it("falls through to OpenAI when no intent matches", async () => {
    globalThis.fetch = mockOpenAi([{ content: "from llm" }]) as never;
    const result = await runBookingAgentTurn(
      baseTurn({
        intentRouter: () => null,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("from llm");
  });
});

describe("runBookingAgentTurn — memory persistence", () => {
  it("appends the user + assistant pair to the store after a successful turn", async () => {
    const store = new InMemoryConversationStore();
    globalThis.fetch = mockOpenAi([{ content: "got it" }]) as never;

    await runBookingAgentTurn(
      baseTurn({
        store,
        sessionId: "s1",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    const saved = await store.load("s1");
    expect(saved).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "got it" },
    ]);
  });
});
