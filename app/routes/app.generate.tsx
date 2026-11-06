import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requirePaidPlan } from "../lib/billing.server";
import { resolveModelApiKey } from "../lib/credentials.server";
import {
  extractCode,
  streamShopifyCode,
  streamStorefrontBlock,
} from "../lib/ai.server";
import { isValidBlockScope } from "../lib/app-blocks";
import { FILE_TYPES, type FileTypeId } from "../lib/models";
import { loadThemeContext } from "../lib/theme.server";

const GENERATION_LIMIT_MS = 12 * 60 * 1000;

const FILE_TYPE_IDS = new Set<string>(FILE_TYPES.map((item) => item.id));

export const config = {
  maxDuration: 300,
};

export function loader(_args: LoaderFunctionArgs) {
  return Response.json({ message: "Use POST to generate." }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "The generation request could not be read." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return Response.json({ message: "The generation request could not be read." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const clientGone = new AbortController();
  const limit = AbortSignal.timeout(GENERATION_LIMIT_MS);
  const signal = AbortSignal.any([request.signal, clientGone.signal, limit]);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* The client already disconnected. */
        }
      };

      const heartbeat = setInterval(() => send({ type: "ping" }), 2000);
      let writing = false;
      let thinking = false;

      try {
        controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));
        send({ type: "status", text: "Starting…" });
        const { admin, session, billingState } = await requirePaidPlan(request);
        const record = payload as Record<string, unknown>;
        const kind = record.kind === "block" ? "block" : record.kind === "editor" ? "editor" : "";
        const prompt = stringField(record.prompt).trim();
        const modelId = stringField(record.model);
        if (!kind) throw new Error("Unknown generation request.");
        if (!prompt) throw new Error("Describe what you want to generate.");

        const resolved = await resolveModelApiKey({
          shop: session.shop,
          plan: billingState.plan!,
          modelId,
        });
        if (!("apiKey" in resolved) || !resolved.apiKey) {
          throw new Error("error" in resolved ? resolved.error : "Missing API key.");
        }

        const handlers = {
          signal,
          onThinking: (text: string) => {
            if (!thinking) {
              thinking = true;
              send({ type: "status", text: "Thinking…" });
            }
            send({ type: "thinking", text });
          },
          onDelta: (text: string) => {
            if (!writing) {
              writing = true;
              send({ type: "status", text: "Writing…" });
            }
            send({ type: "delta", text });
          },
        };

        let raw = "";
        if (kind === "block") {
          const scope = stringField(record.scope);
          if (!isValidBlockScope(scope)) {
            throw new Error("This block is missing its style scope. Reload the page.");
          }
          send({ type: "status", text: "Thinking…" });
          raw = await streamStorefrontBlock({
            apiKey: resolved.apiKey,
            modelId,
            prompt,
            scopeClass: scope,
            currentHtml: stringField(record.currentHtml),
            currentCss: stringField(record.currentCss),
            ...handlers,
          });
        } else {
          const fileType = stringField(record.fileType || "liquid");
          if (!FILE_TYPE_IDS.has(fileType)) throw new Error("Unknown file type.");
          const themeId = stringField(record.themeId);
          send({ type: "status", text: themeId ? "Reading your theme…" : "Thinking…" });
          const themeContext = themeId
            ? await loadThemeContext(admin, themeId).catch(() => null)
            : null;
          if (!writing && !thinking) send({ type: "status", text: "Thinking…" });
          raw = await streamShopifyCode({
            apiKey: resolved.apiKey,
            modelId,
            prompt,
            currentCode: stringField(record.currentCode),
            fileType: fileType as FileTypeId,
            filename: stringField(record.filename),
            themeContext,
            ...handlers,
          });
        }

        send({ type: "done", code: extractCode(raw) });
      } catch (error) {
        if (request.signal.aborted || clientGone.signal.aborted) return;
        send({
          type: "error",
          message: failureMessage(error, limit.aborted),
        });
      } finally {
        clearInterval(heartbeat);
        close();
      }
    },
    cancel() {
      clientGone.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function failureMessage(error: unknown, timedOut: boolean) {
  if (timedOut) {
    return "This generation ran for 12 minutes and was stopped. Try a shorter request or a faster model.";
  }
  if (error instanceof Response) {
    const location = error.headers.get("Location") || "";
    if (location.includes("billing")) return "Choose a plan before generating.";
    return "Reload the app and try again.";
  }
  if (error instanceof Error && error.name !== "AbortError") return error.message;
  if (error instanceof Error) return "Generation stopped.";
  return "Generation failed.";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
