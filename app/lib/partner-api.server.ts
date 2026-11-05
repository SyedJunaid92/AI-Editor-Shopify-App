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
  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID;
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appId = process.env.SHOPIFY_APP_GID;
  if (!orgId || !accessToken || !appId) {
    throw new Error(
      "Shopify plan handles need SHOPIFY_PARTNER_ORG_ID, SHOPIFY_PARTNER_API_ACCESS_TOKEN, and SHOPIFY_APP_GID.",
    );
  }
  return { orgId, accessToken, appId };
}

export async function fetchActiveSubscription(
  shopId: string,
  options?: { fresh?: boolean },
) {
  if (!options?.fresh) {
    const cached = confirmedSubscriptions.get(shopId);
    if (cached && cached.expiresAt > Date.now()) return cached.subscription;
  }

  const { orgId, accessToken, appId } = partnerConfig();
  const response = await fetch(
    `https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `#graphql
          query ActiveSubscription($appId: ID!, $shopId: ID!) {
            activeSubscription(appId: $appId, shopId: $shopId) {
              legacySubscriptionId
              items {
                handle
                description
              }
            }
          }`,
        variables: { appId, shopId },
      }),
    },
  );

  const json = (await response.json()) as {
    data?: { activeSubscription: ActiveSubscription | null };
    errors?: { message?: string }[];
  };

  if (!response.ok || json.errors?.length) {
    throw new Error(
      `Partner API request failed: ${JSON.stringify(json.errors ?? response.status)}`,
    );
  }

  const subscription = json.data?.activeSubscription ?? null;
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
