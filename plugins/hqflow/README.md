# HQFlow ChatGPT plugin

A local MCP plugin built with [OpenAI MCP Extensions](https://github.com/openai/mcp-extensions).
It reuses HQFlow's workflow schema, source validation, canvas, and step drawer.

## Build and install

From the HQFlow checkout, with Node.js 22+ and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm build:plugin
codex plugin marketplace add .
```

Restart the ChatGPT desktop app and install **HQFlow** from the **HQFlow Plugins**
local marketplace. Build before installing: marketplace installs copy the plugin
directory into a cache. After changing the implementation, rebuild and refresh or
reinstall the cached plugin. No npm package publication is required.

The complete distributable folder is `dist/hqflow-plugin/`. It includes a bundled
Node server, inline UI, authoring guide, skill, manifest, and icon. The build also
populates `plugins/hqflow/dist/` for the repo marketplace. Generated runtime files
are ignored by Git; another checkout must build before installing.

Open **Workflow Library** from the sidebar, enter an absolute repository path, and
select **Connect**. Run `hqflow init` in that repository if it has no `.codehq/`
folder. Ask ChatGPT to map a workflow; source inspection requires the host's file
tools or files you provide. Selection lasts for the MCP process; reconnect after
a restart. `HQFLOW_ROOT` can supply the initial repository path when launching
the server directly.

## MCP capabilities

| Tool | Behavior |
| --- | --- |
| `hqflow_open` | Sidebar/thread library entrypoint; accepts `{}` |
| `hqflow_select_repository` | Select a local repository for this connection |
| `hqflow_list_workflows` | List valid maps and diagnostics |
| `hqflow_get_workflow` | Inspect a map and display its interactive canvas |
| `hqflow_authoring_guide` | Read the existing HQFlow format reference |
| `hqflow_save_workflow` | Validate and atomically save a requested map |
| `search_mentions` | OpenAI workflow search for composer references |

Mention resources resolve through `hqflow://workflows/{id}`. Reads reload from disk
so external agent edits are picked up on refresh. Invalid maps are omitted and
their diagnostics are shown; this plugin does not retain last-valid snapshots.
The existing HQFlow browser app retains its original live watcher behavior.

Only the save tool changes repository files, confined to `.codehq/workflows/`.
It requires an initialized project, limits each write to 1 MiB, rejects schema and
graph errors, checks path containment (including symlinks), and refuses to replace
existing maps unless `overwrite=true`. There is no delete tool. Write actions are
advertised as destructive so the host can apply its approval policy.

## Direct MCP testing

```sh
hqflow mcp --root /absolute/path/to/repository
```

Build HQFlow with `pnpm build` before running the checkout's CLI through
`node dist/node/cli.js mcp --root /absolute/path/to/repository`.
Protocol traffic uses stdout; errors use stderr.

Validation commands in this checkout:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/integration/plugin.test.ts
pnpm exec playwright test tests/e2e/chatgpt-plugin.spec.ts
```

The browser test copies the distributable outside the checkout, starts its real
stdio server without `node_modules`, and exercises repository selection, the
canvas, and source drawer through a simulated MCP Apps host. Installation and
tool selection in a signed-in ChatGPT account need a separate manual check.

For ChatGPT connections outside the local desktop host, use a
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnel)
to the bundled stdio server. This implementation is local-only; it is not a public
HTTPS service and has not been submitted to the public plugin directory.
Read [OpenAI's connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
for tunnel setup and account/workspace availability.

Local storage does not mean that ChatGPT receives no data: tool results and selected
workflow references are sent to the connected host. This server does not upload raw
repository source, call an LLM, or require an OpenAI API key.
