import {
  DEFAULT_WEB_SEARCH_MODEL,
  DEFAULT_X_SEARCH_MODEL,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_TOKEN_AUTH,
  GROK_CLI_VERSION,
  SEARCH_TIMEOUT_MS,
  USER_AGENT,
  XAI_API_BASE,
} from "./constants.ts";

export type ResponsesResult = {
  model?: string;
  output?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };
  citations?: string[];
  server_side_tool_usage?: Record<string, number>;
};

const CITATION_GLUE_RE = /((?:https?:\/\/|www\.)[^\s<>\]]+)(\[\[\d+\]\]\([^)]+\))/g;

export function glueCitationSpacing(text: string): string {
  return text.replace(CITATION_GLUE_RE, "$1 $2");
}

export function isGrokCliProxyBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname === "cli-chat-proxy.grok.com";
  } catch {
    return baseUrl.includes("cli-chat-proxy.grok.com");
  }
}

export function xaiRequestHeaders(
  modelId: string,
  baseUrl: string | undefined,
  sessionId?: string | null,
): Record<string, string> {
  if (!isGrokCliProxyBaseUrl(baseUrl)) {
    return { "User-Agent": USER_AGENT };
  }
  const headers: Record<string, string> = {
    "User-Agent": `${GROK_CLI_CLIENT_IDENTIFIER}/${GROK_CLI_VERSION}`,
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-mode": "interactive",
    "x-xai-token-auth": GROK_CLI_TOKEN_AUTH,
    "x-authenticateresponse": "authenticate-response",
    "x-grok-model-override": modelId,
  };
  if (sessionId) headers["x-grok-conv-id"] = sessionId;
  return headers;
}

export function clampPromptCacheKey(key: string | undefined | null, max = 64): string | undefined {
  if (key == null) return undefined;
  const trimmed = String(key).trim();
  if (!trimmed) return undefined;
  const chars = Array.from(trimmed);
  return chars.length <= max ? trimmed : chars.slice(0, max).join("");
}

export function ensurePromptCacheKey(
  body: Record<string, unknown>,
  sessionId?: string | null,
): void {
  const existing = body.prompt_cache_key;
  if (typeof existing === "string") {
    const clamped = clampPromptCacheKey(existing);
    if (clamped) {
      body.prompt_cache_key = clamped;
      return;
    }
    delete body.prompt_cache_key;
  }
  const key = clampPromptCacheKey(sessionId ?? undefined);
  if (key) body.prompt_cache_key = key;
}

export function formatResponseSummary(result: ResponsesResult, title: string): string {
  const items = Array.isArray(result.output) ? result.output : [];
  const textParts: string[] = [];
  const toolCalls: string[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (
          c &&
          typeof c === "object" &&
          (c as { type?: string }).type === "output_text" &&
          typeof (c as { text?: unknown }).text === "string"
        ) {
          textParts.push((c as { text: string }).text);
        }
      }
      continue;
    }
    if (item.type === "web_search_call") {
      const action = item.action as { query?: string; url?: string } | undefined;
      const detail = action?.query
        ? ` "${action.query}"`
        : action?.url
          ? ` ${action.url}`
          : typeof item.name === "string"
            ? ` (${item.name})`
            : "";
      const status = item.status ? ` [${item.status}]` : "";
      toolCalls.push(`- Web search${detail}${status}`);
      continue;
    }
    if (item.type === "x_search_call") {
      const action = item.action as { query?: string } | undefined;
      const detail = action?.query
        ? ` "${action.query}"`
        : typeof item.name === "string"
          ? ` (${item.name})`
          : "";
      const status = item.status ? ` [${item.status}]` : "";
      toolCalls.push(`- X search${detail}${status}`);
    }
  }

  const text = glueCitationSpacing(textParts.join("\n"));
  const toolCallText = toolCalls.join("\n");
  const usage = result.usage
    ? `Tokens: ${result.usage.input_tokens ?? "?"} in / ${result.usage.output_tokens ?? "?"} out`
    : "";
  const reasoning = result.usage?.output_tokens_details?.reasoning_tokens
    ? ` (reasoning: ${result.usage.output_tokens_details.reasoning_tokens})`
    : "";
  const tools = result.server_side_tool_usage
    ? `\nServer-side tools: ${Object.entries(result.server_side_tool_usage)
        .map(([k, v]) => {
          const short = k.replace(/^SERVER_SIDE_TOOL_/, "").toLowerCase();
          return `${short}×${v}`;
        })
        .join(", ")}`
    : "";
  const citations = result.citations?.length
    ? `\n\n**Sources consulted**\n${result.citations.map((url, i) => `${i + 1}. ${url}`).join("\n")}`
    : "";
  const body = [text, toolCallText].filter(Boolean).join("\n\n");
  return `**${title}** (${result.model ?? "unknown"})\n\n${body || "(no text output)"}\n\n${usage}${reasoning}${tools}${citations}`;
}

export async function callXaiResponses(
  apiKey: string,
  body: Record<string, unknown>,
  opts?: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    sessionId?: string | null;
    sendSessionAffinity?: boolean;
  },
): Promise<ResponsesResult> {
  const baseUrl = (opts?.baseUrl ?? XAI_API_BASE).replace(/\/+$/, "");
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const modelId = typeof body.model === "string" ? body.model : "";

  if (opts?.sendSessionAffinity) ensurePromptCacheKey(body, opts.sessionId);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...xaiRequestHeaders(
          modelId,
          baseUrl,
          opts?.sendSessionAffinity ? opts.sessionId : undefined,
        ),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`xAI Responses API HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return (await res.json()) as ResponsesResult;
  } catch (error) {
    if (controller.signal.aborted && opts?.signal?.aborted) {
      throw new Error("Search request cancelled");
    }
    if (controller.signal.aborted) {
      throw new Error(`Search request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}

/** grok-build web_search: Responses + tools web_search. */
export async function runWebSearch(
  apiKey: string,
  params: {
    query: string;
    allowed_domains?: string[];
    model?: string;
  },
  opts?: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    sessionId?: string | null;
  },
): Promise<{ text: string; result: ResponsesResult }> {
  const query = params.query?.trim();
  if (!query) throw new Error("query is required");

  const webSearchTool: Record<string, unknown> = { type: "web_search" };
  if (params.allowed_domains?.length) {
    webSearchTool.filters = { allowed_domains: params.allowed_domains };
  }

  const model = params.model?.trim() || DEFAULT_WEB_SEARCH_MODEL;
  const body: Record<string, unknown> = {
    model,
    input: query,
    tools: [webSearchTool],
    store: false,
    temperature: 0.1,
    top_p: 0.95,
    max_output_tokens: 8192,
  };

  const result = await callXaiResponses(apiKey, body, opts);
  return { text: formatResponseSummary(result, "Web search"), result };
}

/** pi-xai / grok x_search: Responses + tools x_search. */
export async function runXSearch(
  apiKey: string,
  params: {
    query: string;
    from_date?: string;
    to_date?: string;
    model?: string;
  },
  opts?: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    sessionId?: string | null;
  },
): Promise<{ text: string; result: ResponsesResult }> {
  const query = params.query?.trim();
  if (!query) throw new Error("query is required");

  const xSearchTool: Record<string, unknown> = { type: "x_search" };
  if (params.from_date?.trim()) xSearchTool.from_date = params.from_date.trim();
  if (params.to_date?.trim()) xSearchTool.to_date = params.to_date.trim();

  const model = params.model?.trim() || DEFAULT_X_SEARCH_MODEL;
  const body: Record<string, unknown> = {
    model,
    input: [{ role: "user", content: query }],
    tools: [xSearchTool],
    store: false,
  };

  const result = await callXaiResponses(apiKey, body, {
    ...opts,
    sendSessionAffinity: true,
  });
  return { text: formatResponseSummary(result, "X search"), result };
}
