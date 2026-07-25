import assert from "node:assert/strict";
import { describe, it } from "node:test";
import piXaiSearch from "../index.ts";
import { createXaiOAuth } from "../src/auth.ts";
import {
  formatResponseSummary,
  glueCitationSpacing,
  runWebSearch,
  runXSearch,
} from "../src/responses.ts";

describe("responses", () => {
  it("glues citation spacing", () => {
    assert.equal(
      glueCitationSpacing("see https://x.ai.[[1]](https://x.com/a)"),
      "see https://x.ai. [[1]](https://x.com/a)",
    );
  });

  it("formats web_search and x_search tool calls", () => {
    const text = formatResponseSummary(
      {
        model: "grok-4.5",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Hello https://a.com.[[1]](https://a.com)" }],
          },
          { type: "web_search_call", action: { query: "rust async" }, status: "completed" },
          { type: "x_search_call", action: { query: "from:xai" }, status: "completed" },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        citations: ["https://a.com"],
      },
      "Web search",
    );
    assert.match(text, /\*\*Web search\*\*/);
    assert.match(text, /Web search "rust async"/);
    assert.match(text, /X search "from:xai"/);
    assert.match(text, /https:\/\/a\.com\. \[\[1\]\]/);
    assert.match(text, /Sources consulted/);
  });

  it("runWebSearch posts responses with web_search tool", async () => {
    let captured: { url?: string; body?: Record<string, unknown>; auth?: string } = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        auth: new Headers(init?.headers).get("authorization") ?? undefined,
      };
      return new Response(
        JSON.stringify({
          model: "grok-4.20-multi-agent",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "results" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const { text } = await runWebSearch(
      "tok",
      { query: "hello", allowed_domains: ["example.com"] },
      { fetchImpl, sessionId: "session-1" },
    );

    assert.equal(captured.url, "https://api.x.ai/v1/responses");
    assert.equal(captured.auth, "Bearer tok");
    assert.equal(captured.body?.model, "grok-4.20-multi-agent");
    assert.equal(captured.body?.input, "hello");
    assert.equal(captured.body?.prompt_cache_key, undefined);
    assert.equal(captured.body?.store, false);
    const tools = captured.body?.tools as Array<Record<string, unknown>>;
    assert.equal(tools[0]?.type, "web_search");
    assert.deepEqual(tools[0]?.filters, { allowed_domains: ["example.com"] });
    assert.match(text, /results/);
  });

  it("refreshes xAI OAuth credentials through the registered provider", async () => {
    const oauth = createXaiOAuth(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const credentials = await oauth.refreshToken({
      access: "old-access",
      refresh: "old-refresh",
      expires: 0,
    });
    assert.equal(credentials.access, "new-access");
    assert.equal(credentials.refresh, "new-refresh");
  });

  it("registers xAI OAuth and resolves tool auth through the public ModelRegistry API", async () => {
    const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
    const providers: Array<{ name: string; config: Record<string, unknown> }> = [];
    piXaiSearch({
      registerProvider(name: string, config: Record<string, unknown>) {
        providers.push({ name, config });
      },
      registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
        tools.set(tool.name, tool);
      },
    } as never);

    assert.equal(providers[0]?.name, "xai");
    assert.equal(
      typeof (providers[0]?.config.oauth as { refreshToken?: unknown })?.refreshToken,
      "function",
    );

    const providersRead: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: "grok-4.20-multi-agent",
          output: [{ type: "message", content: [{ type: "output_text", text: "result" }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      await tools.get("xai_search")!.execute("call-1", { query: "test" }, undefined, undefined, {
        cwd: process.cwd(),
        sessionManager: { getSessionId: () => "session-1" },
        modelRegistry: {
          async getApiKeyForProvider(provider: string) {
            providersRead.push(provider);
            return "xai-access";
          },
        },
      });
    } finally {
      globalThis.fetch = previousFetch;
    }

    assert.deepEqual(providersRead, ["xai"]);
  });

  it("runXSearch posts responses with x_search tool", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "grok-4.20-0309-reasoning",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "tweets" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const { text } = await runXSearch(
      "tok",
      { query: "ai", from_date: "2025-01-01", to_date: "2025-02-01" },
      { fetchImpl, sessionId: "session-2" },
    );

    assert.equal(body.model, "grok-4.20-0309-reasoning");
    assert.equal(body.prompt_cache_key, "session-2");
    const tools = body.tools as Array<Record<string, unknown>>;
    assert.equal(tools[0]?.type, "x_search");
    assert.equal(tools[0]?.from_date, "2025-01-01");
    assert.equal(tools[0]?.to_date, "2025-02-01");
    assert.match(text, /tweets/);
  });
});
