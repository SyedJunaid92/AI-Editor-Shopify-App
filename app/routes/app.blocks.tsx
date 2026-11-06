import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getBillingState, requirePaidPlan } from "../lib/billing.server";
import { GenerationStatus } from "../components/generation-status";
import { BillingView } from "./app.billing";
import { useGeneration } from "../lib/use-generation";
import { getShopKeyStatus } from "../lib/shop-settings.server";
import { AI_MODELS } from "../lib/models";
import {
  MAX_BLOCK_CHARS,
  addBlockDeepLink,
  blockPreviewDocument,
  isValidBlockKey,
  isValidBlockScope,
  newBlockScope,
  sanitizeBlockKeyInput,
  slugifyBlockKey,
  splitGeneratedBlock,
  type AiBlock,
} from "../lib/app-blocks";
import { deleteBlock, listBlocks, saveBlock } from "../lib/app-blocks.server";
import styles from "../styles/editor.module.css";

type ActionData = {
  ok?: boolean;
  intent?: string;
  error?: string;
  message?: string;
  block?: AiBlock;
  deletedKey?: string;
};

type Draft = { key: string; name: string; html: string; css: string; scope: string };

const emptyDraft = (): Draft => ({ key: "", name: "", html: "", css: "", scope: newBlockScope() });

const draftFromBlock = (block: AiBlock): Draft => ({
  key: block.key,
  name: block.name,
  html: block.html,
  css: block.css,
  scope: block.scope,
});

const QUICK_PROMPTS = [
  "Announcement banner with a call-to-action button",
  "FAQ accordion with five questions",
  "Three-column feature grid with icons",
  "Testimonial section with star ratings",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billingState } = await getBillingState(request);
  const keyStatus = await getShopKeyStatus(session.shop);

  if (!billingState.hasActivePayment || !billingState.plan) {
    return { view: "billing" as const, billingState, keyStatus };
  }

  const blocks = await listBlocks(admin).catch(() => []);
  return {
    view: "blocks" as const,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    plan: billingState.plan,
    keyStatus,
    blocks,
    models: AI_MODELS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await requirePaidPlan(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const key = String(form.get("key") || "").trim();
  const name = String(form.get("name") || "").trim();
  const html = String(form.get("html") || "");
  const css = String(form.get("css") || "");
  const scope = String(form.get("scope") || "");

  if (intent === "save" && !isValidBlockScope(scope)) {
    return { ok: false, intent, error: "This block is missing its style scope. Reload the page." };
  }

  if (intent === "save") {
    if (!name) return { ok: false, intent, error: "Give the block a name." };
    if (!isValidBlockKey(key)) {
      return {
        ok: false,
        intent,
        error: "Block ID must be 2–41 lowercase letters, numbers, or hyphens.",
      };
    }
    if (!html.trim()) return { ok: false, intent, error: "The block has no HTML yet." };
    if (html.length + css.length > MAX_BLOCK_CHARS) {
      return { ok: false, intent, error: "This block is too large to save. Simplify it and try again." };
    }
    try {
      if (form.get("isNew") === "1") {
        const existing = await listBlocks(admin);
        if (existing.some((block) => block.key === key)) {
          return {
            ok: false,
            intent,
            error: `A block with the ID “${key}” already exists. Choose another Block ID.`,
          };
        }
      }
      const block = await saveBlock(admin, { key, name, html, css, scope });
      return { ok: true, intent, block, message: `Saved “${name}”.` };
    } catch (error) {
      return {
        ok: false,
        intent,
        error: error instanceof Error ? error.message : "Could not save the block.",
      };
    }
  }

  if (intent === "delete") {
    try {
      await deleteBlock(admin, key);
      return { ok: true, intent, deletedKey: key, message: "Block deleted." };
    } catch (error) {
      return {
        ok: false,
        intent,
        error: error instanceof Error ? error.message : "Could not delete the block.",
      };
    }
  }

  return { ok: false, error: "Unknown action." };
};

export default function BlocksPage() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  if (data.view === "billing") {
    return <BillingView billingState={data.billingState} keyStatus={data.keyStatus} />;
  }
  return <BlocksScreen key={location.pathname} data={data} />;
}

function BlocksScreen({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof loader>>, { view: "blocks" }>;
}) {
  const fetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const generation = useGeneration();
  const draftBeforeGeneration = useRef<Draft | null>(null);
  const previewTimer = useRef<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const latestDraft = useRef(draft);
  const [previewDraft, setPreviewDraft] = useState(draft);
  latestDraft.current = draft;
  const [keyEdited, setKeyEdited] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(data.models[0]?.id ?? "gpt-4o");
  const [codeTab, setCodeTab] = useState<"html" | "css">("html");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  const isNew = selectedKey === null;
  const saved = data.blocks.find((block) => block.key === selectedKey);
  const dirty = saved
    ? saved.name !== draft.name || saved.html !== draft.html || saved.css !== draft.css
    : Boolean(draft.name || draft.html || draft.css);
  const pendingIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const busy = fetcher.state !== "idle" || generation.generating;
  useEffect(() => {
    if (!generation.generating) {
      if (previewTimer.current) {
        window.clearTimeout(previewTimer.current);
        previewTimer.current = null;
      }
      return;
    }
    if (previewTimer.current) return;
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      setPreviewDraft(latestDraft.current);
    }, 500);
  }, [draft, generation.generating]);

  useEffect(
    () => () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  const previewDoc = useMemo(
    () => blockPreviewDocument(generation.generating ? previewDraft : draft),
    [draft, previewDraft, generation.generating],
  );

  const availableModels = useMemo(() => {
    if (data.plan === "byok") {
      return data.models.filter((item) =>
        item.provider === "openai" ? data.keyStatus.openaiValid : data.keyStatus.anthropicValid,
      );
    }
    return data.models;
  }, [data.plan, data.keyStatus.openaiValid, data.keyStatus.anthropicValid, data.models]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.some((item) => item.id === model)) {
      setModel(availableModels[0].id);
    }
  }, [availableModels, model]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.ok && result.intent === "save" && result.block) {
      setSelectedKey(result.block.key);
      setKeyEdited(false);
      revalidator.revalidate();
    }
    if (result.ok && result.intent === "delete") {
      setSelectedKey(null);
      setDraft(emptyDraft());
      revalidator.revalidate();
    }
    if (result.ok && result.message) shopify.toast.show(result.message);
    if (!result.ok && result.error) shopify.toast.show(result.error, { isError: true });
    // revalidator identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  const confirmDiscard = () =>
    !dirty || window.confirm("Discard unsaved changes to this block?");

  const selectBlock = (block: AiBlock) => {
    if (generation.generating) {
      shopify.toast.show("Stop the generation before switching blocks.");
      return;
    }
    if (block.key === selectedKey || !confirmDiscard()) return;
    setSelectedKey(block.key);
    setDraft(draftFromBlock(block));
    setKeyEdited(false);
  };

  const newBlock = () => {
    if (generation.generating) {
      shopify.toast.show("Stop the generation before starting a new block.");
      return;
    }
    if (!confirmDiscard()) return;
    setSelectedKey(null);
    setDraft(emptyDraft());
    setKeyEdited(false);
  };

  const submit = (intent: string, values: Draft = draft) => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("key", values.key);
    form.set("name", values.name);
    form.set("html", values.html);
    form.set("css", values.css);
    form.set("scope", values.scope);
    form.set("isNew", isNew ? "1" : "");
    form.set("prompt", prompt);
    form.set("model", model);
    fetcher.submit(form, { method: "POST" });
  };

  const applyGenerated = (output: string) => {
    const split = splitGeneratedBlock(output);
    setDraft((current) => ({ ...current, html: split.html, css: split.css }));
  };

  const generate = () => {
    if (generation.generating || busy || !prompt.trim() || !availableModels.length) return;
    let values = draft;
    if (isNew && !draft.name.trim()) {
      const name = prompt.trim().slice(0, 40);
      values = { ...draft, name, key: keyEdited ? draft.key : slugifyBlockKey(name) };
      setDraft(values);
    }
    draftBeforeGeneration.current = values;
    setPreviewDraft(values);
    void generation.run(
      {
        kind: "block",
        prompt,
        model,
        scope: values.scope,
        currentHtml: values.html,
        currentCss: values.css,
      },
      {
        onCode: applyGenerated,
        onDone: (output) => {
          applyGenerated(output);
          shopify.toast.show("Block generated.");
        },
        onStop: (partial) => {
          if (partial.trim()) applyGenerated(partial);
          else if (draftBeforeGeneration.current) setDraft(draftBeforeGeneration.current);
          shopify.toast.show(
            partial.trim()
              ? "Generation stopped. The block kept what was written so far."
              : "Generation stopped.",
          );
        },
        onError: (message, partial) => {
          if (partial.trim()) applyGenerated(partial);
          else if (draftBeforeGeneration.current) setDraft(draftBeforeGeneration.current);
          shopify.toast.show(message, { isError: true });
        },
      },
    );
  };

  const remove = () => {
    if (!saved || !window.confirm(`Delete “${saved.name}”? Themes using this Block ID will show nothing.`)) {
      return;
    }
    submit("delete");
  };

  const copyKey = async () => {
    if (!draft.key) return;
    await navigator.clipboard.writeText(draft.key);
    shopify.toast.show("Block ID copied");
  };

  return (
    <s-page heading="AI blocks" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-banner heading="Use AI blocks in the theme customizer" tone="info">
          Create a block here and save it. Then click Add to theme, and enter
          its Block ID in the AI Editor block settings. Blocks work in any
          Online Store 2.0 theme and don&apos;t need theme file access.
        </s-banner>

        <div className={styles.workspace}>
          <header className={styles.toolbar}>
            <div className={styles.toolbarGroup}>
              <span className={styles.panelTitle}>
                {isNew ? "New block" : saved?.name ?? "Block"}
              </span>
              {dirty ? <span className={styles.roleBadge}>Unsaved</span> : null}
            </div>
            <div className={styles.toolbarGroup}>
              <s-button onClick={copyKey} disabled={!draft.key}>
                Copy Block ID
              </s-button>
              <s-button href={addBlockDeepLink(data.apiKey)} target="_blank">
                Add to theme
              </s-button>
              {saved ? (
                <s-button tone="critical" onClick={remove} disabled={busy}>
                  Delete
                </s-button>
              ) : null}
              <s-button
                variant="primary"
                onClick={() => submit("save")}
                {...(pendingIntent === "save" ? { loading: true } : {})}
                disabled={busy || !dirty || !draft.html.trim()}
              >
                Save block
              </s-button>
            </div>
          </header>

          <div className={styles.body}>
            <aside className={styles.explorer} aria-label="Saved blocks">
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Blocks</span>
                <span className={styles.panelMeta}>{data.blocks.length}</span>
              </div>
              <div className={styles.searchBox}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  aria-current={isNew ? "true" : undefined}
                  onClick={newBlock}
                >
                  New block
                </button>
              </div>
              <div className={styles.fileTree}>
                {data.blocks.length ? (
                  data.blocks.map((block) => (
                    <button
                      key={block.key}
                      type="button"
                      className={`${styles.fileButton} ${styles.blockItem}`}
                      aria-current={block.key === selectedKey ? "true" : undefined}
                      onClick={() => selectBlock(block)}
                    >
                      <span className={styles.fileName}>{block.name}</span>
                      <span className={styles.blockKey}>{block.key}</span>
                    </button>
                  ))
                ) : (
                  <p className={styles.emptyState}>
                    No blocks yet. Describe one in the AI assistant to get started.
                  </p>
                )}
              </div>
            </aside>

            <main className={styles.blockMain}>
              <div className={styles.blockFields}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="block-name">
                    Name
                  </label>
                  <input
                    id="block-name"
                    className={styles.input}
                    value={draft.name}
                    placeholder="Summer sale banner"
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      setDraft((current) => ({
                        ...current,
                        name,
                        key: isNew && !keyEdited ? slugifyBlockKey(name) : current.key,
                      }));
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="block-key">
                    Block ID
                  </label>
                  <input
                    id="block-key"
                    className={`${styles.input} ${styles.monoInput}`}
                    value={draft.key}
                    disabled={!isNew}
                    placeholder="summer-sale-banner"
                    onChange={(event) => {
                      const key = sanitizeBlockKeyInput(event.currentTarget.value);
                      setKeyEdited(true);
                      setDraft((current) => ({ ...current, key }));
                    }}
                    onBlur={() =>
                      setDraft((current) => ({ ...current, key: slugifyBlockKey(current.key) }))
                    }
                  />
                </div>
              </div>

              <div className={styles.previewPanel}>
                <div className={styles.previewHeader}>
                  <span className={styles.panelTitle}>Preview</span>
                  <div className={styles.segmented} role="group" aria-label="Preview size">
                    {(["desktop", "mobile"] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={viewport === size}
                        onClick={() => setViewport(size)}
                      >
                        {size === "desktop" ? "Desktop" : "Mobile"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.previewStage}>
                  {draft.html.trim() ? (
                    <iframe
                      title="Block preview"
                      sandbox=""
                      srcDoc={previewDoc}
                      className={styles.previewFrame}
                      data-viewport={viewport}
                    />
                  ) : (
                    <p className={styles.emptyState}>
                      The block preview appears here. Your theme&apos;s fonts and colors
                      are applied on the storefront.
                    </p>
                  )}
                </div>
              </div>

              <div className={styles.blockCode}>
                <div className={styles.tabBar}>
                  <div className={styles.codeTabs} role="tablist">
                    {(["html", "css"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={codeTab === tab}
                        onClick={() => setCodeTab(tab)}
                      >
                        {tab.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  aria-label={codeTab === "html" ? "Block HTML" : "Block CSS"}
                  className={`${styles.codeEditor} ${styles.blockEditor}`}
                  value={codeTab === "html" ? draft.html : draft.css}
                  readOnly={generation.generating}
                  wrap="off"
                  spellCheck={false}
                  placeholder={
                    codeTab === "html"
                      ? "Generated HTML appears here."
                      : `Generated CSS appears here. Selectors start with .${draft.scope}`
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((current) =>
                      codeTab === "html" ? { ...current, html: value } : { ...current, css: value },
                    );
                  }}
                />
              </div>
            </main>

            <aside className={styles.assistant} aria-label="AI assistant">
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>AI assistant</span>
                <span className={styles.panelMeta}>
                  {data.plan === "byok" ? "Your keys" : "Hosted keys"}
                </span>
              </div>
              <div className={styles.assistantBody}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="block-model">
                    Model
                  </label>
                  <select
                    id="block-model"
                    className={styles.select}
                    value={model}
                    disabled={!availableModels.length}
                    onChange={(event) => setModel(event.currentTarget.value)}
                  >
                    {availableModels.length ? (
                      availableModels.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.family}: {item.label}
                        </option>
                      ))
                    ) : (
                      <option value="">No models available</option>
                    )}
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="block-prompt">
                    {draft.html.trim() ? "Describe the change" : "Describe the block"}
                  </label>
                  <textarea
                    id="block-prompt"
                    className={styles.promptInput}
                    rows={7}
                    value={prompt}
                    placeholder={
                      draft.html.trim()
                        ? "e.g. Make the button larger and use a dark background"
                        : "e.g. A countdown banner for our summer sale with a Shop now button"
                    }
                    onChange={(event) => setPrompt(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        generate();
                      }
                    }}
                  />
                </div>

                <div className={styles.chips}>
                  {QUICK_PROMPTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={styles.chip}
                      onClick={() => setPrompt(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <GenerationStatus
                  generating={generation.generating}
                  status={generation.status}
                  preview={generation.preview}
                  elapsedLabel={generation.elapsedLabel}
                />

                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={generation.generating ? generation.cancel : generate}
                  disabled={
                    !generation.generating &&
                    (busy || !availableModels.length || !prompt.trim())
                  }
                >
                  {generation.generating ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" />
                      Stop
                    </>
                  ) : draft.html.trim() ? (
                    "Edit block with AI"
                  ) : (
                    "Generate block"
                  )}
                </button>
                <span className={styles.hint}>
                  {generation.generating
                    ? "The block updates as the model writes. This can take several minutes."
                    : "Ctrl + Enter to run"}
                </span>
              </div>
            </aside>
          </div>
        </div>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
