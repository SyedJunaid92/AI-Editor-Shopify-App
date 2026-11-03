import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "./crypto.server";

export async function getShopSettings(shop: string) {
  return prisma.shopSettings.findUnique({ where: { shop } });
}

export async function getShopKeyStatus(shop: string) {
  const settings = await getShopSettings(shop);
  return {
    openaiValid: Boolean(settings?.openaiValid && settings.openaiKeyEnc),
    anthropicValid: Boolean(
      settings?.anthropicValid && settings.anthropicKeyEnc,
    ),
    byokReady: Boolean(
      (settings?.openaiValid && settings.openaiKeyEnc) ||
        (settings?.anthropicValid && settings.anthropicKeyEnc),
    ),
  };
}

export async function saveValidatedKeys(
  shop: string,
  keys: { openaiKey?: string; anthropicKey?: string },
) {
  const openaiKey = keys.openaiKey?.trim();
  const anthropicKey = keys.anthropicKey?.trim();
  const update: {
    openaiKeyEnc?: string;
    anthropicKeyEnc?: string;
    openaiValid?: boolean;
    anthropicValid?: boolean;
  } = {};
  if (openaiKey) {
    update.openaiKeyEnc = encryptSecret(openaiKey);
    update.openaiValid = true;
  }
  if (anthropicKey) {
    update.anthropicKeyEnc = encryptSecret(anthropicKey);
    update.anthropicValid = true;
  }

  return prisma.shopSettings.upsert({
    where: { shop },
    create: {
      shop,
      openaiKeyEnc: openaiKey ? encryptSecret(openaiKey) : null,
      anthropicKeyEnc: anthropicKey ? encryptSecret(anthropicKey) : null,
      openaiValid: Boolean(openaiKey),
      anthropicValid: Boolean(anthropicKey),
    },
    update,
  });
}

export async function getDecryptedShopKeys(shop: string) {
  const settings = await getShopSettings(shop);
  const openaiKey =
    settings?.openaiValid && settings.openaiKeyEnc
      ? decryptSecret(settings.openaiKeyEnc)
      : "";
  const anthropicKey =
    settings?.anthropicValid && settings.anthropicKeyEnc
      ? decryptSecret(settings.anthropicKeyEnc)
      : "";
  if (!openaiKey && !anthropicKey) return null;

  return { openaiKey, anthropicKey };
}

export async function deleteShopSettings(shop: string) {
  await prisma.shopSettings.deleteMany({ where: { shop } });
}
