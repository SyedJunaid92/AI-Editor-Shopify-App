import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { PLAN_PRICES } from "../../lib/plans";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shop is present only when Shopify started install or opened the app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app/blocks?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Shopify AI Editor</h1>
        <p className={styles.text}>
          Create storefront sections with ChatGPT and Claude, then place them
          with the AI Editor app block in the Shopify theme editor.
        </p>
        <p className={styles.text}>
          Install AI Editor from the Shopify App Store, or open it from your
          Shopify admin.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>ChatGPT and Claude</strong>. Describe a section. The app
            builds a block you add from the theme editor. Theme files stay
            unchanged.
          </li>
          <li>
            <strong>{`Your keys · $${PLAN_PRICES.byok} / month`}</strong>. Add a ChatGPT key, a
            Claude key, or both, then subscribe through Shopify billing.
          </li>
          <li>
            <strong>{`Hosted keys · $${PLAN_PRICES.hosted} / month`}</strong>. Use the app&apos;s API
            keys with the same editor, billed as a recurring Shopify charge.
          </li>
        </ul>
      </div>
    </div>
  );
}
