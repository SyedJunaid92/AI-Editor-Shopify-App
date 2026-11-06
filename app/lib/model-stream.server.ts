import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { ModelProvider } from "./models";

export const ANTHROPIC_VERSION = "2026-10-21";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type ChatStreamHandlers = {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onThinking?: (text: string) => void;
};

type ChatRequest = {
  provider: ModelProvider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
} & ChatStreamHandlers;

export async function streamChat(input: ChatRequest) {
  const signal = input.signal ?? AbortSignal.timeout(12 * 60 * 1000);
  try {
    const text =
      input.provider === "openai"
        ? await streamOpenAi(input, signal)
        : await streamAnthropic(input, signal);

    if (!text.trim()) {
      throw new Error(
        input.provider === "openai"
          ? "OpenAI returned an empty response."
          : "Claude returned an empty response.",
      );
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (
      error instanceof Error &&
      /ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|ENOTFOUND/i.test(error.message)
    ) {
      throw new Error("The model connection closed early. Try again.");
    }
    throw error;
  }
}

async function streamOpenAi(input: ChatRequest, signal: AbortSignal) {
  const first = await openAiOnce(input, signal, true);
  if (first.ok) return first.text;
  if (!/temperature/i.test(first.message)) {
    throw new Error(first.message || `OpenAI request failed (${first.status}).`);
  }

  const retry = await openAiOnce(input, signal, false);
  if (!retry.ok) {
    throw new Error(retry.message || `OpenAI request failed (${retry.status}).`);
  }
  return retry.text;
}

async function openAiOnce(input: ChatRequest, signal: AbortSignal, withTemperature: boolean) {
  const payload: Record<string, unknown> = {
    model: input.model,
    stream: true,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
  };
  if (withTemperature && openAiSupportsCustomTemperature(input.model)) {
    payload.temperature = 0.2;
  }

  const response = await postJson(
    OPENAI_CHAT_URL,
    { Authorization: `Bearer ${input.apiKey}` },
    payload,
    signal,
  );

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      message: await readError(response.stream),
    };
  }

  const text = await readModelStream(response.stream, signal, input, "openai");
  return { ok: true as const, text };
}

async function streamAnthropic(input: ChatRequest, signal: AbortSignal) {
  const response = await postJson(
    ANTHROPIC_MESSAGES_URL,
    {
      "x-api-key": input.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    {
      model: input.model,
      max_tokens: 8192,
      stream: true,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    },
    signal,
  );

  if (!response.ok) {
    throw new Error(
      (await readError(response.stream)) || `Anthropic request failed (${response.status}).`,
    );
  }

  return readModelStream(response.stream, signal, input, "anthropic");
}

function openAiSupportsCustomTemperature(model: string) {
  return !/^(gpt-5|o\d)/i.test(model);
}

function openAiDelta(delta: any) {
  let text = "";
  let thinking = "";
  if (!delta) return { text, thinking };
  if (typeof delta.content === "string") text += delta.content;
  if (Array.isArray(delta.content)) {
    for (const part of delta.content) {
      if (typeof part === "string") {
        text += part;
      } else if (
        part?.type === "reasoning_text" ||
        part?.type === "reasoning" ||
        part?.type === "thinking"
      ) {
        thinking += part.text || part.reasoning || "";
      } else if (part?.text) {
        text += part.text;
      }
    }
  }
  if (typeof delta.reasoning_content === "string") thinking += delta.reasoning_content;
  if (typeof delta.reasoning === "string") thinking += delta.reasoning;
  return { text, thinking };
}

function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  signal: AbortSignal,
) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const target = new URL(url);

  return new Promise<{ ok: boolean; status: number; stream: IncomingMessage }>(
    (resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }

      let settled = false;
      const finish = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const req = https.request(
        {
          hostname: target.hostname,
          path: `${target.pathname}${target.search}`,
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            accept: "text/event-stream, application/json",
            "content-length": String(body.byteLength),
          },
        },
        (stream) => {
          if (settled) {
            stream.destroy();
            return;
          }
          settled = true;
          resolve({
            ok: (stream.statusCode ?? 0) >= 200 && (stream.statusCode ?? 0) < 300,
            status: stream.statusCode ?? 0,
            stream,
          });
        },
      );

      const onAbort = () => {
        req.destroy();
        finish(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("error", (error) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) finish(abortError());
        else finish(error);
      });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
      req.end(body);
    },
  );
}

async function readModelStream(
  stream: IncomingMessage,
  signal: AbortSignal,
  handlers: ChatStreamHandlers,
  provider: "openai" | "anthropic",
) {
  const decoder = new TextDecoder();
  let pending = "";
  let mode: "unknown" | "sse" | "json" = "unknown";
  let json = "";
  let text = "";
  const onAbort = () => stream.destroy();
  signal.addEventListener("abort", onAbort, { once: true });

  const takeSse = (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data:")) {
        text += applyModelEvent(provider, line.slice(5).trimStart(), handlers);
      }
    }
  };

  try {
    for await (const chunk of stream) {
      if (signal.aborted) break;
      const piece =
        typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
      if (mode === "unknown") {
        const started = (pending + piece).trimStart();
        if (!started) {
          pending += piece;
          continue;
        }
        mode = started.startsWith("{") || started.startsWith("[") ? "json" : "sse";
        const buffered = pending + piece;
        pending = "";
        if (mode === "json") json = buffered;
        else takeSse(buffered);
        continue;
      }
      if (mode === "json") json += piece;
      else takeSse(piece);
    }
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  if (mode === "sse" && pending.trim()) {
    takeSse("\n");
  }

  if (mode === "json") {
    const parsed = parseJson(json);
    const message = openAiError(parsed) || anthropicError(parsed);
    if (message && !openAiMessageText(parsed) && !anthropicMessageText(parsed)) {
      throw new Error(message);
    }
    const whole = openAiMessageText(parsed) || anthropicMessageText(parsed);
    if (whole) {
      text += whole;
      handlers.onDelta?.(whole);
    }
  }
  return text;
}

function applyModelEvent(
  provider: "openai" | "anthropic",
  data: string,
  handlers: ChatStreamHandlers,
) {
  if (!data || data === "[DONE]") return "";
  const parsed = parseJson(data);
  if (provider === "openai") {
    const message = openAiError(parsed);
    if (message) throw new Error(message);
    const piece = openAiDelta(parsed?.choices?.[0]?.delta);
    if (piece.thinking) handlers.onThinking?.(piece.thinking);
    if (piece.text) handlers.onDelta?.(piece.text);
    return piece.text;
  }

  if (parsed?.type === "error") {
    throw new Error(anthropicError(parsed) || "Anthropic request failed.");
  }
  if (parsed?.type !== "content_block_delta") return "";
  if (parsed.delta?.type === "thinking_delta" && parsed.delta.thinking) {
    handlers.onThinking?.(String(parsed.delta.thinking));
  }
  if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
    const text = String(parsed.delta.text);
    handlers.onDelta?.(text);
    return text;
  }
  return "";
}

function openAiMessageText(body: any) {
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function anthropicMessageText(body: any) {
  if (!Array.isArray(body?.content)) return "";
  return body.content
    .map((part: { text?: string }) => part.text || "")
    .join("")
    .trim();
}

async function readError(stream: IncomingMessage) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  const parsed = parseJson(text);
  return openAiError(parsed) || anthropicError(parsed) || text.trim() || "Request failed.";
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function openAiError(body: any) {
  return body?.error?.message as string | undefined;
}

function anthropicError(body: any) {
  return (body?.error?.message || body?.error?.type) as string | undefined;
}

function abortError() {
  const error = new Error("Generation stopped.");
  error.name = "AbortError";
  return error;
}
