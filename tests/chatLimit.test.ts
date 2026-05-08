import { describe, expect, it } from "vitest";

import {
  buildChatLimitMessage,
  buildWhatsAppLink,
  checkChatLimit,
  countUserTurns,
} from "../src/chatLimit.js";
import type { BookingAgentUserMessage } from "../src/runTurn.js";

const u = (content: string): BookingAgentUserMessage => ({
  role: "user",
  content,
});
const a = (content: string): BookingAgentUserMessage => ({
  role: "assistant",
  content,
});

describe("countUserTurns", () => {
  it("counts only user-role messages", () => {
    expect(countUserTurns([u("a"), a("b"), u("c"), a("d"), u("e")])).toBe(3);
  });

  it("returns 0 for empty input", () => {
    expect(countUserTurns([])).toBe(0);
  });
});

describe("buildWhatsAppLink", () => {
  it("returns null when number is missing", () => {
    expect(buildWhatsAppLink(undefined, "hi")).toBeNull();
    expect(buildWhatsAppLink("", "hi")).toBeNull();
  });

  it("strips non-digits and builds wa.me URL", () => {
    expect(buildWhatsAppLink("+234-800-000-0000", undefined)).toBe(
      "https://wa.me/2348000000000",
    );
  });

  it("URL-encodes the prefilled message", () => {
    expect(buildWhatsAppLink("2348000000000", "Hi, I need help")).toBe(
      "https://wa.me/2348000000000?text=Hi%2C%20I%20need%20help",
    );
  });

  it("returns null when number contains no digits", () => {
    expect(buildWhatsAppLink("---", "hi")).toBeNull();
  });
});

describe("buildChatLimitMessage", () => {
  it("includes the WhatsApp link by default", () => {
    const msg = buildChatLimitMessage({
      maxTurns: 4,
      whatsappNumber: "2348000000000",
    });
    expect(msg).toContain("4 messages");
    expect(msg).toContain("https://wa.me/2348000000000");
  });

  it("falls back to a generic line when no number is provided", () => {
    const msg = buildChatLimitMessage({ maxTurns: 2 });
    expect(msg).toContain("2 messages");
    expect(msg).toContain("support team");
    expect(msg).not.toContain("wa.me");
  });

  it("honors a custom buildMessage", () => {
    const msg = buildChatLimitMessage({
      maxTurns: 4,
      whatsappNumber: "2348000000000",
      buildMessage: ({ link }) => `done: ${link ?? "no-link"}`,
    });
    expect(msg).toBe("done: https://wa.me/2348000000000");
  });
});

describe("checkChatLimit", () => {
  it("returns null when no options provided", () => {
    expect(
      checkChatLimit({ priorHistory: [u("a")], incoming: [u("b")] }),
    ).toBeNull();
  });

  it("returns null when within limit", () => {
    expect(
      checkChatLimit({
        priorHistory: [u("1"), a("ok"), u("2"), a("ok")],
        incoming: [u("3")],
        options: { maxTurns: 4 },
      }),
    ).toBeNull();
  });

  it("triggers once total user turns exceed maxTurns", () => {
    const out = checkChatLimit({
      priorHistory: [u("1"), a("a"), u("2"), a("a"), u("3"), a("a"), u("4"), a("a")],
      incoming: [u("5")],
      options: { maxTurns: 4, whatsappNumber: "2348000000000" },
    });
    expect(out).not.toBeNull();
    expect(out!.maxTurns).toBe(4);
    expect(out!.reply).toContain("https://wa.me/2348000000000");
  });

  it("uses default maxTurns of 4 when omitted", () => {
    const longHistory = [
      u("1"), a(""), u("2"), a(""), u("3"), a(""), u("4"), a(""),
    ];
    const out = checkChatLimit({
      priorHistory: longHistory,
      incoming: [u("5")],
      options: {},
    });
    expect(out).not.toBeNull();
    expect(out!.maxTurns).toBe(4);
  });
});
