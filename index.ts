import { Type } from "typebox";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createXaiOAuth } from "./src/auth.ts";
import { XAI_PROVIDER_ID } from "./src/constants.ts";
import { runWebSearch, runXSearch } from "./src/responses.ts";

async function requireXaiApiKey(ctx: ExtensionContext): Promise<string> {
  const apiKey = await ctx.modelRegistry.getApiKeyForProvider(XAI_PROVIDER_ID);
  if (!apiKey) {
    throw new Error("Missing xai credentials. Run `/login xai`.");
  }
  return apiKey;
}

function sessionIdOf(ctx: { sessionManager?: { getSessionId?: () => string } }): string | null {
  try {
    return ctx.sessionManager?.getSessionId?.() ?? null;
  } catch {
    return null;
  }
}

export default function piXaiSearch(pi: ExtensionAPI): void {
  pi.registerProvider(XAI_PROVIDER_ID, { oauth: createXaiOAuth() });

  pi.registerTool(
    defineTool({
      name: "xai_search",
      label: "xai_search",
      description:
        "Search the web for up-to-date information via xAI Responses API built-in web_search (Grok). Uses Pi xai OAuth. Optional allowed_domains / excluded_domains filter (mutually exclusive, max 5 each). Optional model override. Output ends with a deduplicated source URL list harvested from url_citation annotations.",
      parameters: Type.Object({
        query: Type.String({ description: "The search query to perform." }),
        allowed_domains: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description:
              "Optional list of domains to restrict search to. Mutually exclusive with excluded_domains; max 5 entries.",
          }),
        ),
        excluded_domains: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description:
              "Optional list of domains to exclude from search results. Mutually exclusive with allowed_domains; max 5 entries.",
          }),
        ),
        model: Type.Optional(
          Type.String({
            description:
              "Optional xAI model override for the search call (default grok-4.20-multi-agent).",
          }),
        ),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        try {
          const apiKey = await requireXaiApiKey(ctx);
          const { text, result } = await runWebSearch(
            apiKey,
            {
              query: params.query,
              allowed_domains: params.allowed_domains,
              excluded_domains: params.excluded_domains,
              model: params.model,
            },
            { signal, sessionId: sessionIdOf(ctx) },
          );
          return {
            content: [{ type: "text", text }],
            details: { tool: "xai_search", result },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: message }],
            details: { error: message },
            isError: true,
          };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "tweet_search",
      label: "tweet_search",
      description:
        "Search X (Twitter) via xAI Responses API built-in x_search (live posts + citations). Uses Pi xai OAuth. Replies quote key posts verbatim with the post URL after each quote, followed by a deduplicated source URL list. Optional from_date/to_date (strict YYYY-MM-DD UTC; from_date inclusive, to_date EXCLUSIVE at 00:00 UTC of that day — use tomorrow's date to include today). Optional allowed_x_handles / excluded_x_handles (mutually exclusive, max 20 each). Optional enable_image_understanding / enable_video_understanding. Optional model override.",
      parameters: Type.Object({
        query: Type.String({ description: "X search query." }),
        from_date: Type.Optional(
          Type.String({
            description: "Filter posts on or after this date (strict YYYY-MM-DD, UTC, inclusive).",
          }),
        ),
        to_date: Type.Optional(
          Type.String({
            description:
              "Filter posts before this date (strict YYYY-MM-DD, UTC, EXCLUSIVE at 00:00 UTC — pass tomorrow's date to include today).",
          }),
        ),
        allowed_x_handles: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description:
              "Optional list of X handles to restrict search to. Mutually exclusive with excluded_x_handles; max 20 entries.",
          }),
        ),
        excluded_x_handles: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            description:
              "Optional list of X handles to exclude from search results. Mutually exclusive with allowed_x_handles; max 20 entries.",
          }),
        ),
        enable_image_understanding: Type.Optional(
          Type.Boolean({ description: "Let xAI analyze images attached to matching posts." }),
        ),
        enable_video_understanding: Type.Optional(
          Type.Boolean({ description: "Let xAI analyze videos attached to matching posts." }),
        ),
        model: Type.Optional(
          Type.String({
            description:
              "Optional xAI model override for the search call (default grok-4.20-0309-reasoning).",
          }),
        ),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        try {
          const apiKey = await requireXaiApiKey(ctx);
          const { text, result } = await runXSearch(
            apiKey,
            {
              query: params.query,
              from_date: params.from_date,
              to_date: params.to_date,
              allowed_x_handles: params.allowed_x_handles,
              excluded_x_handles: params.excluded_x_handles,
              enable_image_understanding: params.enable_image_understanding,
              enable_video_understanding: params.enable_video_understanding,
              model: params.model,
            },
            { signal, sessionId: sessionIdOf(ctx) },
          );
          return {
            content: [{ type: "text", text }],
            details: { tool: "tweet_search", result },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: message }],
            details: { error: message },
            isError: true,
          };
        }
      },
    }),
  );
}
