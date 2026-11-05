/** Must match `handle` in shopify.app.toml. Used in Shopify's plan-selection URL. */
export const APP_HANDLE = "appify-ai-editor";

/** Public plan handles from the Partner Dashboard pricing page. */
export const BYOK_PLAN_HANDLE = "ai-editor-your-api-keys";
export const HOSTED_PLAN_HANDLE = "ai-editor-hosted-api";

const LEGACY_BYOK_NAME = "AI Editor - Your API keys";
const LEGACY_HOSTED_NAME = "AI Editor - Hosted API";

export const PLAN_PRICES = {
  byok: 120,
  hosted: 300,
} as const;

export const PLAN_LABELS = {
  byok: "Your API keys",
  hosted: "Hosted API",
} as const;

export type PlanKind = "byok" | "hosted";

export function planKindFromHandle(value?: string | null): PlanKind | null {
  if (value === BYOK_PLAN_HANDLE || value === LEGACY_BYOK_NAME) return "byok";
  if (value === HOSTED_PLAN_HANDLE || value === LEGACY_HOSTED_NAME) return "hosted";
  return null;
}

export function planSubscriptionLabel(kind: PlanKind, handle: string) {
  return `${PLAN_LABELS[kind]} · ${handle}`;
}
