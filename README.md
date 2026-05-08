# ghece-booking-agent

TypeScript library for a **stays/hotels booking assistant**: OpenAI Chat Completions with function calling, **Zod-validated** tool arguments, and a **`BookingAgentBackend`** interface you implement for your API.

This package has **no** React or Next.js dependency. Run it on Node 20+ (uses `fetch`).

## Install

From npm:

```bash
npm install ghece-booking-agent
```

From the Git repository (app developers), install then build inside `node_modules/ghece-booking-agent` once, or use the published package above:

```bash
npm install git+https://github.com/coletking/Booking-Agent-AI.git#main
cd node_modules/ghece-booking-agent && npm install && npm run build
```

For **npm publish**, `prepublishOnly` runs `build` so consumers get `dist/` from the tarball.

## Build (maintainers)

```bash
npm install
npm run build
```

## Usage

1. Implement `BookingAgentBackend` (call your marketplace `/api/core` or equivalent with the user’s Bearer token and `UserType` header).
2. Call `runBookingAgentTurn` from a server route with `OPENAI_API_KEY` set.

```ts
import {
  runBookingAgentTurn,
  bookingsListPathForAccountType,
  type BookingAgentBackend,
} from "ghece-booking-agent";

const backend: BookingAgentBackend = {
  async fetchBookingsList({ status, page, perPage }) {
    const path = bookingsListPathForAccountType(accountTypeId);
    const qs = new URLSearchParams({
      status,
      page: String(page),
      per_page: String(perPage),
    });
    return coreFetch("GET", `${path}?${qs}`);
  },
  async fetchReservationDetail(id) {
    return coreFetch("GET", `/properties/reservations/${encodeURIComponent(id)}`);
  },
  async fetchBookingByCheckoutId(bookingId) {
    return coreFetch("GET", `/bookings?booking_id=${encodeURIComponent(bookingId)}`);
  },
  async postCheckAvailability(payload) {
    return coreFetch("POST", "/properties/check-availability", payload);
  },
  async fetchListingSnapshot({ url, uuid, platform, hostView }) {
    const qs = new URLSearchParams({ url });
    if (uuid) qs.set("uuid", uuid);
    qs.set("platform", platform);
    const route = hostView
      ? `/user/properties/view?${qs}`
      : `/properties/view?${qs}`;
    return coreFetch("GET", route);
  },
};

const result = await runBookingAgentTurn({
  messages: [{ role: "user", content: "Show my upcoming trips." }],
  backend,
  accountTypeId: "1", // guest=1, host=2, agent=3 — matches your auth
  openAiApiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
});

if (result.ok) {
  console.log(result.reply);
} else {
  console.error(result.code, result.error);
}
```

Adjust paths to match your backend. The default tool names map to common marketplace routes used in the reference app; fork or extend tools if your API differs.

## Conversation memory (optional)

`runBookingAgentTurn` can persist chat history per session via a
`ConversationStore`. Pass a `store` and a `sessionId` and the SDK will
load prior turns before calling OpenAI and append the new user/assistant
pair after a successful reply.

A reference `InMemoryConversationStore` is included (good for tests/dev,
not durable). For production, implement the interface against Redis,
Postgres, or any other store.

```ts
import {
  InMemoryConversationStore,
  runBookingAgentTurn,
  type ConversationStore,
} from "ghece-booking-agent";

const store: ConversationStore = new InMemoryConversationStore({
  maxMessagesPerSession: 60,
});

const result = await runBookingAgentTurn({
  messages: [{ role: "user", content: "Any update on my last booking?" }],
  backend,
  accountTypeId: "1",
  openAiApiKey: process.env.OPENAI_API_KEY,
  store,
  sessionId: `user:${userId}`,
});
```

Custom store skeleton:

```ts
import type { ConversationStore } from "ghece-booking-agent";

export const redisStore: ConversationStore = {
  async load(sessionId) {
    const raw = await redis.get(`chat:${sessionId}`);
    return raw ? JSON.parse(raw) : [];
  },
  async append(sessionId, messages) {
    const existing = await this.load(sessionId);
    const next = [...existing, ...messages].slice(-60);
    await redis.set(`chat:${sessionId}`, JSON.stringify(next));
  },
  async clear(sessionId) {
    await redis.del(`chat:${sessionId}`);
  },
};
```

## Cutting OpenAI cost (optional)

Two opt-in hooks reduce how often (and how much) you pay OpenAI:

### 1. Intent router — skip OpenAI entirely for known phrases

Match common requests with a regex (or any logic), call a tool directly,
and format the reply yourself. The LLM is never invoked on a match.

```ts
import {
  composeIntentRouters,
  runBookingAgentTurn,
  type IntentRouter,
} from "ghece-booking-agent";

const showTrips: IntentRouter = (msg) => {
  if (!/^(show|list)\s+(my\s+)?(upcoming\s+)?(trips|bookings)\b/i.test(msg)) {
    return null;
  }
  return {
    kind: "tool",
    tool: "list_my_bookings",
    args: { status: "upcoming", page: 1, per_page: 10 },
    format: (data: any) => {
      const items = data?.data ?? data?.items ?? [];
      if (!items.length) return "You have no upcoming trips.";
      return [
        "Your upcoming trips:",
        ...items.map((t: any) => `- ${t.title ?? t.id}`),
      ].join("\n");
    },
  };
};

const helpReply: IntentRouter = (msg) =>
  /^(help|what can you do)\b/i.test(msg)
    ? { kind: "reply", reply: "I can show your trips, look up a booking..." }
    : null;

await runBookingAgentTurn({
  messages,
  backend,
  accountTypeId,
  openAiApiKey: process.env.OPENAI_API_KEY,
  intentRouter: composeIntentRouters(helpReply, showTrips),
});
```

### 2. Summarizer — compact long histories

When stored history exceeds `after`, the older messages are condensed
into one paragraph (saved as `[SUMMARY] ...`) and the most recent
`keepRecent` messages are kept verbatim. Requires a store with `clear`.

```ts
await runBookingAgentTurn({
  messages,
  backend,
  accountTypeId,
  openAiApiKey: process.env.OPENAI_API_KEY,
  store,
  sessionId: `user:${userId}`,
  summarize: {
    after: 24,
    keepRecent: 8,
    summarizer: async (older) => {
      const text = older.map((m) => `${m.role}: ${m.content}`).join("\n");
      return await mySummarizer(text); // your own LLM/local model call
    },
  },
});
```

## Scope mode (`allowOutOfScope`)

By default the assistant stays strictly inside the marketplace: it only
uses the registered tools, never invents facts, and politely declines
anything off-topic.

```ts
// Default — strict, in-scope only.
await runBookingAgentTurn({
  messages, backend, accountTypeId,
  openAiApiKey: process.env.OPENAI_API_KEY,
  // allowOutOfScope: false (default)
  outOfScopeFallbackText:
    "I can only help with bookings here. Please request a chat with a human agent.",
});
```

Set `allowOutOfScope: true` to let the assistant answer general
booking/travel questions. If you also implement `backend.webSearch`,
the SDK registers a `web_search` tool so the model can look things up
on the public web.

```ts
const backend: BookingAgentBackend = {
  // ...your other methods...
  async webSearch({ query, maxResults }) {
    // Wire any provider you like (SerpAPI, Bing, Google CSE, your crawler).
    const res = await fetch(
      `https://api.example.com/search?q=${encodeURIComponent(query)}&n=${maxResults ?? 5}`,
      { headers: { Authorization: `Bearer ${process.env.SEARCH_API_KEY}` } },
    );
    return res.json();
  },
};

await runBookingAgentTurn({
  messages, backend, accountTypeId,
  openAiApiKey: process.env.OPENAI_API_KEY,
  allowOutOfScope: true, // unlocks general answers + web_search tool
});
```

`web_search` is **only** registered when both conditions hold:
1. `allowOutOfScope: true`, and
2. `backend.webSearch` is defined.

If the model invokes `web_search` without an implementation, it gets a
clear JSON error back and adapts.

## Security middleware

Security checks live in `runBookingAgentTurn` under the `security`
option. All checks run **before** any backend or OpenAI call. Pass
whichever subset you want.

### 1. Generate SDK API keys you can share

`generateSdkApiKeys` creates cryptographically strong base64url tokens
prefixed with `bsk_` (configurable). Store them server-side; share with
trusted callers.

```ts
import { generateSdkApiKeys } from "ghece-booking-agent";

console.log(generateSdkApiKeys(5));
// [
//   "bsk_K2k9Lw3Z...wA",
//   "bsk_Tb8qEr2...xQ",
//   ...
// ]
```

Run it once, save to a secrets manager / env var, then load on boot.

### 2. Configure security on a turn

```ts
import {
  generateSdkApiKeys,
  InMemoryRateLimitStore,
  runBookingAgentTurn,
} from "ghece-booking-agent";

const ALLOWED_KEYS = process.env.SDK_KEYS!.split(",");
const limiter = new InMemoryRateLimitStore();

const result = await runBookingAgentTurn({
  messages,
  backend,
  accountTypeId,
  openAiApiKey: process.env.OPENAI_API_KEY,

  sdkApiKey: req.headers["x-sdk-key"] as string,
  rateLimitKey: `${userId}`,
  security: {
    apiKeys: ALLOWED_KEYS,
    maxWordsPerMessage: 1000,
    blockSqlInjection: true,
    blockPromptInjection: true,
    stripControlChars: true,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60_000,
      store: limiter,
    },
  },
});

if (!result.ok) {
  switch (result.code) {
    case "INVALID_API_KEY": return res.status(401).send(result.error);
    case "RATE_LIMITED":   return res.status(429).header(
      "Retry-After", Math.ceil((result.retryAfterMs ?? 1000) / 1000),
    ).send(result.error);
    case "MESSAGE_TOO_LONG":
    case "BLOCKED_INPUT":  return res.status(400).send(result.error);
  }
}
```

### What each check does

| Option | Default | Effect |
|---|---|---|
| `apiKeys` | _none_ | Reject turns whose `sdkApiKey` doesn't match (timing-safe compare). |
| `maxWordsPerMessage` | 1000 | Reject any message above N words with `MESSAGE_TOO_LONG`. |
| `blockSqlInjection` | true | Reject user messages that match SQL-injection patterns (`UNION SELECT`, `' OR 1=1`, etc.). |
| `blockPromptInjection` | true | Reject "ignore previous instructions" style payloads. |
| `stripControlChars` | true | Remove ASCII control characters (`\u0000-\u001F` minus tab/CR/LF). |
| `rateLimit` | _none_ | Sliding window per `rateLimitKey` (falls back to `sdkApiKey` then `"anonymous"`). |

### Production notes

- **Rate limiter store**: `InMemoryRateLimitStore` is per-process. For
  multi-instance deployments implement `RateLimitStore` against Redis
  or a database — same interface, swap the impl.
- **Inject SDK keys via env**: never commit them. A typical pattern is
  `SDK_KEYS=key1,key2,key3` then `process.env.SDK_KEYS!.split(",")`.
- **SQL-injection check is defense-in-depth**: your backend should
  still use parameterized queries / ORMs. The SDK has no DB awareness.
- **Prompt-injection** is heuristic: it catches the loud cases. Treat
  the LLM's tool calls as untrusted regardless.

## Chat-turn limit (handoff to support)

Cap how many user messages a session may send. Once exceeded, the SDK
returns a friendly support message (with an optional WhatsApp deep
link) **without calling OpenAI**. The reply is also persisted (when a
store is configured), so subsequent turns keep returning the limit
message until the session is cleared.

```ts
const result = await runBookingAgentTurn({
  messages, backend, accountTypeId,
  openAiApiKey: process.env.OPENAI_API_KEY,
  store,                       // recommended: limit counts use stored history
  sessionId: `user:${userId}`,
  chatLimit: {
    maxTurns: 4,
    whatsappNumber: "2348000000000",
    whatsappMessage: "Hi, I need help with my booking.",
  },
});

if (result.ok && result.limited) {
  // Disable the input box, surface a banner, log the handoff, etc.
}
```

Default support message looks like:

> You've reached the limit of 4 messages in this chat. Please continue
> the conversation with our support team on WhatsApp:
> https://wa.me/2348000000000?text=Hi%2C%20I%20need%20help...

### Custom message

```ts
chatLimit: {
  maxTurns: 4,
  whatsappNumber: "2348000000000",
  buildMessage: ({ link }) =>
    link
      ? `You've used all 4 free chats. Talk to our team here: ${link}`
      : "You've used all 4 free chats. Email support@example.com.",
},
```

### Notes

- Counting is done over `priorHistory + incoming` user messages, so it
  works best with a `ConversationStore`. Without one, you must pass the
  full history in `messages` for the count to be accurate.
- `result.limited === true` lets your UI react (disable input, show a
  banner, link to WhatsApp inline, etc.).
- The limit fires on **user** messages only; assistant replies don't
  count.

## Environment

- `OPENAI_API_KEY` — required for `runBookingAgentTurn`
- `OPENAI_MODEL` — optional, default `gpt-4o-mini`

## License

MIT
