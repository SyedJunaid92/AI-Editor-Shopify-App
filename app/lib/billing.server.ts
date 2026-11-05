import { BillingReplacementBehavior } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate, BYOK_PLAN, HOSTED_PLAN } from "../shopify.server";
import { planKindFromName, type PlanKind } from "./plans";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type BillingState = {
  hasActivePayment: boolean;
  plan: PlanKind | null;
  subscriptionName: string | null;
  subscriptionId: string | null;
  isTest: boolean;
};

export async function shopUsesTestCharges(admin: AdminGraphql) {
  const response = await admin.graphql(
    `#graphql
      query AiEditorShopPlan {
        shop {
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
        plan?: {
          partnerDevelopment?: boolean;
          publicDisplayName?: string;
        };
      };
    };
  };
  const plan = json.data?.shop?.plan;
  if (plan?.partnerDevelopment) return true;
  return String(plan?.publicDisplayName || "").toLowerCase() === "development";
}

export async function getBillingState(request: Request): Promise<{
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"];
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"];
  redirect: Awaited<ReturnType<typeof authenticate.admin>>["redirect"];
  billingState: BillingState;
}> {
  const { admin, session, billing, redirect } = await authenticate.admin(request);
  const isTest = await shopUsesTestCharges(admin);
  const result = await billing.check({
    plans: [BYOK_PLAN, HOSTED_PLAN],
    isTest,
  });

  const subscription = result.appSubscriptions[0];
  return {
    admin,
    session,
    billing,
    redirect,
    billingState: {
      hasActivePayment: result.hasActivePayment,
      plan: planKindFromName(subscription?.name),
      subscriptionName: subscription?.name ?? null,
      subscriptionId: subscription?.id ?? null,
      isTest,
    },
  };
}

export async function requirePaidPlan(request: Request) {
  const context = await getBillingState(request);
  if (!context.billingState.hasActivePayment || !context.billingState.plan) {
    throw context.redirect("/app/billing");
  }
  return context;
}

export async function cancelPlan(
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"],
  subscriptionId: string,
  isTest: boolean,
) {
  try {
    await billing.cancel({
      subscriptionId,
      isTest,
      prorate: true,
    });
    return { ok: true as const };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error(error);
    return { ok: false as const, error: billingErrorMessage(error) };
  }
}

export async function requestPlan(
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"],
  plan: typeof BYOK_PLAN | typeof HOSTED_PLAN,
  returnUrl: string,
  isTest: boolean,
) {
  try {
    return await billing.request({
      plan,
      isTest,
      returnUrl,
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error(error);
    return { ok: false as const, error: billingErrorMessage(error) };
  }
}

function billingErrorMessage(error: unknown) {
  const details =
    error && typeof error === "object" && "errorData" in error
      ? (error as { errorData?: { message?: string }[] }).errorData
      : undefined;
  const message = details
    ?.map((item) => item.message)
    .filter(Boolean)
    .join(" ");
  if (message?.includes("public distribution")) {
    return "Shopify blocked this charge because the app is not public yet. In the Partner Dashboard, set distribution to Public, then subscribe again.";
  }
  if (message) return message;
  if (error instanceof Error && error.message) return error.message;
  return "Shopify could not start the subscription.";
}

export function embeddedAdminUrl(shop: string) {
  const store = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${store}/apps/${process.env.SHOPIFY_API_KEY}/app`;
}

export async function shopForChargeReturn(request: Request) {
  const url = new URL(request.url);
  if (!url.searchParams.has("charge_id") || url.searchParams.get("host")) {
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
