export type EditorGenerationBody = {
  kind: "editor";
  prompt: string;
  model: string;
  fileType: string;
  currentCode?: string;
  filename?: string;
  themeId?: string;
};

export type BlockGenerationBody = {
  kind: "block";
  prompt: string;
  model: string;
  scope: string;
  currentHtml?: string;
  currentCss?: string;
};

export type GenerationBody = EditorGenerationBody | BlockGenerationBody;

export type GenerationListener = {
  onStatus?: (text: string) => void;
  onThinking?: (text: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (code: string) => void;
};

type StreamEvent = {
  type?: string;
  text?: string;
  code?: string;
  message?: string;
  aborted?: boolean;
};

export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function tailText(text: string, lines = 14) {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return "";
  return trimmed.split("\n").slice(-lines).join("\n");
}

/** Code inside the opening fence. Empty until the model starts that fence. */
export function extractStreamingCode(text: string) {
  const open = /```(?:[\w.+-]*)?\n/.exec(text);
  if (!open) return "";
  const rest = text.slice(open.index + open[0].length);
  const close = rest.indexOf("```");
  return (close === -1 ? rest : rest.slice(0, close)).replace(/\s+$/, "");
}

export async function readGenerationStream(
  body: GenerationBody,
  token: string,
  signal: AbortSignal,
  listener: GenerationListener,
) {
  const response = await fetch("/app/generate", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new Error("Reload the app and try again.");
  }

  if (!response.ok || !response.body) {
    throw new Error(await errorMessage(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(await errorMessage(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let finalCode = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = parseEvent(data);
      if (event.type === "status" && event.text) listener.onStatus?.(event.text);
      if (event.type === "thinking" && event.text) listener.onThinking?.(event.text);
      if (event.type === "delta" && event.text) listener.onDelta?.(event.text);
      if (event.type === "done") {
        sawDone = true;
        finalCode = event.code ?? "";
        listener.onDone?.(finalCode);
      }
      if (event.type === "error") {
        const error = new Error(event.message || "Generation failed.");
        if (event.aborted) error.name = "AbortError";
        throw error;
      }
    }
  }

  if (!sawDone) {
    throw new Error(
      "The connection closed before the model finished. Try a faster model or a smaller change.",
    );
  }
  return finalCode;
}

async function errorMessage(response: Response) {
  const text = await response.text().catch(() => "");
  const parsed = parseEvent(text);
  if (parsed.message) return parsed.message;
  if (/<html/i.test(text)) return "Reload the app and try again.";
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 300);
  return `Generation failed (${response.status || "network"}).`;
}

function parseEvent(text: string): StreamEvent {
  try {
    return JSON.parse(text) as StreamEvent;
  } catch {
    return {};
  }
}
