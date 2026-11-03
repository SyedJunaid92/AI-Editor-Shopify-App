import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import { deleteShopSettings } from "../lib/shop-settings.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await deleteShopSettings(shop);

  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (sessions.length) {
    await sessionStorage.deleteSessions(sessions.map((item) => item.id));
  } else if (session) {
    await sessionStorage.deleteSession(session.id);
  }

  return new Response();
};
