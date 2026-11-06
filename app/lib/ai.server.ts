import { getModel } from "./models";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2026-10-21";

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
    const response = await fetch(ANTHROPIC_MODELS_URL, {
      headers: {
        "x-api-key": apiKey.trim(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    const body = await safeJson(response);
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

export async function generateStorefrontBlock(input: {
  apiKey: string;
  modelId: string;
  prompt: string;
  scopeClass: string;
  currentHtml?: string;
  currentCss?: string;
}) {
  const model = getModel(input.modelId);
  if (!model) {
    throw new Error("Unknown model.");
  }

  const system = [
    "You are an expert Shopify storefront designer and front-end developer.",
    "You build self-contained blocks that merchants place inside any Shopify theme.",
    "Use only HTML and CSS. Do not use Liquid, JavaScript, <script> tags, or external stylesheets.",
    `Every CSS selector must start with .${input.scopeClass} so the block never affects the rest of the theme.`,
    `Do not output the outer .${input.scopeClass} wrapper element; it is added for you.`,
    "The block is rendered inside a live Shopify storefront, so it must look at home in the merchant's theme.",
    "Inherit the theme's fonts with font-family: inherit, and keep the design responsive, accessible, and mobile friendly.",
    `Declare every color, font size, font weight, spacing and border radius once as a CSS custom property on .${input.scopeClass} (for example --heading-size, --button-bg) and use var(...) everywhere else, so the design is easy to adjust in one place.`,
    "Return exactly one code block: a <style> element first, followed by the HTML markup.",
  ].join(" ");

  const current = input.currentHtml?.trim()
    ? `\n\nCurrent block:\n<style>\n${input.currentCss ?? ""}\n</style>\n${input.currentHtml}`
    : "";
  const user = `${current ? "Edit this storefront block." : "Create a storefront block."}\n\nRequest:\n${input.prompt}${current}`;

  const raw =
    model.provider === "openai"
      ? await completeOpenAi(input.apiKey, model.id, system, user)
      : await completeAnthropic(input.apiKey, model.id, system, user);

  return extractCode(raw);
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
