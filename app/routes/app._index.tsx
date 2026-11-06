import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getBillingState, requirePaidPlan } from "../lib/billing.server";
import { PLAN_PRICES } from "../lib/plans";
import { GenerationStatus } from "../components/generation-status";
import { BillingView } from "./app.billing";
import { useGeneration } from "../lib/use-generation";
import { getShopKeyStatus } from "../lib/shop-settings.server";
import {
  AI_MODELS,
  FILE_TYPES,
  type FileTypeId,
} from "../lib/models";
import {
  defaultThemeFilename,
  fileExtension,
  fileTypeForFilename,
  groupThemeFiles,
  isTextThemeFile,
  preferredTheme,
  previewPathForFilename,
  storefrontPreviewUrl,
  themeEditorAdminPath,
  type ThemeFileNode,
} from "../lib/theme-files";
import {
  ensurePreviewTheme,
  listThemeFiles,
  listThemes,
  loadThemeFile,
  upsertThemeFile,
} from "../lib/theme.server";
import styles from "../styles/editor.module.css";

type ActionData = {
  ok?: boolean;
  intent?: string;
  code?: string;
  error?: string;
  message?: string;
  files?: ThemeFileNode[];
  themeId?: string;
  filename?: string;
  previewUrl?: string;
  needsExemption?: boolean;
};

const QUICK_PROMPTS = [
  "Make this section fully responsive on mobile",
  "Add theme editor settings to the schema",
  "Improve accessibility and semantic HTML",
  "Find and fix bugs in this code",
];

const isExemptionError = (message: string) =>
  /exemption|themeFilesUpsert|themeDuplicate/i.test(message);

const THEME_EXEMPTION_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billingState } = await getBillingState(request);
  const keyStatus = await getShopKeyStatus(session.shop);

  if (!billingState.hasActivePayment || !billingState.plan) {
    return {
      view: "billing" as const,
      billingState,
      keyStatus,
    };
  }

  const themes = await listThemes(admin).catch(() => []);
  const theme = preferredTheme(themes);
  const files = theme
    ? await listThemeFiles(admin, theme.id).catch(() => [])
    : [];
  const requestedFile = new URL(request.url).searchParams.get("file") ?? "";

  return {
    view: "editor" as const,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    plan: billingState.plan,
    subscriptionName: billingState.subscriptionName,
    keyStatus,
    themes,
    files,
    requestedFile: files.some((file) => file.filename === requestedFile) ? requestedFile : "",
    filesThemeId: theme?.id ?? "",
    models: AI_MODELS,
    fileTypes: FILE_TYPES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await requirePaidPlan(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "list-files") {
    const themeId = String(form.get("themeId") || "");
    if (!themeId) {
      return { ok: false, intent, error: "Choose a theme." };
    }
    try {
      const files = await listThemeFiles(admin, themeId);
      return { ok: true, intent, files, themeId };
    } catch (error) {
      return {
        ok: false,
        intent,
        themeId,
        error: error instanceof Error ? error.message : "Could not list theme files.",
      };
    }
  }

  if (intent === "load-file") {
    const themeId = String(form.get("themeId") || "");
    const filename = String(form.get("filename") || "").trim();
    if (!themeId || !filename) {
      return { ok: false, intent, error: "Choose a theme and filename." };
    }
    try {
      const code = await loadThemeFile(admin, themeId, filename);
      if (code === null) {
        return {
          ok: false,
          intent,
          error: `No file named ${filename} was found in this theme.`,
        };
      }
      return { ok: true, intent, code, message: `Loaded ${filename}.` };
    } catch (error) {
      return {
        ok: false,
        intent,
        error: error instanceof Error ? error.message : "Could not load that file.",
      };
    }
  }

  if (intent === "apply-theme") {
    const themeId = String(form.get("themeId") || "");
    const filename = String(form.get("filename") || "").trim();
    const currentCode = String(form.get("currentCode") || "");
    if (!themeId || !filename || !currentCode.trim()) {
      return {
        ok: false,
        intent,
        error: "Theme, filename, and code are required to apply changes.",
      };
    }
    try {
      await upsertThemeFile(admin, themeId, filename, currentCode);
      return {
        ok: true,
        intent,
        filename,
        code: currentCode,
        message: `Saved ${filename} to the selected theme.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const needsExemption = isExemptionError(message);
      return {
        ok: false,
        intent,
        needsExemption,
        error: needsExemption
          ? "Shopify has not approved this app to save theme files yet."
          : message || "Could not write the theme file.",
      };
    }
  }

  if (intent === "preview") {
    const themeId = String(form.get("themeId") || "");
    const filename = String(form.get("filename") || "").trim();
    const currentCode = String(form.get("currentCode") || "");
    const previewPath = String(form.get("previewPath") || "/");
    if (!themeId || !filename || !currentCode.trim()) {
      return {
        ok: false,
        intent,
        error: "Theme, filename, and code are required to preview changes.",
      };
    }
    try {
      const previewTheme = await ensurePreviewTheme(admin, themeId);
      await upsertThemeFile(admin, previewTheme.id, filename, currentCode);
      return {
        ok: true,
        intent,
        previewUrl: storefrontPreviewUrl(session.shop, previewTheme.id, previewPath),
        message: "Preview ready. Your live theme was not changed.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const needsExemption = isExemptionError(message);
      return {
        ok: false,
        intent,
        needsExemption,
        error: needsExemption
          ? "Shopify has not approved this app to write theme files yet, so previews are unavailable."
          : message || "Could not prepare the preview.",
      };
    }
  }

  return { ok: false, error: "Unknown action." };
};

export default function EditorPage() {
  const data = useLoaderData<typeof loader>();
  if (data.view === "billing") {
    return (
      <BillingView billingState={data.billingState} keyStatus={data.keyStatus} />
    );
  }
  return <EditorScreen data={data} />;
}

function shortName(filename: string) {
  const slash = filename.indexOf("/");
  return slash >= 0 ? filename.slice(slash + 1) : filename;
}

function EditorScreen({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof loader>>, { view: "editor" }>;
}) {
  const fetcher = useFetcher<ActionData>();
  const filesFetcher = useFetcher<ActionData>();
  const previewFetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();
  const generation = useGeneration();
  const codeBeforeGeneration = useRef("");
  const initialFilename = data.requestedFile || defaultThemeFilename(data.files);
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const [model, setModel] = useState(data.models[0]?.id ?? "gpt-4o");
  const [fileType, setFileType] = useState<FileTypeId>(
    fileTypeForFilename(initialFilename),
  );
  const [themeId, setThemeId] = useState(
    data.filesThemeId || data.themes[0]?.id || "",
  );
  const [filename, setFilename] = useState(initialFilename);
  const [fileQuery, setFileQuery] = useState("");
  const [themeFiles, setThemeFiles] = useState(data.files);
  const [filesThemeId, setFilesThemeId] = useState(data.filesThemeId);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(["Assets", "Locales"]),
  );
  const [previewPath, setPreviewPath] = useState(
    previewPathForFilename(initialFilename),
  );
  const [previewUrl, setPreviewUrl] = useState("");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const loadedInitialFile = useRef(false);
  const gutterRef = useRef<HTMLPreElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);

  const selectedTheme = data.themes.find((theme) => theme.id === themeId);
  const isLiveTheme = selectedTheme?.role === "MAIN";
  const pendingIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const busy = fetcher.state !== "idle" || filesFetcher.state !== "idle" || generation.generating;
  const previewing = previewFetcher.state !== "idle";
  const dirty = code !== savedCode;
  const canWrite = Boolean(themeId && filename.trim() && code.trim());
  const fileGroups = useMemo(
    () => groupThemeFiles(themeFiles, fileQuery),
    [themeFiles, fileQuery],
  );
  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1).join("\n"),
    [lineCount],
  );
  const language =
    FILE_TYPES.find((item) => item.id === fileTypeForFilename(filename))?.label ?? "Text";

  const availableModels = useMemo(() => {
    if (data.plan === "byok") {
      return data.models.filter((item) =>
        item.provider === "openai"
          ? data.keyStatus.openaiValid
          : data.keyStatus.anthropicValid,
      );
    }
    return data.models;
  }, [
    data.plan,
    data.keyStatus.openaiValid,
    data.keyStatus.anthropicValid,
    data.models,
  ]);

  useEffect(() => {
    if (
      availableModels.length > 0 &&
      !availableModels.some((item) => item.id === model)
    ) {
      setModel(availableModels[0].id);
    }
  }, [availableModels, model]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.ok && result.intent === "load-file") {
      setCode(result.code ?? "");
      setSavedCode(result.code ?? "");
    } else if (result.ok && result.intent === "apply-theme") {
      setSavedCode(result.code ?? "");
    }
    if (result.ok && result.message) {
      shopify.toast.show(result.message);
    }
    if (!result.ok && result.error) {
      shopify.toast.show(result.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    const result = previewFetcher.data;
    if (!result) return;
    if (result.ok && result.previewUrl) {
      setPreviewUrl(result.previewUrl);
      window.open(result.previewUrl, "_blank", "noopener");
      if (result.message) shopify.toast.show(result.message);
      return;
    }
    if (result.error) shopify.toast.show(result.error, { isError: true });
  }, [previewFetcher.data, shopify]);

  const requestedFilesTheme = useRef(data.filesThemeId);

  useEffect(() => {
    if (!themeId || themeId === filesThemeId || requestedFilesTheme.current === themeId) {
      return;
    }
    requestedFilesTheme.current = themeId;
    const form = new FormData();
    form.set("intent", "list-files");
    form.set("themeId", themeId);
    filesFetcher.submit(form, { method: "POST" });
    // filesFetcher.submit is stable for this request; the fetcher object is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, filesThemeId]);

  useEffect(() => {
    if (filesFetcher.data?.intent !== "list-files") return;
    if (filesFetcher.data.themeId && filesFetcher.data.themeId !== themeId) return;
    if (filesFetcher.data.ok && filesFetcher.data.files && filesFetcher.data.themeId) {
      setThemeFiles(filesFetcher.data.files);
      setFilesThemeId(filesFetcher.data.themeId);
      return;
    }
    if (!filesFetcher.data.ok && filesFetcher.data.error) {
      shopify.toast.show(filesFetcher.data.error, { isError: true });
    }
  }, [filesFetcher.data, shopify, themeId]);

  useEffect(() => {
    setPreviewUrl("");
  }, [themeId, filename]);

  useEffect(() => {
    if (!generation.generating || !codeRef.current) return;
    codeRef.current.scrollTop = codeRef.current.scrollHeight;
    if (gutterRef.current) gutterRef.current.scrollTop = codeRef.current.scrollTop;
  }, [code, generation.generating]);

  const submit = (intent: string, nextFilename = filename) => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("prompt", prompt);
    form.set("model", model);
    form.set("fileType", fileTypeForFilename(nextFilename));
    form.set("currentCode", code);
    form.set("themeId", themeId);
    form.set("filename", nextFilename);
    fetcher.submit(form, { method: "POST" });
  };

  const confirmDiscard = () =>
    !dirty || window.confirm(`Discard unsaved changes to ${filename}?`);

  const openFile = (nextFilename: string) => {
    setFilename(nextFilename);
    setFileType(fileTypeForFilename(nextFilename));
    setPreviewPath(previewPathForFilename(nextFilename));
  };

  const chooseFile = (file: ThemeFileNode) => {
    if (generation.generating) {
      shopify.toast.show("Stop the generation before switching files.");
      return;
    }
    if (file.filename === filename && !dirty) return;
    if (!confirmDiscard()) return;
    openFile(file.filename);
    if (!isTextThemeFile(file.filename, file.contentType)) {
      setCode("");
      setSavedCode("");
      shopify.toast.show(
        "This file is an image, font, or other binary file. Choose a text file to load its content.",
        { isError: true },
      );
      return;
    }
    submit("load-file", file.filename);
  };

  const changeTheme = (nextThemeId: string) => {
    if (generation.generating) {
      shopify.toast.show("Stop the generation before switching themes.");
      return;
    }
    if (nextThemeId === themeId || !confirmDiscard()) return;
    setThemeId(nextThemeId);
    setCode("");
    setSavedCode("");
  };

  useEffect(() => {
    if (loadedInitialFile.current || !themeId) return;
    const file = themeFiles.find((item) => item.filename === filename);
    if (!file || !isTextThemeFile(file.filename, file.contentType)) return;
    loadedInitialFile.current = true;
    submit("load-file", file.filename);
    // Load the live theme's default file once, after the editor is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!canWrite || busy) return;
    submit("apply-theme");
  };

  const generate = () => {
    if (generation.generating || busy || !availableModels.length || !prompt.trim()) return;
    codeBeforeGeneration.current = code;
    void generation.run(
      {
        kind: "editor",
        prompt,
        model,
        fileType,
        currentCode: code,
        filename,
        themeId,
      },
      {
        onCode: setCode,
        onDone: (next) => {
          setCode(next);
          shopify.toast.show("Code generated.");
        },
        onStop: (partial) => {
          setCode(partial.trim() ? partial : codeBeforeGeneration.current);
          shopify.toast.show(
            partial.trim()
              ? "Generation stopped. The editor kept what was written so far."
              : "Generation stopped.",
          );
        },
        onError: (message, partial) => {
          setCode(partial.trim() ? partial : codeBeforeGeneration.current);
          shopify.toast.show(message, { isError: true });
        },
      },
    );
  };

  const startPreview = () => {
    if (!canWrite || previewing) return;
    const form = new FormData();
    form.set("intent", "preview");
    form.set("themeId", themeId);
    form.set("filename", filename);
    form.set("currentCode", code);
    form.set("previewPath", previewPath);
    previewFetcher.submit(form, { method: "POST" });
  };

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    shopify.toast.show("Code copied");
  };

  const updateCursor = (element: HTMLTextAreaElement) => {
    const before = element.value.slice(0, element.selectionStart);
    const lines = before.split("\n");
    setCursor({ line: lines.length, column: lines[lines.length - 1].length + 1 });
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
      return;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const element = event.currentTarget;
      const { selectionStart, selectionEnd } = element;
      setCode(code.slice(0, selectionStart) + "  " + code.slice(selectionEnd));
      requestAnimationFrame(() => {
        element.selectionStart = element.selectionEnd = selectionStart + 2;
      });
    }
  };

  const toggleGroup = (category: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const exemptionNeeded =
    fetcher.data?.needsExemption || previewFetcher.data?.needsExemption;
  const actionError = fetcher.data && !fetcher.data.ok ? fetcher.data.error : "";
  const previewError =
    previewFetcher.data && !previewFetcher.data.ok ? previewFetcher.data.error : "";

  return (
    <s-page heading="AI Theme Editor" inlineSize="large">
      <s-stack direction="block" gap="base">
        {data.plan === "byok" && availableModels.length === 0 ? (
          <s-banner heading="API key required" tone="warning">
            Add a ChatGPT key, a Claude key, or both on the API keys page.
            Only models for a saved key appear here.
          </s-banner>
        ) : null}

        {exemptionNeeded ? (
          <s-banner heading="Theme saving needs Shopify approval" tone="warning">
            <s-paragraph>
              The app already has the write_themes scope. Shopify still blocks
              public apps from saving theme files until they approve an
              exemption for AI Editor, client id {data.apiKey}.
              Use that name and client id on the request. Copy the code and open
              the same file in the theme editor until Shopify approves it.
            </s-paragraph>
            <s-link href={THEME_EXEMPTION_URL} target="_blank">
              Request theme file access
            </s-link>
          </s-banner>
        ) : actionError || previewError ? (
          <s-banner heading="Could not complete that action" tone="critical">
            {actionError || previewError}
          </s-banner>
        ) : null}

        <div className={styles.workspace}>
          <header className={styles.toolbar}>
            <div className={styles.toolbarGroup}>
              <label className={styles.fieldLabel} htmlFor="theme-select">
                Theme
              </label>
              <select
                id="theme-select"
                className={styles.select}
                value={themeId}
                disabled={generation.generating}
                onChange={(event) => changeTheme(event.currentTarget.value)}
              >
                {data.themes.length ? (
                  data.themes.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))
                ) : (
                  <option value="">No themes available</option>
                )}
              </select>
              {selectedTheme ? (
                <span
                  className={styles.roleBadge}
                  data-live={isLiveTheme ? "true" : undefined}
                >
                  {isLiveTheme ? "Live" : selectedTheme.role.toLowerCase()}
                </span>
              ) : null}
            </div>

            <div className={styles.toolbarGroup}>
              <s-button onClick={copyCode} disabled={!code}>
                Copy
              </s-button>
              {themeId ? (
                <s-button href={themeEditorAdminPath(themeId, filename)} target="_blank">
                  Theme editor
                </s-button>
              ) : null}
              <s-button
                onClick={startPreview}
                {...(previewing ? { loading: true } : {})}
                disabled={!canWrite || previewing}
              >
                Preview
              </s-button>
              <s-button
                variant="primary"
                onClick={save}
                {...(pendingIntent === "apply-theme" ? { loading: true } : {})}
                disabled={busy || !canWrite || !dirty}
              >
                {isLiveTheme ? "Save to live theme" : "Save"}
              </s-button>
            </div>
          </header>

          <div className={styles.body}>
            <aside className={styles.explorer} aria-label="Theme files">
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Files</span>
                <span className={styles.panelMeta}>{themeFiles.length}</span>
              </div>
              <div className={styles.searchBox}>
                <input
                  type="search"
                  className={styles.input}
                  placeholder="Search files"
                  aria-label="Search files"
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.currentTarget.value)}
                />
              </div>
              <div className={styles.fileTree}>
                {filesFetcher.state !== "idle" && themeId !== filesThemeId ? (
                  <p className={styles.emptyState}>Loading theme files…</p>
                ) : fileGroups.length ? (
                  fileGroups.map((group) => {
                    const open = Boolean(fileQuery.trim()) || !collapsed.has(group.category);
                    return (
                      <section key={group.category}>
                        <button
                          type="button"
                          className={styles.groupButton}
                          aria-expanded={open}
                          onClick={() => toggleGroup(group.category)}
                        >
                          <span className={styles.chevron} aria-hidden="true" />
                          <span>{group.category}</span>
                          <span className={styles.panelMeta}>{group.files.length}</span>
                        </button>
                        {open
                          ? group.files.map((file) => {
                              const isText = isTextThemeFile(file.filename, file.contentType);
                              return (
                                <button
                                  key={file.filename}
                                  type="button"
                                  className={styles.fileButton}
                                  title={file.filename}
                                  aria-current={file.filename === filename ? "true" : undefined}
                                  disabled={fetcher.state !== "idle"}
                                  onClick={() => chooseFile(file)}
                                >
                                  <span
                                    className={styles.fileIcon}
                                    data-ext={isText ? fileExtension(file.filename) : "binary"}
                                    aria-hidden="true"
                                  />
                                  <span className={styles.fileName}>
                                    {shortName(file.filename)}
                                  </span>
                                  {file.filename === filename && dirty ? (
                                    <span className={styles.dirtyDot} aria-label="Unsaved" />
                                  ) : null}
                                </button>
                              );
                            })
                          : null}
                      </section>
                    );
                  })
                ) : (
                  <p className={styles.emptyState}>
                    {themeFiles.length
                      ? "No files match that search."
                      : "No theme files were returned."}
                  </p>
                )}
              </div>
            </aside>

            <main className={styles.editorPane}>
              <div className={styles.tabBar}>
                <div className={styles.tab}>
                  <span
                    className={styles.fileIcon}
                    data-ext={fileExtension(filename)}
                    aria-hidden="true"
                  />
                  <input
                    className={styles.pathInput}
                    aria-label="File path"
                    value={filename}
                    readOnly={generation.generating}
                    spellCheck={false}
                    onChange={(event) => openFile(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (generation.generating) return;
                      if (event.key === "Enter" && filename.trim() && themeId) {
                        submit("load-file");
                      }
                    }}
                  />
                  {dirty ? <span className={styles.dirtyDot} aria-label="Unsaved" /> : null}
                </div>
                <div className={styles.tabActions}>
                  {dirty && savedCode ? (
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setCode(savedCode)}
                    >
                      Revert
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={busy || !themeId || !filename.trim()}
                    onClick={() => confirmDiscard() && submit("load-file")}
                  >
                    {pendingIntent === "load-file" ? "Loading…" : "Reload"}
                  </button>
                </div>
              </div>

              <div className={styles.codeArea}>
                <GenerationStatus
                  generating={generation.generating}
                  status={generation.status}
                  preview={generation.preview}
                  elapsedLabel={generation.elapsedLabel}
                  onCancel={generation.cancel}
                />
                {pendingIntent === "load-file" ? (
                  <div className={styles.overlay}>
                    <span className={styles.spinner} aria-hidden="true" />
                    Loading file…
                  </div>
                ) : null}
                <pre ref={gutterRef} className={styles.gutter} aria-hidden="true">
                  {lineNumbers}
                </pre>
                <textarea
                  id="shopify-code"
                  ref={codeRef}
                  aria-label="Code editor"
                  className={styles.codeEditor}
                  value={code}
                  readOnly={generation.generating}
                  wrap="off"
                  spellCheck={false}
                  placeholder="Pick a file on the left, or describe what you want in the AI assistant."
                  onChange={(event) => {
                    setCode(event.currentTarget.value);
                    updateCursor(event.currentTarget);
                  }}
                  onSelect={(event) => updateCursor(event.currentTarget)}
                  onKeyDown={onEditorKeyDown}
                  onScroll={(event) => {
                    if (gutterRef.current) {
                      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                    }
                  }}
                />
              </div>

              <div className={styles.previewBar}>
                <label className={styles.fieldLabel} htmlFor="preview-path">
                  Preview page
                </label>
                <input
                  id="preview-path"
                  className={`${styles.input} ${styles.previewInput}`}
                  value={previewPath}
                  spellCheck={false}
                  placeholder="/"
                  onChange={(event) => setPreviewPath(event.currentTarget.value)}
                />
                <span className={styles.previewHint}>
                  {previewing
                    ? "Copying your theme and applying this file…"
                    : "Opens your store with this unsaved file applied to a private copy of the theme. The live site is not changed."}
                </span>
                {previewUrl && !previewing ? (
                  <a
                    className={styles.previewLink}
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open last preview
                  </a>
                ) : null}
              </div>

              <footer className={styles.statusBar}>
                <span>{language}</span>
                <span>
                  Ln {cursor.line}, Col {cursor.column}
                </span>
                <span>{lineCount} lines</span>
                <span className={styles.statusSpacer} />
                <span data-state={dirty ? "dirty" : "clean"} className={styles.saveState}>
                  {dirty ? "Unsaved changes" : code ? "Saved" : "No changes"}
                </span>
                <span>Ctrl + S to save</span>
              </footer>
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
                  <label className={styles.fieldLabel} htmlFor="ai-model">
                    Model
                  </label>
                  <select
                    id="ai-model"
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
                  <label className={styles.fieldLabel} htmlFor="ai-file-type">
                    Output type
                  </label>
                  <select
                    id="ai-file-type"
                    className={styles.select}
                    value={fileType}
                    onChange={(event) =>
                      setFileType(event.currentTarget.value as FileTypeId)
                    }
                  >
                    {FILE_TYPES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="ai-prompt">
                    {code.trim() ? "Describe the change" : "Describe what to build"}
                  </label>
                  <textarea
                    id="ai-prompt"
                    className={styles.promptInput}
                    rows={7}
                    value={prompt}
                    placeholder={
                      code.trim()
                        ? "e.g. Add a countdown timer above the product title"
                        : "e.g. A hero section with background image, heading and two buttons"
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

                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={generate}
                  disabled={busy || !availableModels.length || !prompt.trim()}
                >
                  {code.trim() ? "Edit code with AI" : "Generate code"}
                </button>
                <span className={styles.hint}>
                  {generation.generating
                    ? "Writing into the editor. Cancel is on the editor."
                    : "Ctrl + Enter to run"}
                </span>
              </div>
              <div className={styles.assistantFooter}>
                <span>{data.subscriptionName}</span>
                <span>
                  {data.plan === "byok"
                    ? `$${PLAN_PRICES.byok} / 30 days`
                    : `$${PLAN_PRICES.hosted} / 30 days`}
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
