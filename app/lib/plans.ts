export const BYOK_PLAN = "AI Editor - Your API keys";
export const HOSTED_PLAN = "AI Editor - Hosted API";

export const PLAN_PRICES = {
  byok: 75,
  hosted: 200,
} as const;

export type PlanKind = "byok" | "hosted";

export function planKindFromName(name?: string | null): PlanKind | null {
  if (name === BYOK_PLAN) return "byok";
  if (name === HOSTED_PLAN) return "hosted";
  return null;
}
