import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  anthropicProvider,
  type LlmMessage,
  type LlmTool,
} from "../src/index.js";
import type { BookingAgentBackend } from "../src/backend.js";
import {
  runBookingAgentTurn,
  type BookingAgentUserMessage,
} from "../src/runTurn.js";

/**
 * Build a fetch mock that returns a queued Anthropic response per call.
 * Each entry is a `content` array — i.e. an array of `text` and/or
 * `tool_use` blocks.
 */
function mockAnthropic(
  responses: Array<{
    content: Array<
      | { type: "text"; text: string }
      | {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        }
    >;
    stop_reason?: string;
  }>,
) {
  let i = 0;
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      messages?: unknown[];
      tools?: unknown[];
      system?: string;
    };
    capturedRequests.push(body);
    const next = responses[i++] ?? {
      content: [{ type: "text", text: "(no more)" }],
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "msg_x", role: "assistant", ...next }),
    } as unknown as Response;
  });
}

/** Captured request bodies — reset in beforeEach. */
let capturedRequests: Array<{
  messages?: unknown[];
  tools?: unknown[];
  system?: string;
}> = [];

const stubBackend = (
  overrides: Partial<BookingAgentBackend> = {},
): BookingAgentBackend => ({
  fetchBookingsList: async () => ({ data: [] }),
  fetchReservationDetail: async () => ({}),
  fetchBookingByCheckoutId: async () => ({}),
  postCheckAvailability: async () => ({}),
  fetchListingSnapshot: async () => ({}),
  ...overrides,
});

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  capturedRequests = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("anthropicProvider — wire format", () => {
  it("sends `system` as a top-level field, not in messages", async () => {
    globalThis.fetch = mockAnthropic([
      { content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" },
    ]) as never;

    const tools: LlmTool[] = [
      {
        name: "noop",
        description: "noop",
        parameters: { type: "object", properties: {} },
      },
    ];
    const messages: LlmMessage[] = [{ role: "user", content: "hello" }];
    const result = await anthropicProvider.request({
      apiKey: "ak",
      model: "claude-test",
      system: "SYS",
      messages,
      tools,
    });

    expect(result.ok).toBe(true);
    const body = capturedRequests[0]!;
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    // Tools are converted to Anthropic shape (no `type: "function"` wrapper).
    expect(body.tools).toEqual([
      {
        name: "noop",
        description: "noop",
        input_schema: { type: "object", properties: {} },
      },
    ]);
  });

  it("groups consecutive tool results into a single user message", async () => {
    globalThis.fetch = mockAnthropic([
      { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" },
    ]) as never;

    const messages: LlmMessage[] = [
      { role: "user", content: "do two things" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "t1", name: "list_my_bookings", arguments: {} },
          { id: "t2", name: "list_my_bookings", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "t1", content: "{\"ok\":1}" },
      { role: "tool", toolCallId: "t2", content: "{\"ok\":2}" },
    ];

    await anthropicProvider.request({
      apiKey: "ak",
      model: "claude-test",
      system: "S",
      messages,
      tools: [],
    });

    const sent = capturedRequests[0]!.messages as Array<{
      role: string;
      content: unknown;
    }>;

    // user, assistant(tool_use x2), user(tool_result x2)  -> 3 messages total
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual({ role: "user", content: "do two things" });
    expect((sent[1] as { content: unknown[] }).content).toHaveLength(2);
    const lastContent = sent[2]!.content as Array<{
      type: string;
      tool_use_id: string;
    }>;
    expect(lastContent).toHaveLength(2);
    expect(lastContent.map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
    expect(lastContent.every((b) => b.type === "tool_result")).toBe(true);
  });

  it("normalizes tool_use blocks to LlmToolCall", async () => {
    globalThis.fetch = mockAnthropic([
      {
        content: [
          { type: "text", text: "let me check" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "list_my_bookings",
            input: { status: "upcoming" },
          },
        ],
        stop_reason: "tool_use",
      },
    ]) as never;

    const result = await anthropicProvider.request({
      apiKey: "ak",
      model: "claude-test",
      system: "S",
      messages: [{ role: "user", content: "trips?" }],
      tools: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("let me check");
      expect(result.toolCalls).toEqual([
        {
          id: "toolu_1",
          name: "list_my_bookings",
          arguments: { status: "upcoming" },
        },
      ]);
    }
  });

  it("returns ok:false on non-2xx with the upstream error message", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({ error: { message: "bad key" } }),
        }) as unknown as Response,
    ) as never;

    const result = await anthropicProvider.request({
      apiKey: "bad",
      model: "claude-test",
      system: "S",
      messages: [{ role: "user", content: "x" }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad key");
  });
});

describe("runBookingAgentTurn — anthropic provider", () => {
  it("returns MISSING_API_KEY when anthropic key is empty", async () => {
    const result = await runBookingAgentTurn({
      messages: [{ role: "user", content: "hi" }] as BookingAgentUserMessage[],
      backend: stubBackend(),
      accountTypeId: "1",
      provider: "anthropic",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MISSING_API_KEY");
  });

  it("returns the assistant reply on a single non-tool turn", async () => {
    globalThis.fetch = mockAnthropic([
      { content: [{ type: "text", text: "hi back" }], stop_reason: "end_turn" },
    ]) as never;

    const result = await runBookingAgentTurn({
      messages: [{ role: "user", content: "hi" }] as BookingAgentUserMessage[],
      backend: stubBackend(),
      accountTypeId: "1",
      provider: "anthropic",
      anthropicApiKey: "ak-test",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("hi back");
  });

  it("loops through Anthropic tool_use → tool_result → final text", async () => {
    const fetchBookingsList = vi.fn(async () => ({ data: [{ id: "T1" }] }));
    globalThis.fetch = mockAnthropic([
      {
        content: [
          {
            type: "tool_use",
            id: "toolu_a",
            name: "list_my_bookings",
            input: { status: "upcoming" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Here is your trip." }],
        stop_reason: "end_turn",
      },
    ]) as never;

    const result = await runBookingAgentTurn({
      messages: [
        { role: "user", content: "trips?" },
      ] as BookingAgentUserMessage[],
      backend: stubBackend({ fetchBookingsList }),
      accountTypeId: "1",
      provider: "anthropic",
      anthropicApiKey: "ak-test",
    });

    expect(fetchBookingsList).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("Here is your trip.");

    // Second request should contain a user message with a tool_result block
    // referring to toolu_a.
    const secondBody = capturedRequests[1]!;
    const msgs = secondBody.messages as Array<{
      role: string;
      content: unknown;
    }>;
    const lastMsg = msgs[msgs.length - 1]!;
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_a", content: expect.any(String) },
    ]);
  });

  it("uses provider's defaultModel when no model is supplied", async () => {
    globalThis.fetch = mockAnthropic([
      { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" },
    ]) as never;

    await runBookingAgentTurn({
      messages: [{ role: "user", content: "hi" }] as BookingAgentUserMessage[],
      backend: stubBackend(),
      accountTypeId: "1",
      provider: "anthropic",
      anthropicApiKey: "ak-test",
    });

    expect(capturedRequests[0]).toBeDefined();
    expect(
      (capturedRequests[0] as unknown as { model: string }).model,
    ).toBe(anthropicProvider.defaultModel);
  });
});
