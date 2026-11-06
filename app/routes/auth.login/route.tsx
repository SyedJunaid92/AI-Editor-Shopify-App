import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Continue OAuth only when Shopify already supplied the shop.
  if (url.searchParams.get("shop")) {
    await login(request);
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function Auth() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-page heading="Open AI Editor from Shopify">
        <s-section>
          <s-paragraph>
            Install AI Editor from the Shopify App Store, or open it from your
            Shopify admin.
          </s-paragraph>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
