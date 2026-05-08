import type {
  LlmCompletionResult,
  LlmMessage,
  LlmProvider,
  LlmTool,
  LlmToolCall,
} from "./llm.js";
import { toAnthropicToolShape } from "./openaiTools.js";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicResponse = {
  id?: string;
  role?: "assistant";
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  error?: { message?: string; type?: string };
};

// ---------------------------------------------------------------------------
// Serialization: normalized LlmMessage[] -> Anthropic wire format
//
// Key Anthropic quirks vs OpenAI:
// - System prompt is a separate top-level field, not a message.
// - Tool results live inside a "user" message as `tool_result` blocks.
// - Multiple tool results in the same round must share a single user
//   message; we group them here.
// ---------------------------------------------------------------------------

function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicToolResultBlock[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    out.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const m of messages) {
    if (m.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }

    flushToolResults();

    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else {
      const blocks: AnthropicContentBlock[] = [];
      const text = m.content?.trim();
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      // Anthropic rejects assistant messages with empty content arrays.
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      out.push({ role: "assistant", content: blocks });
    }
  }

  flushToolResults();
  return out;
}

function toolsAsAnthropic(tools: LlmTool[]) {
  return tools.map(toAnthropicToolShape);
}

// ---------------------------------------------------------------------------
// HTTP call + provider implementation
// ---------------------------------------------------------------------------

async function callAnthropic(input: {
  apiKey: string;
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: ReadonlyArray<unknown>;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ ok: true; data: AnthropicResponse } | { ok: false; error: string }> {
  const {
    apiKey,
    model,
    system,
    messages,
    tools,
    temperature = 0.4,
    maxTokens = 1024,
  } = input;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system,
      messages,
      tools,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const json = (await res.json()) as AnthropicResponse;

  if (!res.ok) {
    return {
      ok: false,
      error:
        json?.error?.message ??
        `Anthropic request failed with status ${res.status}`,
    };
  }
  return { ok: true, data: json };
}

export const anthropicProvider: LlmProvider = {
  name: "anthropic",
  defaultModel: "claude-3-5-sonnet-20241022",

  async request({
    apiKey,
    model,
    system,
    messages,
    tools,
    temperature,
  }): Promise<LlmCompletionResult> {
    const result = await callAnthropic({
      apiKey,
      model,
      system,
      messages: toAnthropicMessages(messages),
      tools: toolsAsAnthropic(tools),
      temperature,
    });

    if (!result.ok) return { ok: false, error: result.error };

    const blocks = result.data.content ?? [];
    const textParts: string[] = [];
    const toolCalls: LlmToolCall[] = [];

    for (const b of blocks) {
      if (b.type === "text") {
        textParts.push(b.text);
      } else if (b.type === "tool_use") {
        toolCalls.push({
          id: b.id,
          name: b.name,
          arguments:
            (b.input && typeof b.input === "object"
              ? (b.input as Record<string, unknown>)
              : {}),
        });
      }
    }

    return {
      ok: true,
      content: textParts.length > 0 ? textParts.join("\n").trim() : null,
      toolCalls,
    };
  },
};
