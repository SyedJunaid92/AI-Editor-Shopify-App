const PARTNER_API_VERSION = "2026-07";
const CACHE_MS = 5 * 60 * 1000;

export type ActiveSubscriptionItem = {
  handle: string;
  description: string | null;
};

export type ActiveSubscription = {
  legacySubscriptionId: string | null;
  items: ActiveSubscriptionItem[];
};

const confirmedSubscriptions = new Map<
  string,
  { expiresAt: number; subscription: ActiveSubscription }
>();

function partnerConfig() {
  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID?.trim();
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN?.trim();
  const appId = process.env.SHOPIFY_APP_GID?.trim();
  if (!orgId || !accessToken || !appId) {
    throw new Error(
      "Shopify plan handles need SHOPIFY_PARTNER_ORG_ID, SHOPIFY_PARTNER_API_ACCESS_TOKEN, and SHOPIFY_APP_GID.",
    );
  }
  return { orgId, accessToken, appId };
}

async function partnerGraphql<T>(query: string, variables: Record<string, unknown>) {
  const { orgId, accessToken } = partnerConfig();
  const response = await fetch(
    `https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const json = (await response.json()) as {
    data?: T;
    errors?: { message?: string }[];
  };
  if (!response.ok || json.errors?.length) {
    const message = json.errors?.map((error) => error.message).filter(Boolean).join(" ");
    throw new Error(message || `Partner API request failed: ${response.status}`);
  }
  return json.data as T;
}

export async function fetchActiveSubscription(
  shopId: string,
  options?: { fresh?: boolean },
) {
  if (!options?.fresh) {
    const cached = confirmedSubscriptions.get(shopId);
    if (cached && cached.expiresAt > Date.now()) return cached.subscription;
  }

  const { appId } = partnerConfig();
  const data = await partnerGraphql<{ activeSubscription: ActiveSubscription | null }>(
    `#graphql
      query ActiveSubscription($appId: ID!, $shopId: ID!) {
        activeSubscription(appId: $appId, shopId: $shopId) {
          legacySubscriptionId
          items {
            handle
            description
          }
        }
      }`,
    { appId, shopId },
  );
  const subscription = data?.activeSubscription ?? null;
  if (subscription) {
    confirmedSubscriptions.set(shopId, {
      expiresAt: Date.now() + CACHE_MS,
      subscription,
    });
  } else {
    confirmedSubscriptions.delete(shopId);
  }
  return subscription;
}

export async function cancelActiveSubscription(shopId: string) {
  const { appId } = partnerConfig();
  confirmedSubscriptions.delete(shopId);
  const data = await partnerGraphql<{
    appSubscriptionCancel?: {
      appSubscription?: { cancelledAt: string | null } | null;
      userErrors?: { message?: string }[];
    };
  }>(
    `#graphql
      mutation AppSubscriptionCancel(
        $appId: ID!
        $shopId: ID!
        $prorate: Boolean!
        $skipFinalUsageCharge: Boolean!
        $deferCancellation: Boolean!
      ) {
        appSubscriptionCancel(
          appId: $appId
          shopId: $shopId
          prorate: $prorate
          skipFinalUsageCharge: $skipFinalUsageCharge
          deferCancellation: $deferCancellation
        ) {
          appSubscription {
            cancelledAt
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      appId,
      shopId,
      prorate: true,
      skipFinalUsageCharge: false,
      deferCancellation: false,
    },
  );
  const payload = data?.appSubscriptionCancel;
  const message = payload?.userErrors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ");
  if (message) return { ok: false as const, error: message };
  if (!payload?.appSubscription) {
    return { ok: false as const, error: "Shopify could not cancel the plan." };
  }
  confirmedSubscriptions.delete(shopId);
  return { ok: true as const };
}
