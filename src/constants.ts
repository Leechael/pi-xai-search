export const XAI_PROVIDER_ID = "xai";
export const XAI_API_BASE = "https://api.x.ai/v1";

/** grok-build web_search synthesis model fallback; override via tool param. */
export const DEFAULT_WEB_SEARCH_MODEL = "grok-4.20-multi-agent";
/** pi-xai xai_x_search default. */
export const DEFAULT_X_SEARCH_MODEL = "grok-4.20-0309-reasoning";

export const SEARCH_TIMEOUT_MS = 300_000;

/** The public web-search API caps each domain filter list at 5 entries. */
export const MAX_WEB_SEARCH_DOMAINS = 5;

/** The xAI x_search tool caps each handle filter list at 20 entries. */
export const MAX_X_SEARCH_HANDLES = 20;
export const USER_AGENT = "pi-xai-search/0.1.0";

export const GROK_CLI_VERSION = "0.2.101";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_TOKEN_AUTH = "xai-grok-cli";
