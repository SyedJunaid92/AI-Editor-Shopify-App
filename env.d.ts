/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    SHOPIFY_API_KEY?: string;
    SHOPIFY_API_SECRET?: string;
    SHOPIFY_APP_URL?: string;
    SCOPES?: string;
    SHOP_CUSTOM_DOMAIN?: string;
    ENCRYPTION_SECRET?: string;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    DATABASE_URL?: string;
    VERCEL_PROJECT_PRODUCTION_URL?: string;
    REDIS_URL?: string;
    UPSTASH_REDIS_URL?: string;
  }
}
