import type { BookingAgentUserMessage } from "./runTurn.js";

export type ChatLimitOptions = {
  /** Max user messages allowed per session before the support fallback kicks in. Default: 4. */
  maxTurns?: number;
  /**
   * WhatsApp number in E.164 (digits only, no `+`). When present, the
   * default support message includes a `https://wa.me/<number>` link.
   */
  whatsappNumber?: string;
  /** Pre-filled message used in the WhatsApp deep link. */
  whatsappMessage?: string;
  /**
   * Override the entire support message. Receives `{ link }` so you can
   * embed the WhatsApp URL however you like. Returning a plain string
   * disables the default template.
   */
  buildMessage?: (info: { link: string | null }) => string;
};

const DEFAULT_MAX_TURNS = 4;

export function countUserTurns(messages: BookingAgentUserMessage[]): number {
  let n = 0;
  for (const m of messages) if (m.role === "user") n += 1;
  return n;
}

export function buildWhatsAppLink(
  number: string | undefined,
  prefilled: string | undefined,
): string | null {
  if (!number) return null;
  const digits = number.replace(/\D+/g, "");
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return prefilled ? `${base}?text=${encodeURIComponent(prefilled)}` : base;
}

export function buildChatLimitMessage(options: ChatLimitOptions): string {
  const link = buildWhatsAppLink(
    options.whatsappNumber,
    options.whatsappMessage,
  );

  if (typeof options.buildMessage === "function") {
    return options.buildMessage({ link }).trim();
  }

  const limit = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const tail = link
    ? `Please continue the conversation with our support team on WhatsApp: ${link}`
    : "Please contact our support team for further help.";
  return `You've reached the limit of ${limit} messages in this chat. ${tail}`;
}

/**
 * Returns the support reply when `priorHistory + incoming` exceeds the
 * configured turn limit. Returns null when the limit is disabled or
 * not yet reached.
 */
export function checkChatLimit(args: {
  priorHistory: BookingAgentUserMessage[];
  incoming: BookingAgentUserMessage[];
  options?: ChatLimitOptions;
}): { reply: string; maxTurns: number } | null {
  if (!args.options) return null;
  const maxTurns = Math.max(1, args.options.maxTurns ?? DEFAULT_MAX_TURNS);
  const totalUserTurns =
    countUserTurns(args.priorHistory) + countUserTurns(args.incoming);
  if (totalUserTurns <= maxTurns) return null;
  return { reply: buildChatLimitMessage(args.options), maxTurns };
}
