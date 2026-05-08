import type { ConversationStore } from "./conversationStore.js";
import type { BookingAgentUserMessage } from "./runTurn.js";

/**
 * Pure function that condenses older messages into a short paragraph.
 * Implementations may call OpenAI, a local model, or use rule-based
 * summarization. The returned string is stored as a single assistant
 * message prefixed with `[SUMMARY] ` so the model treats it as context.
 */
export type ConversationSummarizer = (
  older: BookingAgentUserMessage[],
) => Promise<string>;

export type SummarizeOptions = {
  /** Trigger summarization once stored history grows beyond this length. */
  after: number;
  /** Number of most-recent messages to keep verbatim after summarizing. */
  keepRecent: number;
  /** Function that produces the summary text. */
  summarizer: ConversationSummarizer;
};

const SUMMARY_PREFIX = "[SUMMARY] ";

/**
 * Compact stored history when it grows past `after`. Replaces all but the
 * `keepRecent` most recent messages with a single summary entry.
 *
 * Requires a store that implements `clear` so we can rewrite history
 * atomically. If `clear` is missing, this is a no-op (logged silently).
 */
export async function maybeSummarizeHistory(args: {
  store: ConversationStore;
  sessionId: string;
  options: SummarizeOptions;
}): Promise<void> {
  const { store, sessionId, options } = args;

  if (!store.clear) return;
  if (options.after <= options.keepRecent) return;

  const history = await store.load(sessionId);
  if (history.length <= options.after) return;

  const splitAt = history.length - options.keepRecent;
  const older = history.slice(0, splitAt);
  const recent = history.slice(splitAt);
  if (older.length === 0) return;

  const carriedSummary = older[0]?.content?.startsWith(SUMMARY_PREFIX)
    ? older[0].content
    : null;
  const olderToSummarize = carriedSummary ? older.slice(1) : older;

  let summaryText: string;
  try {
    summaryText = await options.summarizer(olderToSummarize);
  } catch {
    return;
  }
  if (!summaryText.trim()) return;

  const merged = carriedSummary
    ? `${carriedSummary}\n${summaryText.trim()}`
    : `${SUMMARY_PREFIX}${summaryText.trim()}`;

  await store.clear(sessionId);
  await store.append(sessionId, [
    { role: "assistant", content: merged },
    ...recent,
  ]);
}
