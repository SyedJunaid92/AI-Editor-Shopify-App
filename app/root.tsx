import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && typeof error.data === "string") {
    if (error.data.includes("<script") || error.data.includes("Handling response")) {
      return <div dangerouslySetInnerHTML={{ __html: error.data }} />;
    }
  }

  return (
    <main
      style={{
        fontFamily: "Inter, sans-serif",
        padding: 24,
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: 28, marginTop: 0 }}>AI Editor</h1>
      <p>The app page did not load. Reload AI Editor from the Shopify admin.</p>
    </main>
  );
}
