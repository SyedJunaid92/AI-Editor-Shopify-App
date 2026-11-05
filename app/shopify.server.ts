import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { BYOK_PLAN, HOSTED_PLAN, PLAN_PRICES } from "./lib/plans";
import { createSessionStorage } from "./session-storage.server";

import { getAppUrl } from "./utils/app-url";

export const apiVersion = ApiVersion.July26;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion,
  scopes: process.env.SCOPES?.split(","),
  appUrl: getAppUrl(),
  authPathPrefix: "/auth",
  sessionStorage: createSessionStorage(),
  distribution: AppDistribution.AppStore,
  polarisUrl: "https://cdn.shopify.com/shopifycloud/polaris-1.js",
  billing: {
    [BYOK_PLAN]: {
      lineItems: [
        {
          amount: PLAN_PRICES.byok,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [HOSTED_PLAN]: {
      lineItems: [
        {
          amount: PLAN_PRICES.hosted,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export { BYOK_PLAN, HOSTED_PLAN };
