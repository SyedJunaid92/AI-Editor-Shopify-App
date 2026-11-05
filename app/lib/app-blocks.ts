export const BLOCKS_NAMESPACE = "ai_editor_blocks";
export const APP_BLOCK_HANDLE = "ai-block";
export const MAX_BLOCK_CHARS = 100_000;

export type AiBlock = {
  key: string;
  name: string;
  html: string;
  css: string;
  /** CSS class that wraps the block on the storefront; every selector is scoped to it. */
  scope: string;
  updatedAt: string;
};

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function slugifyBlockKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Lenient cleanup while typing; keeps a trailing hyphen so "summer-sale" can be typed. */
export function sanitizeBlockKeyInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 41);
}

export function isValidBlockKey(key: string) {
  return KEY_PATTERN.test(key);
}

export function newBlockScope() {
  return `ai-block-${Math.random().toString(36).slice(2, 8)}`;
}

export function isValidBlockScope(scope: string) {
  return /^ai-block-[a-z0-9-]{1,48}$/.test(scope);
}

export function stripScripts(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/?>/gi, "");
}

/** Splits model output into its CSS (from <style> tags) and the remaining markup. */
export function splitGeneratedBlock(output: string) {
  const styles: string[] = [];
  const html = output.replace(/<style[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css: string) => {
    styles.push(css.trim());
    return "";
  });
  return { html: stripScripts(html).trim(), css: styles.join("\n\n") };
}

export function blockPreviewDocument(block: { scope: string; html: string; css: string }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #121212; background: #fff; }
  img { max-width: 100%; height: auto; }
</style>
<style>${block.css}</style>
</head>
<body>
<div class="${block.scope}">${stripScripts(block.html)}</div>
</body>
</html>`;
}

/** Theme editor deep link that adds the AI Editor app block to a template. */
export function addBlockDeepLink(
  apiKey: string,
  template = "index",
  themeGid?: string,
) {
  const themeId = themeGid ? themeGid.split("/").pop() || "current" : "current";
  const params = new URLSearchParams({
    template,
    addAppBlockId: `${apiKey}/${APP_BLOCK_HANDLE}`,
    target: "newAppsSection",
  });
  return `shopify:admin/themes/${themeId}/editor?${params.toString()}`;
}
