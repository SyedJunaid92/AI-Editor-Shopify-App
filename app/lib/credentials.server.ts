import { getDecryptedShopKeys } from "./shop-settings.server";
import { getModel, type ModelProvider } from "./models";
import type { PlanKind } from "./plans";

export async function resolveModelApiKey(input: {
  shop: string;
  plan: PlanKind;
  modelId: string;
}): Promise<{ apiKey: string; provider: ModelProvider } | { error: string }> {
  const model = getModel(input.modelId);
  if (!model) {
    return { error: "Unknown model." as const };
  }

  if (input.plan === "byok") {
    const keys = await getDecryptedShopKeys(input.shop);
    const apiKey =
      model.provider === "openai" ? keys?.openaiKey : keys?.anthropicKey;
    if (!apiKey) {
      return {
        error: `Add a ${model.family} API key before using this model.` as const,
      };
    }
    return { apiKey, provider: model.provider };
  }

  const apiKey = hostedKey(model.provider);
  if (!apiKey) {
    return {
      error: `Hosted ${model.family} is not configured. Add ${
        model.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
      } on the server.` as const,
    };
  }

  return { apiKey, provider: model.provider };
}

export function hostedProviders() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

function hostedKey(provider: ModelProvider) {
  return provider === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.ANTHROPIC_API_KEY;
}
