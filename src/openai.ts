import type { LlmMessage, LlmProvider, LlmTool, LlmToolCall } from "./llm.js";
import { toOpenAiToolShape } from "./openaiTools.js";

// ---------------------------------------------------------------------------
// Wire types (kept exported for back-compat with earlier consumers / tests)
// ---------------------------------------------------------------------------

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAiChatMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenAiCompletionResult =
  | {
      ok: true;
      choice?: {
        content?: string | null;
        tool_calls?: OpenAiToolCall[];
      };
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Serialization: normalized LlmMessage[] -> OpenAI wire format
// ---------------------------------------------------------------------------

function toOpenAiMessages(
  system: string,
  messages: LlmMessage[],
): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
    }
  }
  return out;
}

function toolsAsOpenAi(tools: LlmTool[]) {
  return tools.map(toOpenAiToolShape);
}

// ---------------------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------------------

async function callOpenAi(input: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  tools: ReadonlyArray<unknown>;
  temperature?: number;
}): Promise<OpenAiCompletionResult> {
  const { apiKey, model, messages, tools, temperature = 0.4 } = input;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature,
    }),
  });

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: OpenAiToolCall[];
      };
    }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    return {
      ok: false,
      error:
        json?.error?.message ?? `OpenAI request failed with status ${res.status}`,
    };
  }

  const choice = json.choices?.[0]?.message;
  return {
    ok: true,
    choice: {
      content: choice?.content ?? null,
      tool_calls: choice?.tool_calls,
    },
  };
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const openAiProvider: LlmProvider = {
  name: "openai",
  defaultModel: "gpt-4o-mini",

  async request({ apiKey, model, system, messages, tools, temperature }) {
    const result = await callOpenAi({
      apiKey,
      model,
      messages: toOpenAiMessages(system, messages),
      tools: toolsAsOpenAi(tools),
      temperature,
    });

    if (!result.ok) return { ok: false, error: result.error };

    const toolCalls: LlmToolCall[] = (result.choice?.tool_calls ?? []).map(
      (tc) => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(tc.function?.arguments ?? "{}") as Record<
            string,
            unknown
          >;
        } catch {
          parsed = {};
        }
        return {
          id: tc.id,
          name: tc.function?.name ?? "",
          arguments: parsed,
        };
      },
    );

    return { ok: true, content: result.choice?.content ?? null, toolCalls };
  },
};

// ---------------------------------------------------------------------------
// Backwards-compatible standalone function
// ---------------------------------------------------------------------------

/**
 * Direct Chat Completions wrapper (the function pre-existed in v1.0.0).
 * Internally calls the same HTTP layer as `openAiProvider`. Kept exported
 * for any consumer that wired against it directly.
 */
export async function requestOpenAiChatCompletion(options: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  tools?: ReadonlyArray<unknown>;
}): Promise<OpenAiCompletionResult> {
  const tools =
    options.tools ??
    (await import("./openaiTools.js")).BOOKING_AGENT_OPENAI_TOOLS;
  return callOpenAi({
    apiKey: options.apiKey,
    model: options.model,
    messages: options.messages,
    tools,
    temperature: options.temperature,
  });
}
