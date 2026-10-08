import type { App } from "@modelcontextprotocol/ext-apps";

interface UiResponse { status: number; body: string; contentType: string; contentDisposition?: string }

/**
 * Inside ChatGPT there is no HTTP server, so HQFlow's `/api` calls travel over MCP instead.
 * Patching `fetch` keeps the web app's client untouched: the plugin renders the same `App`.
 */
export function installApiBridge(app: App): { push(): void } {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("/api/")) return nativeFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const result = await app.callServerTool({ name: "hqflow_ui_request", arguments: {
      method, path: url, ...(typeof init?.body === "string" ? { body: init.body } : {}),
    } });
    const data = result.structuredContent as unknown as UiResponse | undefined;
    if (result.isError || data === undefined) throw new TypeError("HQFlow could not reach its plugin server.");
    const headers = new Headers({ "content-type": data.contentType });
    if (data.contentDisposition !== undefined) headers.set("content-disposition", data.contentDisposition);
    return new Response(data.status === 204 ? null : data.body, { status: data.status, headers });
  };

  // The web app listens to `/api/events`; here a fresh snapshot is pushed after each tool result.
  const sources = new Set<BridgeEventSource>();
  class BridgeEventSource {
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { sources.add(this); queueMicrotask(() => this.onopen?.()); }
    close() { sources.delete(this); }
  }
  window.EventSource = BridgeEventSource as unknown as typeof EventSource;
  return {
    push() {
      void fetch("/api/state").then((response) => response.text()).then((payload) => {
        const data = `{"type":"snapshot","payload":${payload}}`;
        for (const source of sources) source.onmessage?.(new MessageEvent("message", { data }));
      }).catch(() => undefined);
    },
  };
}
