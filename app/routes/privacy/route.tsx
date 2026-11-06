import type { MetaFunction } from "react-router";
import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Privacy policy | Appify AI Editor" },
];

export default function PrivacyPolicy() {
  return (
    <main className={styles.page}>
      <article className={styles.article}>
        <h1>Privacy policy</h1>
        <p className={styles.updated}>Last updated 6 November 2026</p>
        <p>
          Appify AI Editor is a Shopify app that lets merchants create
          storefront blocks with ChatGPT or Claude and place them with a theme
          app block. This policy explains what information the app processes
          and why.
        </p>

        <h2>Information we process</h2>
        <p>When a merchant installs the app, we store:</p>
        <ul>
          <li>The shop domain.</li>
          <li>
            The Shopify session needed to run the app, including the access
            token and, for an online session, the staff member&apos;s name,
            email address, user id, and locale.
          </li>
          <li>
            OpenAI or Anthropic API keys the merchant chooses to save. Keys are
            stored encrypted and are used only to call the matching provider.
          </li>
        </ul>
        <p>
          When a merchant generates or edits a block, the prompt and the current
          block HTML and CSS are sent to OpenAI or Anthropic so the model can
          return the block. We do not save those prompts or block contents in
          our database.
        </p>
        <p>
          Saved AI blocks are stored as metafields on the app installation in
          the merchant&apos;s Shopify shop. The theme app extension renders the
          saved block. The AI Editor reads and writes the theme files the
          merchant opens. Billing is handled by Shopify.
        </p>
        <p>
          The app does not read customer accounts, orders, or other protected
          customer data.
        </p>

        <h2>How we use it</h2>
        <p>We use this information to:</p>
        <ul>
          <li>Install the app and keep the merchant signed in.</li>
          <li>Save the storefront blocks the merchant creates.</li>
          <li>Read and update the theme files the merchant opens in AI Editor.</li>
          <li>Send a prompt to the model the merchant selects.</li>
          <li>Confirm an active app subscription through Shopify billing.</li>
        </ul>

        <h2>Who receives it</h2>
        <p>
          Shopify receives shop, billing, and app-installation data because the
          app runs inside Shopify. OpenAI receives a request when a
          ChatGPT model is selected. Anthropic receives a request when a Claude
          model is selected. Our host and database provider store the session
          and encrypted API keys so the app can run.
        </p>
        <p>We do not sell merchant or staff information.</p>

        <h2>How long we keep it</h2>
        <p>
          Session data and saved API keys are deleted when the app is
          uninstalled. API keys are also removed when the merchant clears them.
          AI blocks remain in the merchant&apos;s Shopify shop until the merchant
          deletes them.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy, or a request to delete app data, can be
          sent to the support email published on the Appify AI Editor listing in
          the Shopify App Store.
        </p>
      </article>
    </main>
  );
}
