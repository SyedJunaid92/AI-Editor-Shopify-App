import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const TEMPLATE_FILES: Record<string, string> = {
  product: "templates/product.json",
  collection: "templates/collection.json",
};

/** Landing route for the admin link extensions on product and collection pages. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  const file = TEMPLATE_FILES[params.kind ?? ""];
  return redirect(file ? `/app?file=${encodeURIComponent(file)}` : "/app");
};
