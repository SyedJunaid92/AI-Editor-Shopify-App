export type ModelProvider = "openai" | "anthropic";

export type AiModel = {
  id: string;
  label: string;
  provider: ModelProvider;
  family: "ChatGPT" | "Claude";
};

export const AI_MODELS: AiModel[] = [
  { id: "gpt-5", label: "GPT-5", provider: "openai", family: "ChatGPT" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", family: "ChatGPT" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", family: "ChatGPT" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", family: "ChatGPT" },
  {
    id: "claude-opus-4-1",
    label: "Claude Opus 4.1",
    provider: "anthropic",
    family: "Claude",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
    family: "Claude",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    family: "Claude",
  },
];

export function getModel(id: string) {
  return AI_MODELS.find((model) => model.id === id) ?? null;
}
