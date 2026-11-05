import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { addBlockDeepLink } from "../lib/app-blocks";
import { preferredTheme } from "../lib/theme-files";
import { listThemes, themeSupportsAppBlocks } from "../lib/theme.server";
import { authenticate } from "../shopify.server";

const TEMPLATES = [
  { id: "index", label: "Home page" },
  { id: "product", label: "Product" },
  { id: "collection", label: "Collection" },
  { id: "page", label: "Page" },
  { id: "blog", label: "Blog" },
  { id: "article", label: "Blog post" },
  { id: "cart", label: "Cart" },
] as const;

type TemplateId = (typeof TEMPLATES)[number]["id"];

type SetupResult = {
  themeId: string;
  template: TemplateId;
  supported: boolean;
  editorUrl: string;
};

function isTemplateId(value: string): value is TemplateId {
  return TEMPLATES.some((template) => template.id === value);
}

function themeLabel(role: string) {
  if (role === "MAIN") return "Live";
  return role.toLowerCase();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const themes = await listThemes(admin);
  const theme = preferredTheme(themes);
  const template: TemplateId = "index";
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const supported = theme ? await themeSupportsAppBlocks(admin, theme.id) : false;

  return {
    themes,
    initial: theme
      ? {
          themeId: theme.id,
          template,
          supported,
          editorUrl: addBlockDeepLink(apiKey, template, theme.id),
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const themeId = String(form.get("themeId") || "");
  const templateValue = String(form.get("template") || "index");
  const template: TemplateId = isTemplateId(templateValue) ? templateValue : "index";
  const themes = await listThemes(admin);
  const theme = themes.find((item) => item.id === themeId);
  if (!theme) {
    return { ok: false as const, error: "Choose a theme from this store." };
  }

  const supported = await themeSupportsAppBlocks(admin, theme.id);
  const result: SetupResult = {
    themeId: theme.id,
    template,
    supported,
    editorUrl: addBlockDeepLink(process.env.SHOPIFY_API_KEY || "", template, theme.id),
  };
  return { ok: true as const, result };
};

export default function OnboardingPage() {
  const { themes, initial } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const setup = actionData && "result" in actionData ? actionData.result : initial;
  const error = actionData && "error" in actionData ? actionData.error : "";

  return (
    <s-page heading="Add the block to your theme">
      <s-stack direction="block" gap="base">
        <s-section heading="Choose a theme">
          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                App blocks work on Online Store 2.0 themes. Pick the theme you
                want to edit, then the template where the block should appear.
              </s-paragraph>
              {themes.length ? (
                <s-select label="Theme" name="themeId">
                  {themes.map((theme) => (
                    <s-option
                      key={theme.id}
                      value={theme.id}
                      {...(setup?.themeId === theme.id ? { selected: true } : {})}
                    >
                      {theme.name} ({themeLabel(theme.role)})
                    </s-option>
                  ))}
                </s-select>
              ) : (
                <s-banner heading="No themes found" tone="warning">
                  This store has no themes to edit yet.
                </s-banner>
              )}
              <s-select label="Template" name="template">
                {TEMPLATES.map((template) => (
                  <s-option
                    key={template.id}
                    value={template.id}
                    {...(setup?.template === template.id ? { selected: true } : {})}
                  >
                    {template.label}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})} disabled={busy || !themes.length}>
                Show setup
              </s-button>
            </s-stack>
          </Form>
        </s-section>

        {error ? (
          <s-banner heading="Could not check that theme" tone="critical">
            {error}
          </s-banner>
        ) : null}

        {setup && !setup.supported ? (
          <s-banner heading="This theme is not supported" tone="warning">
            The selected theme does not include Online Store 2.0 JSON templates,
            so the AI Editor block cannot be added. Choose another theme.
          </s-banner>
        ) : null}

        {setup?.supported ? (
          <s-section heading="Add and configure the block">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                The AI Editor block can be added to sections on the Home,
                Product, Collection, Page, Blog, Blog post, and Cart templates
                when that section accepts app blocks.
              </s-paragraph>
              <s-ordered-list>
                <s-list-item>
                  Open the theme editor. The button below adds the AI Editor
                  block to the template you selected.
                </s-list-item>
                <s-list-item>
                  Drag the block to reorder it. Remove it from the section
                  sidebar to take it off the page.
                </s-list-item>
                <s-list-item>
                  In the block settings, paste a Block ID from AI blocks, then
                  set the top and bottom padding.
                </s-list-item>
                <s-list-item>
                  Preview the template before you save and publish the theme.
                </s-list-item>
              </s-ordered-list>
              <s-button href={setup.editorUrl} target="_blank" variant="primary">
                Add block in the theme editor
              </s-button>
              <s-paragraph>
                Create the Block ID first on the AI blocks page if you do not
                have one yet.
              </s-paragraph>
              <s-link href="/app/blocks">Open AI blocks</s-link>
            </s-stack>
          </s-section>
        ) : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
