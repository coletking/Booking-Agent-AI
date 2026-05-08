import { BOOKING_AGENT_OPENAI_TOOLS } from "./openaiTools.js";

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

export async function requestOpenAiChatCompletion(options: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  /**
   * Override the tool catalog sent to OpenAI. Defaults to the in-scope
   * marketplace tools. Pass a custom array (e.g. to add web_search) when
   * you want to expose extra capabilities for the turn.
   */
  tools?: ReadonlyArray<unknown>;
}): Promise<OpenAiCompletionResult> {
  const { apiKey, model, messages, temperature = 0.4 } = options;
  const tools = options.tools ?? BOOKING_AGENT_OPENAI_TOOLS;

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
