import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getBillingState,
  redirectToPlanSelection,
} from "../lib/billing.server";
import {
  BYOK_PLAN_HANDLE,
  HOSTED_PLAN_HANDLE,
  PLAN_PRICES,
} from "../lib/plans";
import { validateAnthropicKey, validateOpenAiKey } from "../lib/ai.server";
import {
  getShopKeyStatus,
  saveValidatedKeys,
} from "../lib/shop-settings.server";

type ActionData = {
  ok?: boolean;
  error?: string;
  openaiError?: string;
  anthropicError?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billingState } = await getBillingState(request);
  const keyStatus = await getShopKeyStatus(session.shop);
  return { billingState, keyStatus };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await getBillingState(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "cancel-plan" || intent === "subscribe-hosted") {
    redirectToPlanSelection(redirect, session.shop);
  }

  if (intent === "subscribe-byok") {
    const openaiKey = String(form.get("openaiKey") || "");
    const anthropicKey = String(form.get("anthropicKey") || "");
    const existing = await getShopKeyStatus(session.shop);
    const typedOpenAi = openaiKey.trim();
    const typedAnthropic = anthropicKey.trim();
    const usingSavedKeys =
      !typedOpenAi &&
      !typedAnthropic &&
      (existing.openaiValid || existing.anthropicValid);

    if (!usingSavedKeys) {
      if (!typedOpenAi && !typedAnthropic) {
        return {
          ok: false,
          error: "Add a ChatGPT key, a Claude key, or both.",
        } satisfies ActionData;
      }

      let openaiError: string | undefined;
      let anthropicError: string | undefined;
      if (typedOpenAi) {
        const result = await validateOpenAiKey(typedOpenAi);
        if (!result.valid) openaiError = result.error;
      }
      if (typedAnthropic) {
        const result = await validateAnthropicKey(typedAnthropic);
        if (!result.valid) anthropicError = result.error;
      }
      if (openaiError || anthropicError) {
        return {
          ok: false,
          openaiError,
          anthropicError,
          error: `Fix the API key before the $${PLAN_PRICES.byok} plan can start.`,
        } satisfies ActionData;
      }

      await saveValidatedKeys(session.shop, {
        openaiKey: typedOpenAi || undefined,
        anthropicKey: typedAnthropic || undefined,
      });
    }

    redirectToPlanSelection(redirect, session.shop);
  }

  return { ok: false, error: "Unknown billing action." } satisfies ActionData;
};

export function BillingView({
  billingState,
  keyStatus,
}: {
  billingState: Awaited<ReturnType<typeof loader>>["billingState"];
  keyStatus: Awaited<ReturnType<typeof loader>>["keyStatus"];
}) {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = navigation.state !== "idle";

  const cancelling =
    busy && navigation.formData?.get("intent") === "cancel-plan";

  useEffect(() => {
    if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Choose a plan">
      <s-stack direction="block" gap="base">
        {billingState.billingError ? (
          <s-banner heading="Could not check the current plan" tone="critical">
            {billingState.billingError}
          </s-banner>
        ) : null}
        {billingState.hasActivePayment ? (
          <>
            <s-banner
              heading={billingState.plan ? "Active subscription" : "Unrecognized plan handle"}
              tone={billingState.plan ? "success" : "critical"}
            >
              {billingState.plan
                ? `${billingState.subscriptionName}. You can switch or cancel on Shopify's plan page. Cancelling locks the editor until you subscribe again.`
                : `Shopify returned plan handle ${billingState.planHandle || "none"}. This app unlocks ${BYOK_PLAN_HANDLE} and ${HOSTED_PLAN_HANDLE}.`}
            </s-banner>
            <s-button
              type="button"
              tone="critical"
              commandFor="cancel-plan-modal"
              command="--show"
              disabled={busy}
            >
              Manage plan
            </s-button>
            <Form method="post" action="/app/billing" id="cancel-plan-form">
              <input type="hidden" name="intent" value="cancel-plan" />
            </Form>
            <s-modal id="cancel-plan-modal" heading="Manage plan" size="small-100">
              <s-paragraph>
                Shopify opens the plan page for {billingState.planHandle || "this app"}.
                Switch or cancel there. Cancelling locks the editor until you
                subscribe again.
              </s-paragraph>
              <s-button
                slot="primary-action"
                variant="primary"
                tone="critical"
                type="button"
                disabled={busy}
                {...(cancelling ? { loading: true } : {})}
                onClick={() => {
                  const form = document.getElementById("cancel-plan-form");
                  if (form instanceof HTMLFormElement) form.requestSubmit();
                }}
              >
                Open plan page
              </s-button>
              <s-button
                slot="secondary-actions"
                variant="secondary"
                type="button"
                commandFor="cancel-plan-modal"
                command="--hide"
                disabled={cancelling}
              >
                Keep plan
              </s-button>
            </s-modal>
          </>
        ) : (
          <s-banner heading="Choose a plan to open the editor" tone="info">
            {billingState.isTest
              ? "This is a development store. Subscribe opens Shopify's plan page and creates a test charge."
              : "Subscribe opens Shopify's plan page and creates a real charge."}
          </s-banner>
        )}

        {actionData?.error ? (
          <s-banner heading="Billing could not be updated" tone="critical">
            {actionData.error}
            {actionData.openaiError ? ` OpenAI: ${actionData.openaiError}` : ""}
            {actionData.anthropicError
              ? ` Claude: ${actionData.anthropicError}`
              : ""}
          </s-banner>
        ) : null}

        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-section heading={`Your API keys · $${PLAN_PRICES.byok} / month`}>
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Add a ChatGPT key, a Claude key, or both. Only the providers
                with a valid key can be used in the editor.
              </s-paragraph>
              <s-unordered-list>
                <s-list-item>One key unlocks that provider&apos;s models</s-list-item>
                <s-list-item>Keys stored encrypted on the app server</s-list-item>
                <s-list-item>
                  {keyStatus.openaiValid && keyStatus.anthropicValid
                    ? "ChatGPT and Claude keys are saved"
                    : keyStatus.openaiValid
                      ? "ChatGPT key is saved"
                      : keyStatus.anthropicValid
                        ? "Claude key is saved"
                        : "Add at least one key"}
                </s-list-item>
              </s-unordered-list>
              <Form method="post" action="/app/billing">
                <s-stack direction="block" gap="base">
                  <s-password-field
                    label="OpenAI API key"
                    name="openaiKey"
                    autocomplete="off"
                    placeholder={
                      keyStatus.openaiValid ? "Saved and valid" : "sk-..."
                    }
                  ></s-password-field>
                  <s-password-field
                    label="Anthropic API key"
                    name="anthropicKey"
                    autocomplete="off"
                    placeholder={
                      keyStatus.anthropicValid ? "Saved and valid" : "sk-ant-..."
                    }
                  ></s-password-field>
                  <input type="hidden" name="intent" value="subscribe-byok" />
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(busy ? { loading: true } : {})}
                    disabled={busy || billingState.plan === "byok"}
                  >
                    {billingState.plan === "byok"
                      ? "Current plan"
                      : `Subscribe · $${PLAN_PRICES.byok} / 30 days`}
                  </s-button>
                </s-stack>
              </Form>
            </s-stack>
          </s-section>

          <s-section heading={`Hosted API · $${PLAN_PRICES.hosted} / month`}>
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Use the app&apos;s ChatGPT and Claude keys. No merchant keys
                required. Shopify still collects the recurring charge.
              </s-paragraph>
              <s-unordered-list>
                <s-list-item>ChatGPT and Claude models</s-list-item>
                <s-list-item>
                  {`Usage billed through this $${PLAN_PRICES.hosted} plan`}
                </s-list-item>
                <s-list-item>Best if you do not want to manage API keys</s-list-item>
              </s-unordered-list>
              <Form method="post" action="/app/billing">
                <input type="hidden" name="intent" value="subscribe-hosted" />
                <s-button
                  type="submit"
                  variant="primary"
                  {...(busy ? { loading: true } : {})}
                  disabled={busy || billingState.plan === "hosted"}
                >
                  {billingState.plan === "hosted"
                    ? "Current plan"
                    : `Subscribe · $${PLAN_PRICES.hosted} / 30 days`}
                </s-button>
              </Form>
            </s-stack>
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}

export default function BillingPage() {
  const { billingState, keyStatus } = useLoaderData<typeof loader>();
  return <BillingView billingState={billingState} keyStatus={keyStatus} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
