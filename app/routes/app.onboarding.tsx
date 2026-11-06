import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { addBlockDeepLink } from "../lib/app-blocks";
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

function isTemplateId(value: string): value is TemplateId {
  return TEMPLATES.some((template) => template.id === value);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const requested = new URL(request.url).searchParams.get("template") || "index";
  const template: TemplateId = isTemplateId(requested) ? requested : "index";

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    template,
  };
};

export default function OnboardingPage() {
  const { apiKey, template: initialTemplate } = useLoaderData<typeof loader>();
  const [template, setTemplate] = useState<TemplateId>(initialTemplate);
  const editorUrl = addBlockDeepLink(apiKey, template);

  return (
    <s-page heading="Add the block to your theme">
      <s-stack direction="block" gap="base">
        <s-section heading="Choose a template">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              The AI Editor block is a theme app extension. It works on Online
              Store 2.0 themes, in any section that accepts app blocks. The app
              does not change theme files.
            </s-paragraph>
            <s-select
              label="Template"
              name="template"
              value={template}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (isTemplateId(next)) setTemplate(next);
              }}
            >
              {TEMPLATES.map((item) => (
                <s-option
                  key={item.id}
                  value={item.id}
                  {...(template === item.id ? { selected: true } : {})}
                >
                  {item.label}
                </s-option>
              ))}
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="Add and configure the block">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              The block can be added to the Home, Product, Collection, Page,
              Blog, Blog post, and Cart templates when that section accepts app
              blocks.
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
                Preview the template before you save the theme editor changes.
              </s-list-item>
            </s-ordered-list>
            <s-button href={editorUrl} target="_blank" variant="primary">
              Add block in the theme editor
            </s-button>
            <s-paragraph>
              Create the Block ID first on the AI blocks page if you do not
              have one yet.
            </s-paragraph>
            <s-link href="/app/blocks">Open AI blocks</s-link>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
