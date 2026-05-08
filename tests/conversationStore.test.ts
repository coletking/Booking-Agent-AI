import { describe, expect, it } from "vitest";

import { InMemoryConversationStore } from "../src/conversationStore.js";

describe("InMemoryConversationStore", () => {
  it("returns an empty array for unseen sessions", async () => {
    const store = new InMemoryConversationStore();
    expect(await store.load("missing")).toEqual([]);
  });

  it("appends and reloads in order", async () => {
    const store = new InMemoryConversationStore();
    await store.append("s1", [{ role: "user", content: "hi" }]);
    await store.append("s1", [{ role: "assistant", content: "hello" }]);
    expect(await store.load("s1")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("isolates sessions", async () => {
    const store = new InMemoryConversationStore();
    await store.append("s1", [{ role: "user", content: "a" }]);
    await store.append("s2", [{ role: "user", content: "b" }]);
    expect(await store.load("s1")).toEqual([{ role: "user", content: "a" }]);
    expect(await store.load("s2")).toEqual([{ role: "user", content: "b" }]);
  });

  it("trims to maxMessagesPerSession", async () => {
    const store = new InMemoryConversationStore({ maxMessagesPerSession: 4 });
    for (let i = 0; i < 8; i++) {
      await store.append("s1", [{ role: "user", content: `m${i}` }]);
    }
    const out = await store.load("s1");
    expect(out).toHaveLength(4);
    expect(out.map((m) => m.content)).toEqual(["m4", "m5", "m6", "m7"]);
  });

  it("clear() drops the session", async () => {
    const store = new InMemoryConversationStore();
    await store.append("s1", [{ role: "user", content: "hi" }]);
    await store.clear!("s1");
    expect(await store.load("s1")).toEqual([]);
  });
});
