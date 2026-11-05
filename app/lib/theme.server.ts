import { isPreviewThemeName, previewThemeName, type ThemeFileNode } from "./theme-files";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ThemeSummary = {
  id: string;
  name: string;
  role: string;
};

type ThemeDetails = ThemeSummary & {
  createdAt: string;
  updatedAt: string;
  processing: boolean;
};

const THEME_FIELDS = `
  id
  name
  role
  createdAt
  updatedAt
  processing
`;

function graphqlErrors(json: { errors?: { message: string }[] }) {
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(" "));
  }
}

function userErrors(errors: { message: string }[] | undefined) {
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }
}

export async function listThemes(admin: AdminGraphql): Promise<ThemeSummary[]> {
  const response = await admin.graphql(
    `#graphql
      query AiEditorThemes {
        themes(first: 25) {
          nodes {
            id
            name
            role
          }
        }
      }`,
  );
  const json = await response.json();
  const themes = (json.data?.themes?.nodes ?? []) as ThemeSummary[];
  return themes.filter((theme) => !isPreviewThemeName(theme.name));
}

async function getTheme(admin: AdminGraphql, id: string): Promise<ThemeDetails | null> {
  const response = await admin.graphql(
    `#graphql
      query AiEditorTheme($id: ID!) {
        theme(id: $id) {
          ${THEME_FIELDS}
        }
      }`,
    { variables: { id } },
  );
  const json = await response.json();
  graphqlErrors(json);
  return (json.data?.theme ?? null) as ThemeDetails | null;
}

async function findThemeByName(admin: AdminGraphql, name: string) {
  const response = await admin.graphql(
    `#graphql
      query AiEditorThemeByName($names: [String!]) {
        themes(first: 5, names: $names) {
          nodes {
            ${THEME_FIELDS}
          }
        }
      }`,
    { variables: { names: [name] } },
  );
  const json = await response.json();
  graphqlErrors(json);
  const nodes = (json.data?.themes?.nodes ?? []) as ThemeDetails[];
  return nodes.find((theme) => theme.name === name) ?? null;
}

async function duplicateTheme(admin: AdminGraphql, id: string, name: string) {
  const response = await admin.graphql(
    `#graphql
      mutation AiEditorThemeDuplicate($id: ID!, $name: String) {
        themeDuplicate(id: $id, name: $name) {
          newTheme {
            ${THEME_FIELDS}
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id, name } },
  );
  const json = await response.json();
  graphqlErrors(json);
  userErrors(json.data?.themeDuplicate?.userErrors);
  const theme = json.data?.themeDuplicate?.newTheme as ThemeDetails | undefined;
  if (!theme) throw new Error("Shopify did not return the preview theme.");
  return theme;
}

async function deleteTheme(admin: AdminGraphql, id: string) {
  const response = await admin.graphql(
    `#graphql
      mutation AiEditorThemeDelete($id: ID!) {
        themeDelete(id: $id) {
          deletedThemeId
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id } },
  );
  const json = await response.json();
  graphqlErrors(json);
  userErrors(json.data?.themeDelete?.userErrors);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTheme(admin: AdminGraphql, id: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const theme = await getTheme(admin, id);
    if (theme && !theme.processing) return theme;
    await sleep(1500);
  }
  throw new Error(
    "The preview copy of this theme is still being prepared. Try Preview again in a moment.",
  );
}

/**
 * Returns an unpublished copy of the source theme that is safe to write
 * preview changes into. The copy is recreated when the source theme has
 * changed since the copy was made, so previews reflect the latest theme.
 */
export async function ensurePreviewTheme(admin: AdminGraphql, sourceThemeId: string) {
  const source = await getTheme(admin, sourceThemeId);
  if (!source) throw new Error("The selected theme no longer exists.");

  const name = previewThemeName(source.name);
  const existing = await findThemeByName(admin, name);

  if (existing && existing.role !== "MAIN") {
    if (new Date(existing.createdAt) >= new Date(source.updatedAt)) {
      return existing.processing ? waitForTheme(admin, existing.id) : existing;
    }
    await deleteTheme(admin, existing.id);
  }

  const copy = await duplicateTheme(admin, source.id, name);
  return copy.processing ? waitForTheme(admin, copy.id) : copy;
}

export async function listThemeFiles(
  admin: AdminGraphql,
  themeId: string,
): Promise<ThemeFileNode[]> {
  const files: ThemeFileNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const response = await admin.graphql(
      `#graphql
        query AiEditorThemeFiles($id: ID!, $after: String) {
          theme(id: $id) {
            files(first: 250, after: $after) {
              nodes {
                filename
                contentType
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }`,
      { variables: { id: themeId, after } },
    );
    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(
        json.errors.map((error: { message: string }) => error.message).join(" "),
      );
    }

    const connection = json.data?.theme?.files;
    const nodes = (connection?.nodes ?? []) as ThemeFileNode[];
    files.push(
      ...nodes.filter((file) => file.filename).map((file) => ({
        filename: file.filename,
        contentType: file.contentType ?? "",
      })),
    );

    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  return files;
}

export async function loadThemeFile(
  admin: AdminGraphql,
  themeId: string,
  filename: string,
) {
  const response = await admin.graphql(
    `#graphql
      query AiEditorThemeFile($id: ID!, $filenames: [String!]!) {
        theme(id: $id) {
          id
          files(filenames: $filenames) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }`,
    { variables: { id: themeId, filenames: [filename] } },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error: { message: string }) => error.message).join(" "),
    );
  }
  const file = json.data?.theme?.files?.nodes?.[0];
  if (!file) return null;
  return (file.body?.content as string | undefined) ?? "";
}

export type ThemeContext = {
  name: string;
  role: string;
  themeName: string;
  themeVersion: string;
  themeAuthor: string;
  colorSchemes: string[];
  hasColorSchemeGroup: boolean;
  globalSettings: { id: string; type: string }[];
  sections: string[];
  blocks: string[];
  snippets: string[];
};

const CONTEXT_SETTING_TYPES = new Set([
  "color",
  "color_background",
  "color_scheme",
  "color_scheme_group",
  "font_picker",
  "range",
]);
const MAX_CONTEXT_SETTINGS = 60;
const MAX_CONTEXT_FILES = 80;

function parseThemeJson(content: string | undefined) {
  if (!content) return null;
  try {
    return JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
  } catch {
    return null;
  }
}

function baseNames(files: ThemeFileNode[], folder: string) {
  return files
    .filter((file) => file.filename.startsWith(`${folder}/`) && file.filename.endsWith(".liquid"))
    .map((file) => file.filename.slice(folder.length + 1, -".liquid".length))
    .slice(0, MAX_CONTEXT_FILES);
}

/** Compact summary of a theme's design settings and files, used to ground AI generation. */
export async function loadThemeContext(
  admin: AdminGraphql,
  themeId: string,
): Promise<ThemeContext | null> {
  const response = await admin.graphql(
    `#graphql
      query AiEditorThemeContext($id: ID!, $filenames: [String!]!) {
        theme(id: $id) {
          name
          role
          files(filenames: $filenames) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        id: themeId,
        filenames: ["config/settings_schema.json", "config/settings_data.json"],
      },
    },
  );
  const json = await response.json();
  graphqlErrors(json);
  const theme = json.data?.theme;
  if (!theme) return null;

  const contents = new Map<string, string>(
    (theme.files?.nodes ?? []).map((file: { filename: string; body?: { content?: string } }) => [
      file.filename,
      file.body?.content ?? "",
    ]),
  );
  const schema = parseThemeJson(contents.get("config/settings_schema.json"));
  const data = parseThemeJson(contents.get("config/settings_data.json"));

  const groups: any[] = Array.isArray(schema) ? schema : [];
  const info = groups.find((group) => group?.name === "theme_info") ?? {};
  const designSettings = groups
    .flatMap((group) => (Array.isArray(group?.settings) ? group.settings : []))
    .filter((setting: any) => setting?.id && CONTEXT_SETTING_TYPES.has(setting.type))
    .map((setting: any) => ({ id: String(setting.id), type: String(setting.type) }));

  const current =
    typeof data?.current === "string" ? data?.presets?.[data.current] : data?.current;
  const colorSchemes = Object.keys(current?.color_schemes ?? {});

  const files = await listThemeFiles(admin, themeId).catch(() => []);

  return {
    name: String(theme.name ?? ""),
    role: String(theme.role ?? ""),
    themeName: String(info.theme_name ?? ""),
    themeVersion: String(info.theme_version ?? ""),
    themeAuthor: String(info.theme_author ?? ""),
    colorSchemes,
    hasColorSchemeGroup: designSettings.some((setting) => setting.type === "color_scheme_group"),
    globalSettings: designSettings.slice(0, MAX_CONTEXT_SETTINGS),
    sections: baseNames(files, "sections"),
    blocks: baseNames(files, "blocks"),
    snippets: baseNames(files, "snippets"),
  };
}

export async function upsertThemeFile(
  admin: AdminGraphql,
  themeId: string,
  filename: string,
  content: string,
) {
  const response = await admin.graphql(
    `#graphql
      mutation AiEditorThemeFilesUpsert(
        $themeId: ID!
        $files: [OnlineStoreThemeFilesUpsertFileInput!]!
      ) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles {
            filename
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        themeId,
        files: [
          {
            filename,
            body: {
              type: "TEXT",
              value: content,
            },
          },
        ],
      },
    },
  );
  const json = await response.json();
  const payload = json.data?.themeFilesUpsert;
  const errors = payload?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((error: { message: string }) => error.message).join(" "));
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error: { message: string }) => error.message).join(" "));
  }
  return payload?.upsertedThemeFiles?.[0]?.filename as string | undefined;
}
