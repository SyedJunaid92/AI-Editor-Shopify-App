import type { FileTypeId } from "./models";

export type ThemeFileNode = {
  filename: string;
  contentType: string;
};

const TEXT_EXTENSIONS = new Set([
  "liquid",
  "json",
  "js",
  "mjs",
  "css",
  "scss",
  "svg",
  "txt",
  "md",
  "html",
  "graphql",
  "csv",
  "webmanifest",
]);

const CATEGORY_ORDER = [
  "Layout",
  "Templates",
  "Customer templates",
  "Sections",
  "Blocks",
  "Snippets",
  "Config",
  "Locales",
  "Assets",
  "Other",
] as const;

export function themeFileCategory(filename: string) {
  if (filename.startsWith("layout/")) return "Layout";
  if (filename.startsWith("templates/customers/")) return "Customer templates";
  if (filename.startsWith("templates/")) return "Templates";
  if (filename.startsWith("sections/")) return "Sections";
  if (filename.startsWith("blocks/")) return "Blocks";
  if (filename.startsWith("snippets/")) return "Snippets";
  if (filename.startsWith("config/")) return "Config";
  if (filename.startsWith("locales/")) return "Locales";
  if (filename.startsWith("assets/")) return "Assets";
  return "Other";
}

export function fileExtension(filename: string) {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isTextThemeFile(filename: string, contentType = "") {
  const type = contentType.toLowerCase();
  if (type.startsWith("font/") || type.startsWith("audio/") || type.startsWith("video/")) {
    return false;
  }
  if (type.startsWith("image/") && !type.includes("svg")) return false;
  if (TEXT_EXTENSIONS.has(fileExtension(filename))) return true;
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("svg") ||
    type.includes("xml")
  );
}

export function fileTypeForFilename(filename: string): FileTypeId {
  const extension = fileExtension(filename);
  if (extension === "json") return "json";
  if (extension === "js" || extension === "mjs") return "javascript";
  if (extension === "css" || extension === "scss") return "css";
  if (extension === "graphql") return "graphql";
  return "liquid";
}

export function groupThemeFiles(files: ThemeFileNode[], query: string) {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, ThemeFileNode[]>();

  for (const file of files) {
    if (needle && !file.filename.toLowerCase().includes(needle)) continue;
    const category = themeFileCategory(file.filename);
    const list = groups.get(category) ?? [];
    list.push(file);
    groups.set(category, list);
  }

  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
    category,
    files: groups.get(category)!.sort((a, b) => a.filename.localeCompare(b.filename)),
  }));
}

export function preferredTheme(themes: { id: string; role: string }[]) {
  return themes.find((theme) => theme.role === "MAIN") ?? themes[0];
}

export function defaultThemeFilename(files: ThemeFileNode[]) {
  return (
    files.find((file) => file.filename === "templates/index.json")?.filename ??
    files.find((file) => file.filename === "layout/theme.liquid")?.filename ??
    files.find((file) => isTextThemeFile(file.filename, file.contentType))?.filename ??
    "sections/ai-hero.liquid"
  );
}

const PREVIEW_THEME_PREFIX = "AI Editor preview · ";

export function previewThemeName(sourceName: string) {
  return `${PREVIEW_THEME_PREFIX}${sourceName}`.slice(0, 50);
}

export function isPreviewThemeName(name: string) {
  return name.startsWith(PREVIEW_THEME_PREFIX);
}

export function themeNumericId(themeGid: string) {
  return themeGid.split("/").pop() ?? themeGid;
}

const TEMPLATE_PATHS: Record<string, string> = {
  index: "/",
  collection: "/collections/all",
  "list-collections": "/collections",
  product: "/collections/all",
  cart: "/cart",
  search: "/search",
  "404": "/404",
  blog: "/blogs/news",
  article: "/blogs/news",
  password: "/password",
  "customers/login": "/account/login",
  "customers/register": "/account/register",
  "customers/account": "/account",
};

/** Storefront page that best shows the given theme file. */
export function previewPathForFilename(filename: string) {
  const template = filename.match(/^templates\/(.+?)(\.[^/.]+)?\.(json|liquid)$/i)?.[1];
  if (template && TEMPLATE_PATHS[template]) return TEMPLATE_PATHS[template];
  return "/";
}

export function normalizePreviewPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || /^[a-z]+:/i.test(trimmed) || trimmed.startsWith("//")) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function storefrontPreviewUrl(shop: string, themeGid: string, path: string) {
  const url = new URL(normalizePreviewPath(path), `https://${shop}`);
  url.searchParams.set("preview_theme_id", themeNumericId(themeGid));
  return url.toString();
}

export function themeEditorAdminPath(themeGid: string, filename: string) {
  const themeId = themeNumericId(themeGid);
  const template = filename.match(/^templates\/(.+)\.json$/i)?.[1];
  if (template) {
    return `shopify:admin/themes/${themeId}/editor?template=${encodeURIComponent(template)}`;
  }
  const key = filename ? `?key=${encodeURIComponent(filename)}` : "";
  return `shopify:admin/themes/${themeId}${key}`;
}
