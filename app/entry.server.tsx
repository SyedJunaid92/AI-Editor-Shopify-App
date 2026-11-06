import type { AppLoadContext, EntryContext } from "react-router";
import { handleRequest } from "@vercel/react-router/entry.server";
import "./lib/server-timeouts.server";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default function (
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext?: AppLoadContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  return handleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    loadContext,
  );
}
