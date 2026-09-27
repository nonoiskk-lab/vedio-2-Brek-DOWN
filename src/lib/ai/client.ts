import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5";
const FALLBACKS_ENABLED = (process.env.AI_FALLBACKS ?? "default") !== "off";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 3 });
  return client;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AIError";
  }
}

/** Refusal fallbacks: on a policy decline the API re-runs the request on Anthropic's recommended model. */
function fallbackParams() {
  return FALLBACKS_ENABLED ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {};
}

export function describeAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AIError("The AI service rejected our API key. Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.RateLimitError)
    return new AIError("The AI service is rate-limiting us. Retrying shortly usually works.", true);
  if (err instanceof Anthropic.BadRequestError) return new AIError(`The AI request was invalid: ${err.message}`);
  if (err instanceof Anthropic.InternalServerError) return new AIError("The AI service had a temporary error.", true);
  if (err instanceof Anthropic.APIConnectionError) return new AIError("Couldn't connect to the AI service.", true);
  if (err instanceof Anthropic.APIError) return new AIError(`AI service error (${err.status}): ${err.message}`, (err.status ?? 0) >= 500);
  return new AIError(err instanceof Error ? err.message : String(err));
}

/**
 * Structured generation: streams (long outputs), constrains the response to the
 * JSON schema derived from `schema`, validates it, and retries once on a bad parse.
 */
export async function generateStructured<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const format = zodOutputFormat(opts.schema as never) as unknown as {
    type: "json_schema";
    schema: Record<string, unknown>;
    parse: (content: string) => z.infer<T>;
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = anthropic().beta.messages.stream({
        model: AI_MODEL,
        max_tokens: opts.maxTokens ?? 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort ?? "high", format: { type: "json_schema", schema: format.schema } },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: opts.prompt }],
        ...fallbackParams(),
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new AIError("The AI declined to process part of this content.");
      }
      if (message.stop_reason === "max_tokens") {
        throw new AIError("The AI response was cut off (output too long).", true);
      }
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return format.parse(text);
    } catch (err) {
      lastError = err;
      const e = describeAIError(err);
      // Parse/validation failures surface as plain AnthropicError: worth one retry.
      const isParseFailure = err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError);
      if (!(e.retryable || isParseFailure) || attempt === 1) throw e;
    }
  }
  throw describeAIError(lastError);
}

/** Streams plain text deltas (tutor chat, selection actions). */
export async function* streamText(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  effort?: Effort;
  maxTokens?: number;
}): AsyncGenerator<string> {
  const stream = anthropic().beta.messages.stream({
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium" },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: opts.messages,
    ...fallbackParams(),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "\n\n_(The AI declined to answer this request.)_";
  }
}

/** Run async work over items with bounded concurrency, stopping new work after a deadline. */
export async function mapWithConcurrency<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>, deadline?: number): Promise<O[]> {
  const results: O[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (deadline && Date.now() > deadline) return;
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
