/**
 * Provider-agnostic LLM types. Each concrete provider (OpenAI, Anthropic, …)
 * serializes these into its own wire format and back. The agent loop in
 * `runTurn.ts` only sees these normalized types.
 */

export type LlmToolCall = {
  /** Stable identifier the provider uses to correlate the tool's result. */
  id: string;
  /** Tool name as registered in the catalog. */
  name: string;
  /** Already JSON-parsed arguments (no string parsing leaks out of providers). */
  arguments: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: LlmToolCall[];
    }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmTool = {
  name: string;
  description: string;
  /** JSON Schema (object) describing the tool's parameters. */
  parameters: object;
};

export type LlmCompletionResult =
  | { ok: true; content: string | null; toolCalls: LlmToolCall[] }
  | { ok: false; error: string };

export interface LlmProvider {
  /** Short stable identifier ("openai", "anthropic", ...). */
  readonly name: string;
  /** Used when the caller doesn't pass an explicit `model`. */
  readonly defaultModel: string;

  request(input: {
    apiKey: string;
    model: string;
    /** Single system prompt (already built by `buildBookingAgentSystemPrompt`). */
    system: string;
    messages: LlmMessage[];
    tools: LlmTool[];
    temperature?: number;
  }): Promise<LlmCompletionResult>;
}
