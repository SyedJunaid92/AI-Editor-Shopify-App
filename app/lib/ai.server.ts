import { getModel, type FileTypeId } from "./models";
import type { ThemeContext } from "./theme.server";

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

export async function generateShopifyCode(input: {
  apiKey: string;
  modelId: string;
  prompt: string;
  currentCode?: string;
  fileType: FileTypeId;
  filename?: string;
  themeContext?: ThemeContext | null;
}) {
  const model = getModel(input.modelId);
  if (!model) {
    throw new Error("Unknown model.");
  }

  const system = buildSystemPrompt(input.fileType, input.filename, input.themeContext);
  const user = buildUserPrompt(input.prompt, input.currentCode, input.fileType, input.filename);

  const raw =
    model.provider === "openai"
      ? await completeOpenAi(input.apiKey, model.id, system, user)
      : await completeAnthropic(input.apiKey, model.id, system, user);

  return extractCode(raw);
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

type ThemeFileKind =
  | "section"
  | "theme-block"
  | "snippet"
  | "layout"
  | "template-json"
  | "section-group"
  | "settings-schema"
  | "locale"
  | "asset"
  | "other";

function themeFileKind(filename = "", fileType: FileTypeId): ThemeFileKind {
  if (filename.startsWith("sections/") && filename.endsWith(".json")) return "section-group";
  if (filename.startsWith("sections/")) return "section";
  if (filename.startsWith("blocks/")) return "theme-block";
  if (filename.startsWith("snippets/")) return "snippet";
  if (filename.startsWith("layout/")) return "layout";
  if (filename.startsWith("templates/") && filename.endsWith(".json")) return "template-json";
  if (filename === "config/settings_schema.json") return "settings-schema";
  if (filename.startsWith("locales/")) return "locale";
  if (filename.startsWith("assets/")) return "asset";
  if (!filename && fileType === "liquid") return "section";
  return "other";
}

const DYNAMIC_SETTINGS_RULES = [
  "MAKE EVERYTHING MERCHANT-EDITABLE. Nothing a merchant could want to change may be hardcoded:",
  "- Every visible text (headings, paragraphs, button labels, badges, captions) comes from a setting: `text`/`inline_richtext` for short text, `richtext` for paragraphs, `textarea` for plain multi-line text.",
  "- Every color (text, background, button, border, overlay) comes from a `color` setting, or from a `color_scheme` setting when the theme uses color schemes (see theme context).",
  "- Every font size, spacing (padding, margin, gap), border radius, width, height, columns count, and overlay opacity comes from a `range` setting with a sensible unit, for example `\"unit\": \"px\"`.",
  "- Fonts come from `font_picker` settings (rendered with the `font_face` filter and `font.family`/`font.fallback_families`), or inherit the theme's fonts.",
  "- Every image uses `image_picker`, every link uses `url`, videos use `video` or `video_url`, alignment and layout options use `select` or `text_alignment`, show/hide toggles use `checkbox`.",
  "- Repeatable items (slides, cards, columns, FAQ rows, logos, testimonials) are `blocks` with their own settings, not hardcoded lists. Set `max_blocks` where it makes sense.",
  "- Wire settings into CSS through CSS custom properties set from Liquid, e.g. `style=\"--heading-size: {{ section.settings.heading_size }}px;\"`, then use `var(--heading-size)` in the stylesheet.",
  "- Give every setting a clear `label`, a helpful `info` where useful, and a `default` that renders a good-looking result straight away. Group related settings with `header` settings.",
  "- Guard optional content with `!= blank` checks so empty settings render nothing, and show `placeholder_svg_tag` when an image is not chosen.",
].join("\n");

const SCHEMA_VALIDITY_RULES = [
  "The {% schema %} must be valid JSON that Shopify accepts:",
  "- Setting ids are unique, lowercase snake_case, and match every `section.settings.*` / `block.settings.*` reference.",
  "- `range`: `min`, `max`, `step` and `default` are numbers; `default` is between `min` and `max` and lands on a step; (max - min) / step is at most 100.",
  "- `richtext` defaults are wrapped in `<p>` tags. `select` defaults match one of its option values. `color` defaults are hex values. `url` defaults may only be `/collections` or `/collections/all`.",
  "- `image_picker` and `video` settings have no `default`. `font_picker` settings must have a `default` such as `assistant_n4`.",
  "- The schema `name` and every preset `name` are 25 characters or fewer.",
  "- Include `presets` with a `name` (and default blocks) so the merchant can add it from the theme editor.",
].join("\n");

function fileKindRules(kind: ThemeFileKind, context?: ThemeContext | null) {
  switch (kind) {
    case "section":
      return [
        "This is an Online Store 2.0 section file (sections/*.liquid).",
        "Structure: a <style> block (Liquid is not processed inside {% stylesheet %}, so use <style> whenever CSS needs `section.id` or settings), then the markup, then a single {% schema %} block at the end.",
        "Scope all CSS to this section instance with `#shopify-section-{{ section.id }}` or a class that includes `{{ section.id }}`, so two copies of the section never conflict and nothing leaks into the rest of the theme.",
        "Read settings with `section.settings.*`; loop blocks with `{% for block in section.blocks %}` and put `{{ block.shopify_attributes }}` on each block's root element.",
        context?.blocks.length
          ? "The theme supports theme blocks; you may accept them with `{ \"type\": \"@theme\" }` and render them with `{% content_for 'blocks' %}` when the request suits it."
          : "",
        DYNAMIC_SETTINGS_RULES,
        SCHEMA_VALIDITY_RULES,
      ];
    case "theme-block":
      return [
        "This is a theme block file (blocks/*.liquid).",
        "Read settings with `block.settings.*`, put `{{ block.shopify_attributes }}` on the root element, and end with one {% schema %} block that has `name`, `settings` and `presets`.",
        "Scope CSS with a class that includes `{{ block.id }}`.",
        DYNAMIC_SETTINGS_RULES,
        SCHEMA_VALIDITY_RULES,
      ];
    case "snippet":
      return [
        "This is a snippet (snippets/*.liquid). Snippets have no {% schema %}.",
        "Accept every text, color, size and option as a render parameter with a sensible fallback (`| default:`), so the calling section can pass its own settings in. Document the parameters in a {% doc %} block at the top.",
        "Never hardcode copy, colors or sizes inside the snippet.",
      ];
    case "layout":
      return [
        "This is a layout file. Keep `{{ content_for_header }}` and `{{ content_for_layout }}` in place, and keep existing section groups, scripts and stylesheets.",
        "Use global theme settings (`settings.*`) instead of hardcoded colors and fonts.",
      ];
    case "template-json":
      return [
        "This is a JSON template. Output valid JSON only, with `sections` and `order`.",
        "Only reference section types that exist in the theme (see theme context), and fill in their `settings` and `blocks` with real values from the request.",
      ];
    case "section-group":
      return [
        "This is a section group JSON file (header/footer group). Output valid JSON only with `type`, `name`, `sections` and `order`, referencing only existing section types.",
      ];
    case "settings-schema":
      return [
        "This is config/settings_schema.json. Output valid JSON only. Keep the `theme_info` entry and every existing setting id, because removing ids breaks saved merchant settings.",
      ];
    case "locale":
      return ["This is a locale file. Output valid JSON only and keep every existing key."];
    case "asset":
      return [
        "This is a theme asset. Do not hardcode colors, font sizes or copy; use CSS custom properties (`var(--...)`) that sections set from their settings, with sensible fallbacks.",
        "JavaScript must be plain browser JavaScript with no build step, scoped to its section elements, and safe to run when the theme editor reloads sections (listen for `shopify:section:load`).",
      ];
    default:
      return [DYNAMIC_SETTINGS_RULES];
  }
}

function themeContextLines(context?: ThemeContext | null) {
  if (!context) return [];
  const themeLabel = [context.themeName, context.themeVersion && `v${context.themeVersion}`]
    .filter(Boolean)
    .join(" ");
  const lines = [
    "THEME CONTEXT (match this theme's conventions):",
    `- Store theme: "${context.name}" (${context.role.toLowerCase()})${themeLabel ? `, based on ${themeLabel}${context.themeAuthor ? ` by ${context.themeAuthor}` : ""}` : ""}.`,
  ];
  if (context.hasColorSchemeGroup) {
    lines.push(
      `- The theme uses color schemes${context.colorSchemes.length ? ` (${context.colorSchemes.join(", ")})` : ""}. Add a \`color_scheme\` setting (default "${context.colorSchemes[0] ?? "scheme-1"}") and apply it with the theme's class pattern, typically \`color-{{ section.settings.color_scheme }}\`. Use extra \`color\` settings only for colors a scheme does not cover.`,
    );
  }
  if (context.globalSettings.length) {
    lines.push(
      `- Global design settings available as \`settings.<id>\`: ${context.globalSettings
        .map((setting) => `${setting.id} (${setting.type})`)
        .join(", ")}. Use them as defaults or fallbacks so new code matches the theme's look.`,
    );
  }
  if (context.sections.length) lines.push(`- Existing sections: ${context.sections.join(", ")}.`);
  if (context.blocks.length) lines.push(`- Existing theme blocks: ${context.blocks.join(", ")}.`);
  if (context.snippets.length) {
    lines.push(
      `- Existing snippets (reuse with {% render %} when helpful, never with {% include %}): ${context.snippets.join(", ")}.`,
    );
  }
  return lines;
}

function buildSystemPrompt(
  fileType: FileTypeId,
  filename?: string,
  context?: ThemeContext | null,
) {
  const kind = themeFileKind(filename, fileType);
  return [
    "You are a senior Shopify theme developer. The code you write is saved directly into a merchant's live Shopify Online Store 2.0 theme and is edited by non-technical merchants in the Shopify theme editor.",
    `Target file: ${filename || "(new file)"}. File type: ${fileType}.`,
    "",
    "SHOPIFY RULES:",
    "- Write valid, production-ready Liquid that runs on Shopify. Use only real Liquid objects, tags and filters (e.g. `image_url`, `image_tag`, `money`, `t`, `render`); never invent objects, filters, or Admin API fields.",
    "- Do not use {% include %}; use {% render %}. Do not load external frameworks, CDNs or fonts; rely on the theme's fonts and Shopify's own filters.",
    "- Escape merchant text where it lands in attributes (`| escape`). Output must be responsive, mobile first, and accessible (semantic HTML, alt text, focus states, sufficient contrast).",
    "- Use `loading=\"lazy\"` and responsive `widths`/`sizes` on images below the fold.",
    "",
    ...fileKindRules(kind, context),
    "",
    ...themeContextLines(context),
    "",
    "OUTPUT:",
    "- Return the complete file content in a single code block, with no explanation before or after it.",
    "- When editing existing code, return the whole updated file. Keep existing setting ids, block types and merchant customizations unless the request asks to change them, because renaming ids erases values merchants already saved.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function dynamicReminder(kind: ThemeFileKind) {
  switch (kind) {
    case "section":
    case "theme-block":
    case "other":
      return "Every text, color, font size and spacing must be a merchant-editable setting in the {% schema %}.";
    case "snippet":
      return "Every text, color, font size and spacing must be a render parameter with a fallback, not hardcoded.";
    case "asset":
      return "Use CSS custom properties instead of hardcoded colors, font sizes and copy.";
    default:
      return "";
  }
}

function buildUserPrompt(
  prompt: string,
  currentCode: string | undefined,
  fileType: FileTypeId,
  filename?: string,
) {
  const reminder = dynamicReminder(themeFileKind(filename, fileType));
  const intro = `${currentCode?.trim() ? "Edit" : "Create"} this Shopify ${fileType} file for the theme.${reminder ? ` ${reminder}` : ""}`;
  if (currentCode?.trim()) {
    return `${intro}\n\nRequest:\n${prompt}\n\nCurrent code:\n${currentCode}`;
  }
  return `${intro}\n\nRequest:\n${prompt}`;
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
