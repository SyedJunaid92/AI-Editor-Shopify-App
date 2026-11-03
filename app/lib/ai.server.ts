import { getModel, type FileTypeId } from "./models";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type KeyValidationResult = {
  openai: { valid: boolean; error?: string };
  anthropic: { valid: boolean; error?: string };
};

export async function validateProviderKeys(input: {
  openaiKey: string;
  anthropicKey: string;
}): Promise<KeyValidationResult> {
  const [openai, anthropic] = await Promise.all([
    validateOpenAiKey(input.openaiKey),
    validateAnthropicKey(input.anthropicKey),
  ]);

  return { openai, anthropic };
}

export async function validateOpenAiKey(apiKey: string) {
  if (!apiKey.trim()) {
    return { valid: false, error: "OpenAI API key is required." };
  }

  try {
    const response = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!response.ok) {
      const body = await safeJson(response);
      return {
        valid: false,
        error: openaiError(body) || `OpenAI rejected the key (${response.status}).`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Could not reach OpenAI to validate the key." };
  }
}

export async function validateAnthropicKey(apiKey: string) {
  if (!apiKey.trim()) {
    return { valid: false, error: "Anthropic API key is required." };
  }

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    if (response.ok || response.status === 400) {
      return { valid: true };
    }

    const body = await safeJson(response);
    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: anthropicError(body) || "Anthropic rejected the key.",
      };
    }

    if (response.status === 404) {
      return { valid: true };
    }

    return {
      valid: false,
      error: anthropicError(body) || `Anthropic rejected the key (${response.status}).`,
    };
  } catch {
    return {
      valid: false,
      error: "Could not reach Anthropic to validate the key.",
    };
  }
}

export async function generateShopifyCode(input: {
  apiKey: string;
  modelId: string;
  prompt: string;
  currentCode?: string;
  fileType: FileTypeId;
  filename?: string;
}) {
  const model = getModel(input.modelId);
  if (!model) {
    throw new Error("Unknown model.");
  }

  const system = buildSystemPrompt(input.fileType, input.filename);
  const user = buildUserPrompt(input.prompt, input.currentCode, input.fileType);

  const raw =
    model.provider === "openai"
      ? await completeOpenAi(input.apiKey, model.id, system, user)
      : await completeAnthropic(input.apiKey, model.id, system, user);

  return extractCode(raw);
}

function buildSystemPrompt(fileType: FileTypeId, filename?: string) {
  return [
    "You are an expert Shopify theme and app developer.",
    "Write production-ready Shopify code that follows Online Store 2.0 conventions.",
    "Prefer Liquid, JSON templates/sections, and Shopify best practices.",
    "Do not invent Admin API scopes or objects that do not exist.",
    `Target file type: ${fileType}.`,
    filename ? `Target filename: ${filename}.` : "",
    "Return only the code. Do not wrap it in markdown unless the file type requires it.",
    "If editing existing code, keep merchant customizations unless the prompt asks to replace them.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildUserPrompt(
  prompt: string,
  currentCode: string | undefined,
  fileType: FileTypeId,
) {
  if (currentCode?.trim()) {
    return `Edit this Shopify ${fileType} code.\n\nRequest:\n${prompt}\n\nCurrent code:\n${currentCode}`;
  }
  return `Create Shopify ${fileType} code.\n\nRequest:\n${prompt}`;
}

function openAiSupportsCustomTemperature(model: string) {
  const id = model.toLowerCase();
  return !/^(gpt-5|o\d)/.test(id);
}

async function completeOpenAi(
  apiKey: string,
  model: string,
  system: string,
  user: string,
) {
  const response = await postOpenAi(apiKey, model, system, user, true);
  const body = await safeJson(response);
  if (response.ok) {
    return openAiText(body);
  }

  const message = openaiError(body) || `OpenAI request failed (${response.status}).`;
  if (!/temperature/i.test(message)) {
    throw new Error(message);
  }

  const retry = await postOpenAi(apiKey, model, system, user, false);
  const retryBody = await safeJson(retry);
  if (!retry.ok) {
    throw new Error(
      openaiError(retryBody) || `OpenAI request failed (${retry.status}).`,
    );
  }
  return openAiText(retryBody);
}

async function postOpenAi(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  withTemperature: boolean,
) {
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (withTemperature && openAiSupportsCustomTemperature(model)) {
    payload.temperature = 0.2;
  }

  return fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function openAiText(body: any) {
  const text = body?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }
  return String(text);
}

async function completeAnthropic(
  apiKey: string,
  model: string,
  system: string,
  user: string,
) {
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(
      anthropicError(body) || `Anthropic request failed (${response.status}).`,
    );
  }

  const text = Array.isArray(body?.content)
    ? body.content
        .map((part: { text?: string }) => part.text || "")
        .join("\n")
        .trim()
    : "";

  if (!text) {
    throw new Error("Claude returned an empty response.");
  }
  return text;
}

function extractCode(text: string) {
  const match = text.match(/```(?:[\w.+-]+)?\n([\s\S]*?)```/);
  return (match ? match[1] : text).replace(/\s+$/, "");
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function openaiError(body: any) {
  return body?.error?.message as string | undefined;
}

function anthropicError(body: any) {
  return (body?.error?.message || body?.error?.type) as string | undefined;
}
