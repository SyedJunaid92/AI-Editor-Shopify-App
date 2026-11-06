import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/** The app home is the AI blocks editor. Theme files are not opened or saved here. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`/app/blocks${url.search}`);
};

export default function AppIndex() {
  return null;
}
