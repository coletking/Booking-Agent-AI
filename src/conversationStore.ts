import type { BookingAgentUserMessage } from "./runTurn.js";

/**
 * Persists chat history per session so each turn can include prior messages
 * without the caller manually threading them. Implementations can be backed
 * by an in-memory map (tests/dev), Redis, Postgres, or any other store.
 */
export interface ConversationStore {
  /** Return the stored messages for a session in chronological order. */
  load(sessionId: string): Promise<BookingAgentUserMessage[]>;

  /** Append messages produced during a turn (user + assistant reply). */
  append(
    sessionId: string,
    messages: BookingAgentUserMessage[],
  ): Promise<void>;

  /** Optional: drop a session (e.g. user clears chat). */
  clear?(sessionId: string): Promise<void>;
}

/**
 * Reference implementation for development and tests. Not durable: contents
 * are lost when the process exits and not safe across multiple instances.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly buckets = new Map<string, BookingAgentUserMessage[]>();
  private readonly maxMessagesPerSession: number;

  constructor(options: { maxMessagesPerSession?: number } = {}) {
    this.maxMessagesPerSession = Math.max(
      2,
      options.maxMessagesPerSession ?? 60,
    );
  }

  async load(sessionId: string): Promise<BookingAgentUserMessage[]> {
    const bucket = this.buckets.get(sessionId);
    return bucket ? [...bucket] : [];
  }

  async append(
    sessionId: string,
    messages: BookingAgentUserMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;
    const existing = this.buckets.get(sessionId) ?? [];
    const next = [...existing, ...messages];
    const trimmed =
      next.length > this.maxMessagesPerSession
        ? next.slice(next.length - this.maxMessagesPerSession)
        : next;
    this.buckets.set(sessionId, trimmed);
  }

  async clear(sessionId: string): Promise<void> {
    this.buckets.delete(sessionId);
  }
}
