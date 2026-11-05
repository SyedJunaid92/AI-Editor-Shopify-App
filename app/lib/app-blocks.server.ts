import { BLOCKS_NAMESPACE, stripScripts, type AiBlock } from "./app-blocks";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function throwErrors(errors: { message: string }[] | undefined) {
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }
}

function parseBlock(node: { key: string; value: string; updatedAt: string }): AiBlock {
  let value: Partial<AiBlock> = {};
  try {
    value = JSON.parse(node.value);
  } catch {
    value = {};
  }
  return {
    key: node.key,
    name: value.name || node.key,
    html: value.html || "",
    css: value.css || "",
    scope: value.scope || `ai-block-${node.key}`,
    updatedAt: node.updatedAt,
  };
}

async function appInstallation(admin: AdminGraphql) {
  const response = await admin.graphql(
    `#graphql
      query AiEditorAppBlocks($namespace: String!) {
        currentAppInstallation {
          id
          metafields(first: 100, namespace: $namespace) {
            nodes {
              key
              value
              updatedAt
            }
          }
        }
      }`,
    { variables: { namespace: BLOCKS_NAMESPACE } },
  );
  const json = await response.json();
  throwErrors(json.errors);
  const installation = json.data?.currentAppInstallation;
  if (!installation?.id) throw new Error("Could not read the app installation.");
  return installation as {
    id: string;
    metafields: { nodes: { key: string; value: string; updatedAt: string }[] };
  };
}

export async function listBlocks(admin: AdminGraphql): Promise<AiBlock[]> {
  const installation = await appInstallation(admin);
  return installation.metafields.nodes
    .map(parseBlock)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveBlock(
  admin: AdminGraphql,
  block: { key: string; name: string; html: string; css: string; scope: string },
) {
  const installation = await appInstallation(admin);
  const response = await admin.graphql(
    `#graphql
      mutation AiEditorSaveBlock($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            key
            value
            updatedAt
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: installation.id,
            namespace: BLOCKS_NAMESPACE,
            key: block.key,
            type: "json",
            value: JSON.stringify({
              name: block.name,
              html: stripScripts(block.html),
              css: block.css,
              scope: block.scope,
            }),
          },
        ],
      },
    },
  );
  const json = await response.json();
  throwErrors(json.errors);
  throwErrors(json.data?.metafieldsSet?.userErrors);
  const saved = json.data?.metafieldsSet?.metafields?.[0];
  if (!saved) throw new Error("Shopify did not save the block.");
  return parseBlock(saved);
}

export async function deleteBlock(admin: AdminGraphql, key: string) {
  const installation = await appInstallation(admin);
  const response = await admin.graphql(
    `#graphql
      mutation AiEditorDeleteBlock($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields {
            key
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          { ownerId: installation.id, namespace: BLOCKS_NAMESPACE, key },
        ],
      },
    },
  );
  const json = await response.json();
  throwErrors(json.errors);
  throwErrors(json.data?.metafieldsDelete?.userErrors);
}
