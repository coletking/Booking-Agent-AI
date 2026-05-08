import { describe, expect, it } from "vitest";

import { bookingsListPathForAccountType } from "../src/listingsPath.js";
import { buildBookingAgentSystemPrompt } from "../src/prompt.js";

describe("bookingsListPathForAccountType", () => {
  it("returns the host path for type 2", () => {
    expect(bookingsListPathForAccountType("2")).toBe(
      "/properties/reservations-list",
    );
  });

  it("returns the agent path for type 3", () => {
    expect(bookingsListPathForAccountType("3")).toBe(
      "/properties/agent/trips-list",
    );
  });

  it("falls back to guest path for type 1 and unknown ids", () => {
    expect(bookingsListPathForAccountType("1")).toBe("/properties/trips-list");
    expect(bookingsListPathForAccountType("99")).toBe("/properties/trips-list");
  });
});

describe("buildBookingAgentSystemPrompt", () => {
  it("identifies guest role and excludes context block when none", () => {
    const prompt = buildBookingAgentSystemPrompt("1");
    expect(prompt).toContain("signed in as a guest");
    expect(prompt).not.toContain("Page context");
  });

  it("identifies host and agent roles", () => {
    expect(buildBookingAgentSystemPrompt("2")).toContain("signed in as a host");
    expect(buildBookingAgentSystemPrompt("3")).toContain("signed in as a agent");
  });

  it("includes context block when context is non-empty", () => {
    const prompt = buildBookingAgentSystemPrompt("1", { listingId: "abc" });
    expect(prompt).toContain("Page context");
    expect(prompt).toContain("abc");
  });

  it("strict mode (default) includes scope rules and fallback text", () => {
    const prompt = buildBookingAgentSystemPrompt("1", undefined, {
      outOfScopeFallbackText: "Talk to support please.",
    });
    expect(prompt).toContain("STRICT SCOPE");
    expect(prompt).toContain("Talk to support please.");
  });

  it("open mode unlocks general/web-search rules", () => {
    const prompt = buildBookingAgentSystemPrompt("1", undefined, {
      allowOutOfScope: true,
    });
    expect(prompt).toContain("MAY answer general booking");
    expect(prompt).toContain("web_search");
    expect(prompt).not.toContain("STRICT SCOPE");
  });
});
