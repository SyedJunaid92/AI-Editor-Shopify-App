import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import {
  embeddedAdminUrl,
  shopForChargeReturn,
} from "../lib/billing.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await shopForChargeReturn(request);
  if (shop) throw redirect(embeddedAdminUrl(shop));

  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider
      apiKey={apiKey}
      polarisUrl="https://cdn.shopify.com/shopifycloud/polaris-1.js"
    >
      <s-app-nav>
        <s-link href="/app">Editor</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/settings">API keys</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
