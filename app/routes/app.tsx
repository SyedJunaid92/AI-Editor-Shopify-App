import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  Outlet,
  redirect,
  useLoaderData,
  useRouteError,
} from "react-router";
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
        <s-link href="/app/blocks">AI blocks</s-link>
        <s-link href="/app/onboarding">Theme setup</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/settings">API keys</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  try {
    return boundary.error(error);
  } catch (caught) {
    if (isRouteErrorResponse(error)) {
      const html = typeof error.data === "string" ? error.data : "";
      if (html) return <div dangerouslySetInnerHTML={{ __html: html }} />;
      return <div>Handling response</div>;
    }

    const message =
      caught instanceof Error ? caught.message : "The app page did not load.";
    return (
      <main
        style={{
          fontFamily: "Inter, sans-serif",
          padding: 24,
          color: "#1a1a1a",
        }}
      >
        <h1 style={{ fontSize: 28, marginTop: 0 }}>AI Editor</h1>
        <p>{message}</p>
      </main>
    );
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
