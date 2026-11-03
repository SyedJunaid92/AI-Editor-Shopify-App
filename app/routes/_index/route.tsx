import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Shopify AI Editor</h1>
        <p className={styles.text}>
          Create and edit Shopify theme code with ChatGPT and Claude, embedded
          in the Shopify admin.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>ChatGPT and Claude</strong>. Choose a model, then generate
            or edit Liquid, JSON templates, JavaScript, CSS, or GraphQL.
          </li>
          <li>
            <strong>Your keys · $75 / month</strong>. Add a ChatGPT key, a
            Claude key, or both, then subscribe through Shopify billing.
          </li>
          <li>
            <strong>Hosted keys · $200 / month</strong>. Use the app&apos;s API
            keys with the same editor, billed as a recurring Shopify charge.
          </li>
        </ul>
      </div>
    </div>
  );
}
