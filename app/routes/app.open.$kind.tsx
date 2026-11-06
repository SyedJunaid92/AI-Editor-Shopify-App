import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const TEMPLATES = new Set(["product", "collection"]);

/** Admin links open theme setup so the merchant adds the app block. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  const template = TEMPLATES.has(params.kind ?? "") ? params.kind : "index";
  const url = new URL(request.url);
  url.searchParams.set("template", template ?? "index");
  return redirect(`/app/onboarding?${url.searchParams.toString()}`);
};
