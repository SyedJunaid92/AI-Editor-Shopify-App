import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { cancelActiveSubscription, fetchActiveSubscription } from "./partner-api.server";
import {
  APP_HANDLE,
  planKindFromHandle,
  planSubscriptionLabel,
  type PlanKind,
} from "./plans";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type BillingState = {
  hasActivePayment: boolean;
  plan: PlanKind | null;
  planHandle: string | null;
  subscriptionName: string | null;
  subscriptionId: string | null;
  isTest: boolean;
  billingError: string | null;
};

type AdminRedirect = Awaited<ReturnType<typeof authenticate.admin>>["redirect"];

export function planSelectionUrl(shop: string) {
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

export function redirectToPlanSelection(redirect: AdminRedirect, shop: string): never {
  throw redirect(planSelectionUrl(shop), { target: "_top" });
}

async function loadShop(admin: AdminGraphql) {
  const response = await admin.graphql(
    `#graphql
      query AiEditorShopBilling {
        shop {
          id
          plan {
            partnerDevelopment
            publicDisplayName
          }
        }
      }`,
  );
  const json = (await response.json()) as {
    data?: {
      shop?: {
        id?: string;
        plan?: {
          partnerDevelopment?: boolean;
          publicDisplayName?: string;
        };
      };
    };
    errors?: { message?: string }[];
  };
  if (!response.ok || json.errors?.length || !json.data?.shop?.id) {
    throw new Error(
      `Shop query failed: ${JSON.stringify(json.errors ?? response.status)}`,
    );
  }
  const plan = json.data.shop.plan;
  const isTest = Boolean(
    plan?.partnerDevelopment ||
      String(plan?.publicDisplayName || "").toLowerCase() === "development",
  );
  return { shopId: json.data.shop.id, isTest };
}

export async function getBillingState(request: Request): Promise<{
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"];
  redirect: AdminRedirect;
  billingState: BillingState;
}> {
  const { admin, session, redirect } = await authenticate.admin(request);
  const { shopId, isTest } = await loadShop(admin);
  const url = new URL(request.url);
  let subscription: Awaited<ReturnType<typeof fetchActiveSubscription>> = null;
  let billingError: string | null = null;
  try {
    subscription = await fetchActiveSubscription(shopId, {
      fresh: url.searchParams.has("plan_handle") || url.searchParams.has("charge_id"),
    });
  } catch (error) {
    billingError =
      error instanceof Error ? error.message : "Could not check the Shopify plan.";
    console.error("Plan lookup failed", billingError);
  }
  const items = subscription?.items ?? [];
  const matched = items.find(
    (item) => planKindFromHandle(item.handle) || planKindFromHandle(item.description),
  );
  const plan = matched
    ? (planKindFromHandle(matched.handle) ?? planKindFromHandle(matched.description))
    : null;
  const planHandle = matched?.handle ?? items[0]?.handle ?? null;

  return {
    admin,
    session,
    redirect,
    billingState: {
      hasActivePayment: subscription != null,
      plan,
      planHandle,
      subscriptionName:
        plan && planHandle ? planSubscriptionLabel(plan, planHandle) : planHandle,
      subscriptionId: subscription?.legacySubscriptionId ?? null,
      isTest,
      billingError,
    },
  };
}

export async function cancelCurrentPlan(admin: AdminGraphql) {
  try {
    const { shopId } = await loadShop(admin);
    return await cancelActiveSubscription(shopId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify could not cancel the plan.";
    if (/financials|access denied|not authorized/i.test(message)) {
      return {
        ok: false as const,
        error:
          "Shopify refused the cancellation. The Partner API client needs the View financials permission.",
      };
    }
    return { ok: false as const, error: message };
  }
}

export async function requirePaidPlan(request: Request) {
  const context = await getBillingState(request);
  if (!context.billingState.hasActivePayment || !context.billingState.plan) {
    throw context.redirect("/app/billing");
  }
  return context;
}

export function embeddedAdminUrl(shop: string) {
  const store = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${store}/apps/${process.env.SHOPIFY_API_KEY}/app`;
}

export async function shopForChargeReturn(request: Request) {
  const url = new URL(request.url);
  const returning =
    url.searchParams.has("charge_id") || url.searchParams.has("plan_handle");
  if (!returning || url.searchParams.get("host")) {
    return null;
  }

  const fromQuery = url.searchParams.get("shop");
  if (fromQuery) return fromQuery;

  const sessions = await prisma.session.findMany({
    distinct: ["shop"],
    select: { shop: true },
  });
  return sessions.length === 1 ? sessions[0].shop : null;
}
