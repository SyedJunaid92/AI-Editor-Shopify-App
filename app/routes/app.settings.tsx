import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { validateAnthropicKey, validateOpenAiKey } from "../lib/ai.server";
import {
  getShopKeyStatus,
  saveValidatedKeys,
} from "../lib/shop-settings.server";
import { PLAN_PRICES } from "../lib/plans";

type ActionData = {
  ok?: boolean;
  error?: string;
  openaiError?: string;
  anthropicError?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const keyStatus = await getShopKeyStatus(session.shop);
  return { keyStatus };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const openaiKey = String(form.get("openaiKey") || "").trim();
  const anthropicKey = String(form.get("anthropicKey") || "").trim();
  if (!openaiKey && !anthropicKey) {
    return {
      ok: false,
      error: "Add a ChatGPT key, a Claude key, or both.",
    } satisfies ActionData;
  }

  let openaiError: string | undefined;
  let anthropicError: string | undefined;
  if (openaiKey) {
    const result = await validateOpenAiKey(openaiKey);
    if (!result.valid) openaiError = result.error;
  }
  if (anthropicKey) {
    const result = await validateAnthropicKey(anthropicKey);
    if (!result.valid) anthropicError = result.error;
  }
  if (openaiError || anthropicError) {
    return {
      ok: false,
      openaiError,
      anthropicError,
      error: "Fix the API key before it can be saved.",
    } satisfies ActionData;
  }

  await saveValidatedKeys(session.shop, {
    openaiKey: openaiKey || undefined,
    anthropicKey: anthropicKey || undefined,
  });
  return { ok: true } satisfies ActionData;
};

export default function SettingsPage() {
  const { keyStatus } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("API key saved");
    }
    if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="API keys">
      <s-section heading="Bring your own ChatGPT and Claude keys">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Add a ChatGPT key, a Claude key, or both. The editor only lists
            models for the keys you save. Keys are encrypted and never sent
            back to the browser.
          </s-paragraph>

          <s-stack direction="inline" gap="base">
            <s-badge tone={keyStatus.openaiValid ? "success" : "warning"}>
              ChatGPT {keyStatus.openaiValid ? "validated" : "not validated"}
            </s-badge>
            <s-badge tone={keyStatus.anthropicValid ? "success" : "warning"}>
              Claude {keyStatus.anthropicValid ? "validated" : "not validated"}
            </s-badge>
          </s-stack>

          {actionData?.error ? (
            <s-banner heading="Validation failed" tone="critical">
              {actionData.error}
              {actionData.openaiError ? ` OpenAI: ${actionData.openaiError}` : ""}
              {actionData.anthropicError
                ? ` Claude: ${actionData.anthropicError}`
                : ""}
            </s-banner>
          ) : null}

          {actionData?.ok ? (
            <s-banner heading="Keys ready" tone="success">
              {`You can subscribe to the $${PLAN_PRICES.byok} plan. The editor will offer models only for the keys that were saved.`}
            </s-banner>
          ) : null}

          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-password-field
                label="OpenAI API key"
                name="openaiKey"
                autocomplete="off"
              ></s-password-field>
              <s-password-field
                label="Anthropic API key"
                name="anthropicKey"
                autocomplete="off"
              ></s-password-field>
              <s-button
                type="submit"
                variant="primary"
                {...(busy ? { loading: true } : {})}
                disabled={busy}
              >
                Save keys
              </s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
