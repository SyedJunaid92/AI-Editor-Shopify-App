import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  extractStreamingCode,
  formatElapsed,
  readGenerationStream,
  tailText,
  type GenerationBody,
} from "./generation-client";

export type GenerationHandlers = {
  onCode: (code: string) => void;
  onDone: (code: string) => void;
  onStop: (partial: string) => void;
  onError: (message: string, partial: string) => void;
};

const FLUSH_MS = 80;

export function useGeneration() {
  const shopify = useAppBridge();
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("Starting…");
  const [preview, setPreview] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const startedRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cancel = () => abortRef.current?.abort();

  const run = async (body: GenerationBody, handlers: GenerationHandlers) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = ++runIdRef.current;
    startedRef.current = Date.now();
    setGenerating(true);
    setStatus("Starting…");
    setPreview("");
    setElapsedMs(0);

    let raw = "";
    let thinking = "";
    let code = "";
    let sentCode = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const active = () => mountedRef.current && runIdRef.current === runId;

    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!active()) return;
      setPreview(tailText(code || raw || thinking));
      if (code.trim() && code !== sentCode) {
        sentCode = code;
        handlers.onCode(code);
      }
    };

    const schedule = () => {
      if (!active() || flushTimer) return;
      flushTimer = setTimeout(flush, FLUSH_MS);
    };

    try {
      const token = await shopify.idToken().catch(() => "");
      if (!active()) return;
      await readGenerationStream(body, token, controller.signal, {
        onStatus: (text) => {
          if (active()) setStatus(text);
        },
        onThinking: (text) => {
          if (!active()) return;
          thinking += text;
          if (!code) schedule();
        },
        onDelta: (text) => {
          if (!active()) return;
          raw += text;
          const next = extractStreamingCode(raw);
          if (next) code = next;
          schedule();
        },
        onDone: (finalCode) => {
          if (!active()) return;
          code = finalCode;
        },
      });
      if (!active()) return;
      flush();
      if (!code.trim()) {
        handlers.onError("The model returned an empty response.", "");
        return;
      }
      handlers.onDone(code);
    } catch (error) {
      if (!active()) return;
      flush();
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      if (aborted) handlers.onStop(code);
      else {
        handlers.onError(
          error instanceof Error ? error.message : "Generation failed.",
          code,
        );
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      if (active()) setGenerating(false);
    }
  };

  return {
    generating,
    status,
    preview,
    elapsedMs,
    elapsedLabel: formatElapsed(elapsedMs),
    run,
    cancel,
  };
}
