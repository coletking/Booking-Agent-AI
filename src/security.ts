import { randomBytes, timingSafeEqual } from "node:crypto";

import type { BookingAgentUserMessage } from "./runTurn.js";

// ---------------------------------------------------------------------------
// API key generation + verification
// ---------------------------------------------------------------------------

/**
 * Generate one or more cryptographically strong SDK API keys you can hand
 * to clients. Each key is 24 random bytes (192 bits) base64url-encoded
 * and prefixed for easy spotting in logs / leak scanners.
 */
export function generateSdkApiKeys(
  count = 1,
  options: { prefix?: string; bytes?: number } = {},
): string[] {
  const prefix = options.prefix ?? "bsk";
  const bytes = Math.max(16, options.bytes ?? 24);
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
    out.push(`${prefix}_${randomBytes(bytes).toString("base64url")}`);
  }
  return out;
}

/**
 * Constant-time check that `provided` matches one of `allowed`. Returns
 * false for empty inputs and never throws on length mismatches.
 */
export function verifySdkApiKey(
  provided: string | undefined,
  allowed: ReadonlyArray<string>,
): boolean {
  if (!provided || allowed.length === 0) return false;
  const a = Buffer.from(provided);
  for (const candidate of allowed) {
    if (!candidate) continue;
    const b = Buffer.from(candidate);
    if (a.length !== b.length) continue;
    try {
      if (timingSafeEqual(a, b)) return true;
    } catch {
      // length mismatch on platforms where the check throws; ignore
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Input validation: word count, SQL-injection, prompt-injection
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

const SQL_INJECTION_PATTERNS: RegExp[] = [
  /'\s*(or|and)\s+'?\d+'?\s*=\s*'?\d+/i,
  /;\s*(drop|delete|truncate|alter|create|insert|update)\s+(table|database|schema)\b/i,
  /\bunion\s+(all\s+)?select\b/i,
  /\b(select|update|delete|insert)\b[^;\n]*\bfrom\b[^;\n]*\b(information_schema|pg_catalog|mysql)\b/i,
  /\b(xp_cmdshell|sp_executesql|load_file|into\s+outfile)\b/i,
  /--\s*$/m,
  /\/\*[\s\S]*?\*\//,
  /\b0x[0-9a-f]{8,}\b/i,
];

export function detectSqlInjection(text: string): boolean {
  if (!text) return false;
  return SQL_INJECTION_PATTERNS.some((re) => re.test(text));
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)\b/i,
  /\bdisregard\s+(the|all|previous)\s+(system|instructions|rules)\b/i,
  /\byou\s+are\s+now\s+(a\s+)?(different|new|unrestricted)/i,
  /\bact\s+as\s+(an?\s+)?(developer|admin|root|jailbroken|dan)\b/i,
  /\b(reveal|print|show)\s+(your\s+)?(system\s+prompt|hidden\s+instructions)\b/i,
];

export function detectPromptInjection(text: string): boolean {
  if (!text) return false;
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(text));
}

/**
 * Strip null bytes and ASCII control characters that can break JSON
 * payloads or hide content in terminals. Keeps tabs, CR, and LF.
 */
export function stripControlChars(text: string): string {
  if (!text) return text;
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export type RateLimitDecision = {
  allowed: boolean;
  /** Number of requests still available in the current window. */
  remaining: number;
  /** Milliseconds until the window resets (when allowed === false). */
  retryAfterMs: number;
};

export interface RateLimitStore {
  consume(
    identifier: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision>;
}

/**
 * Sliding-window in-memory rate limiter. Suitable for single-process
 * deployments and tests. For multi-instance services back this with
 * Redis or your DB.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  async consume(
    identifier: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const existing = this.hits.get(identifier) ?? [];
    const recent = existing.filter((t) => t > cutoff);

    if (recent.length >= max) {
      const oldest = recent[0]!;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, oldest + windowMs - now),
      };
    }

    recent.push(now);
    this.hits.set(identifier, recent);
    return {
      allowed: true,
      remaining: Math.max(0, max - recent.length),
      retryAfterMs: 0,
    };
  }
}

export type RateLimitOptions = {
  /** Maximum allowed requests in the rolling window. */
  maxRequests: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Custom store. Defaults to a per-process in-memory store. */
  store?: RateLimitStore;
};

// ---------------------------------------------------------------------------
// Aggregate options + orchestrator
// ---------------------------------------------------------------------------

export type SecurityErrorCode =
  | "INVALID_API_KEY"
  | "MESSAGE_TOO_LONG"
  | "BLOCKED_INPUT"
  | "RATE_LIMITED";

export type SecurityOptions = {
  /**
   * Allowlist of accepted SDK keys. When set, callers MUST pass a key
   * that matches one of these (timing-safe compare).
   */
  apiKeys?: ReadonlyArray<string>;
  /** Hard cap on words per individual user/assistant message. Default 1000. */
  maxWordsPerMessage?: number;
  /** Toggle SQL-injection heuristic. Default true. */
  blockSqlInjection?: boolean;
  /** Toggle prompt-injection heuristic. Default true. */
  blockPromptInjection?: boolean;
  /** Strip ASCII control characters from inputs. Default true. */
  stripControlChars?: boolean;
  /** Optional rate limiter (per identifier you pass in). */
  rateLimit?: RateLimitOptions;
};

export type SecurityCheckResult =
  | { ok: true; sanitizedMessages: BookingAgentUserMessage[] }
  | {
      ok: false;
      code: SecurityErrorCode;
      reason: string;
      retryAfterMs?: number;
    };

const SHARED_RATE_LIMITER = new InMemoryRateLimitStore();

/**
 * Run all configured security checks. Pure: never mutates inputs and
 * returns either a sanitized message list or a typed failure.
 */
export async function runSecurityChecks(args: {
  messages: BookingAgentUserMessage[];
  options: SecurityOptions;
  /** Key supplied by the caller for this turn (compared against options.apiKeys). */
  providedApiKey?: string;
  /** Identifier used for rate limiting (e.g. apiKey hash, sessionId, userId). */
  rateLimitKey?: string;
}): Promise<SecurityCheckResult> {
  const { messages, options } = args;
  const maxWords = Math.max(1, options.maxWordsPerMessage ?? 1000);
  const blockSql = options.blockSqlInjection !== false;
  const blockPrompt = options.blockPromptInjection !== false;
  const cleanCtrl = options.stripControlChars !== false;

  if (options.apiKeys && options.apiKeys.length > 0) {
    if (!verifySdkApiKey(args.providedApiKey, options.apiKeys)) {
      return {
        ok: false,
        code: "INVALID_API_KEY",
        reason: "Missing or invalid SDK API key.",
      };
    }
  }

  if (options.rateLimit) {
    const store = options.rateLimit.store ?? SHARED_RATE_LIMITER;
    const id = args.rateLimitKey || args.providedApiKey || "anonymous";
    const decision = await store.consume(
      id,
      Math.max(1, options.rateLimit.maxRequests),
      Math.max(100, options.rateLimit.windowMs),
    );
    if (!decision.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        reason: "Rate limit exceeded for this identifier.",
        retryAfterMs: decision.retryAfterMs,
      };
    }
  }

  const sanitized: BookingAgentUserMessage[] = [];
  for (const m of messages) {
    const original = typeof m.content === "string" ? m.content : "";
    const content = cleanCtrl ? stripControlChars(original) : original;

    if (countWords(content) > maxWords) {
      return {
        ok: false,
        code: "MESSAGE_TOO_LONG",
        reason: `Message exceeds the ${maxWords}-word limit.`,
      };
    }

    if (m.role === "user") {
      if (blockSql && detectSqlInjection(content)) {
        return {
          ok: false,
          code: "BLOCKED_INPUT",
          reason: "Input matched a SQL-injection pattern.",
        };
      }
      if (blockPrompt && detectPromptInjection(content)) {
        return {
          ok: false,
          code: "BLOCKED_INPUT",
          reason: "Input matched a prompt-injection pattern.",
        };
      }
    }

    sanitized.push({ role: m.role, content });
  }

  return { ok: true, sanitizedMessages: sanitized };
}
