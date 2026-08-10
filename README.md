# HubSpot MCP Server

Production-grade [Model Context Protocol](https://modelcontextprotocol.io) server exposing HubSpot to **Microsoft Copilot Studio**, over Streamable HTTP, deployed to **Azure App Service**.

> **Scope:** complete and administrative. Contacts, Companies, and Deals are covered end to end — read, search, create, update, archive, permanent erasure, merge, restore, bulk operations, associations, activity logging, timelines, pipelines, and portal property administration — exposed through **14 tools**, because object type is a parameter rather than part of a tool's name.

---

## Contents

- [Why it is built this way](#why-it-is-built-this-way)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [HTTP surface](#http-surface)
- [Tools](#tools)
- [Connecting to Copilot Studio](#connecting-to-copilot-studio)
- [Deploying to Azure App Service](#deploying-to-azure-app-service)
- [Testing](#testing)
- [Extending the catalogue](#extending-the-catalogue)

---

## Why it is built this way

Four decisions shape everything else.

**Streamable HTTP only.** Copilot Studio supports exactly one MCP transport, and [dropped SSE after August 2025](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-existing-server-to-agent#supported-transports). There is no stdio or SSE fallback here, because shipping one would only create a path that cannot reach production.

**Stateless sessions by default.** App Service scales out, recycles workers, and swaps slots. In stateful mode a follow-up request that lands on a different instance gets a 404 unless ARR affinity is enabled. Stateless mode makes every instance able to serve every request. Stateful remains available (`MCP_SESSION_MODE=stateful`) for when a future tool genuinely needs continuity.

**Configuration is validated before anything is constructed.** `src/config/env.schema.ts` is the only place `process.env` is read. If it is invalid the process exits with a message naming the offending variable. A server running on half-valid configuration is more dangerous than one that never started — so, for example, `MCP_AUTH_ENABLED=false` is _refused_ when `NODE_ENV=production`.

**Failures are typed, not stringly.** Every failure becomes an `AppError` carrying `httpStatus`, `retryable`, and `expose`. That last flag is what lets the retry middleware, circuit breaker, and HTTP layer all make correct decisions without any of them knowing what HubSpot is — and guarantees an internal stack trace can never surface in a Copilot Studio conversation.

---

## Architecture

```
src/
├─ config/       Zod env schema + loader        → the only reader of process.env
├─ types/        Shared type vocabulary          → types only, no runtime values
├─ utils/        Errors, logger, async, redaction, request context
├─ middleware/   Retry, rate limiter, circuit breaker, auth, error handler
├─ auth/         TokenProvider seam: private app + OAuth strategies
├─ clients/      HubSpot API gateway + error mapper
├─ services/     CRM record router, associations, engagements, properties, health
├─ schemas/      Zod contracts → become JSON Schema in tools/list
├─ tools/        Tool registry + the 14 tool definitions
├─ container/    DI composition root
├─ server/       MCP server, transport manager, Fastify app, routes, lifecycle
└─ tests/        Vitest unit + integration suites
```

Dependencies point inward: `server → tools → services → clients → auth → config`. Nothing in `services` or `tools` imports Fastify or the MCP SDK, which is why they are testable without a network or a transport.

### Dependency injection

A plain, fully-typed composition root (`src/container/composition-root.ts`) — not a decorator/`reflect-metadata` container. Reflection-based IoC moves wiring errors from compile time to run time and obscures the graph; neither is wanted in a service whose job is to start fast and fail loudly. What is kept is the part that matters: nothing constructs its own collaborators, every dependency arrives by constructor, and every seam is an interface.

### Resilience composition

All outbound HubSpot traffic flows through `HubSpotClient` in this order:

```
circuit breaker         one decision per logical call
  └─ retry              backoff + full jitter, honours Retry-After
       └─ rate limiter  one token per attempt
            └─ timeout  per-attempt deadline
                 └─ HubSpot SDK
```

The **breaker sits outside retry** deliberately. Inside, an open breaker raises a retryable error and the retry loop would immediately spin against it, burning the entire budget to rediscover a decision already made. The **rate limiter sits inside retry**, because a retry is a real request against the HubSpot quota.

Only _upstream_ faults trip the breaker. A 401 from a bad token or a 400 from bad input is our fault, not HubSpot's — tripping on those would take the integration down over a caller's typo.

---

## Getting started

Requires **Node.js 22 LTS** (or newer).

```bash
npm install
cp .env.example .env      # then set HUBSPOT_PRIVATE_APP_TOKEN and MCP_API_KEY
npm run dev
```

Verify it:

```bash
curl http://localhost:8080/health
curl -H "x-api-key: $MCP_API_KEY" http://localhost:8080/ping/hubspot

# MCP handshake
curl -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "x-api-key: $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Scripts

| Script                            | Purpose                 |
| --------------------------------- | ----------------------- |
| `npm run dev`                     | Watch mode via `tsx`    |
| `npm run build`                   | Compile to `dist/`      |
| `npm start`                       | Run the compiled server |
| `npm run typecheck`               | `tsc --noEmit`          |
| `npm run lint`                    | ESLint, type-aware      |
| `npm run format` / `format:check` | Prettier                |
| `npm test` / `test:coverage`      | Vitest                  |
| `npm run verify`                  | Everything CI runs      |

---

## Configuration

Every variable, its default, and its rationale is documented in [`.env.example`](.env.example). The essentials:

| Variable                                           | Default       | Notes                                                    |
| -------------------------------------------------- | ------------- | -------------------------------------------------------- |
| `HUBSPOT_AUTH_MODE`                                | `private_app` | `private_app` or `oauth`                                 |
| `HUBSPOT_PRIVATE_APP_TOKEN`                        | —             | Required in `private_app` mode                           |
| `HUBSPOT_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | —             | Required in `oauth` mode                                 |
| `MCP_API_KEY`                                      | —             | Inbound key; min 32 chars; required unless auth disabled |
| `MCP_API_KEY_HEADER`                               | `x-api-key`   | Must match the Copilot Studio wizard                     |
| `MCP_SESSION_MODE`                                 | `stateless`   | `stateful` needs ARR affinity                            |
| `MCP_ENABLE_JSON_RESPONSE`                         | `true`        | Keep `true` for Copilot Studio                           |
| `PORT`                                             | `8080`        | App Service injects this                                 |

Cross-field rules enforced at startup: OAuth mode requires all three OAuth credentials; `MCP_AUTH_ENABLED=false` is rejected in production; `RETRY_MAX_DELAY_MS` must be ≥ `RETRY_INITIAL_DELAY_MS`.

### Authentication: two independent layers

These are frequently conflated. They are unrelated:

- **Inbound** — how Copilot Studio proves itself to _this server_: an API key header, timing-safe compared.
- **Outbound** — how this server proves itself to _HubSpot_: a private app token or OAuth refresh flow, behind the `HubSpotTokenProvider` interface.

Under OAuth, refreshes are **single-flight**: dozens of concurrent tool calls at expiry share one refresh instead of stampeding HubSpot and racing over a rotated refresh token. Tokens renew `HUBSPOT_TOKEN_REFRESH_MARGIN_SECONDS` early so none expires mid-request.

---

## HTTP surface

| Method                | Path                      | Auth    | Purpose                                                  |
| --------------------- | ------------------------- | ------- | -------------------------------------------------------- |
| `POST`/`GET`/`DELETE` | `/mcp`                    | API key | MCP Streamable HTTP endpoint                             |
| `GET`                 | `/health`, `/health/live` | none    | Liveness — **use this for the App Service health check** |
| `GET`                 | `/health/ready`           | none    | Readiness + circuit breaker / limiter state              |
| `GET`                 | `/ping/hubspot`           | API key | Live HubSpot probe (503 on failure)                      |
| `GET`                 | `/ping/hubspot/details`   | API key | Full connection report                                   |
| `GET`                 | `/`                       | API key | Service descriptor                                       |

**Point the App Service health check at `/health`, never at `/ping/hubspot`.** `/health` answers from process state alone. A probe that calls HubSpot would mark every instance unhealthy during a HubSpot outage, so the platform would recycle healthy workers and turn a partial degradation into a full outage.

Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` and always carry a `requestId` that matches the logs.

---

## Tools

Fourteen tools, all full-privilege. **Object type is a parameter, not part of the tool name** — `objectType: "contacts" | "companies" | "deals"`.

| Tool                          | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `hubspot_diagnostics`         | Credential + connectivity check, server identity, remediation guidance |
| `hubspot_get_record`          | Read one record by ID, or by a unique property such as email           |
| `hubspot_search_records`      | Filtered / free-text search, or a plain listing when given no criteria |
| `hubspot_create_record`       | Create a record, optionally with associations in the same request      |
| `hubspot_update_record`       | Patch properties — including deal stage and pipeline moves             |
| `hubspot_delete_record`       | Archive (recoverable) or permanently erase (GDPR, gated)               |
| `hubspot_restore_record`      | Recreate a record from its archived snapshot (gated)                   |
| `hubspot_merge_records`       | Merge duplicates into a surviving primary (gated)                      |
| `hubspot_batch_records`       | Bulk create / read / update / archive, up to 100 per call              |
| `hubspot_manage_associations` | List, create, and remove links between records                         |
| `hubspot_create_engagement`   | Log a note, task, call, meeting, or email on a record                  |
| `hubspot_get_timeline`        | Merged activity feed for a record                                      |
| `hubspot_manage_properties`   | Portal property administration + property value history                |
| `hubspot_list_pipelines`      | Pipelines and stage IDs — the prerequisite for moving a deal           |

### Why fourteen and not eighty

The catalogue previously carried 80 tools: `hubspot_get_contact`, `hubspot_get_company`, and `hubspot_get_deal` were three names for one HubSpot endpoint, and the same triplication ran through create, update, search, list, archive, delete, restore, merge, four batch operations, three association operations, and five activity types.

That is expensive in the place it is least visible. Every tool's name, description, and full JSON Schema is re-sent to the Copilot Studio orchestrator on **every request**, and the model ranks all of them before it can act:

|                         | Before  | After   |
| ----------------------- | ------- | ------- |
| Tools                   | 80      | 14      |
| `tools/list` payload    | ~175 KB | ~44 KB  |
| Approx. tokens per turn | ~44,800 | ~11,200 |

Near-duplicate entries also degrade selection accuracy — three tools competing for one intent, where a wrong pick costs a full round trip to discover. HubSpot's own v3/v4 APIs are a single surface parameterized by object type, so mirroring that removed the duplication without removing a single operation.

Three further latency choices fall out of the same reasoning:

- **Empty properties are dropped from responses by default.** HubSpot echoes every requested property including the null ones, which on a typical record is more than half of them. `includeEmptyProperties: true` opts back in.
- **Tool results are serialized compactly**, not pretty-printed. The only consumer is a model; indentation was pure token cost on every call.
- **`hubspot_search_records` routes itself.** With no criteria it uses HubSpot's list endpoint — cheaper, and in a separate rate-limit bucket from search — so no separate list tool is needed.

### Destructive operations

This is an administrative surface: permanent deletion, merges, bulk archive, and property-definition deletion are all reachable. Each is gated behind an explicit literal-`true` confirmation field in its schema, so none can be triggered by paraphrase alone. Reversible operations — archiving a record, removing an association — are deliberately **not** gated; gating a recoverable action only trains a model to set every flag it sees.

`hubspot_diagnostics` **does not throw when HubSpot is unhealthy** — it returns a successful call reporting `status: "unauthorized" | "unreachable" | "degraded"` plus the action to take. A diagnostic tool that fails when the thing it diagnoses is down hides the answer precisely when it is needed.

Tool failures are returned as MCP `isError` results, not JSON-RPC errors. This is deliberate: a JSON-RPC error is a protocol fault the model never sees, whereas an `isError` result is handed to the model, which can then explain the problem or try something else.

---

## Connecting to Copilot Studio

**Recommended — the MCP onboarding wizard:**

1. In your agent: **Tools → Add a tool → New tool → Model Context Protocol**.
2. **Server URL**: `https://<your-app>.azurewebsites.net/mcp`
3. **Authentication**: _API key_ → Type **Header** → name `x-api-key` (or your `MCP_API_KEY_HEADER`).
4. **Create**, then create a connection and **Add to agent**.

Write the server description carefully — the agent orchestrator uses it to decide whether to call this server at all.

**Alternative — Power Apps custom connector:** import [`docs/copilot-studio-connector.yaml`](docs/copilot-studio-connector.yaml) after replacing `host`. It must stay Swagger 2.0 with `x-ms-agentic-protocol: mcp-streamable-1.0`; without that extension the connector is imported as a plain REST action and no tools are discovered.

> MCP access in Copilot Studio runs through Power Platform connectors, so any DLP policy governing connectors also governs this server.

---

## Deploying to Azure App Service

Target: **App Service on Linux, Node 22 LTS**.

Required App Settings:

```
NODE_ENV=production
HUBSPOT_AUTH_MODE=private_app
HUBSPOT_PRIVATE_APP_TOKEN=<from Key Vault reference>
MCP_API_KEY=<from Key Vault reference>
LOG_PRETTY=false
```

Store secrets as [Key Vault references](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references) rather than literal settings.

Platform configuration:

- **Startup command**: `node dist/index.js` — set explicitly by the deploy workflow on every run; no need to also set it in the Portal
- **Health check path**: `/health`
- **Always On**: enabled (prevents cold-start probe failures)
- **SCM Basic Auth Publishing Credentials**: enabled (Configuration → General settings) — required for the publish-profile deploy below; Azure defaults this to off on newer plans
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` — **required**, not optional: the workflow ships a prebuilt artifact (`dist/` + pruned `node_modules` only, no `src/`), so if Oryx tries to rebuild on top of it there is nothing left to build and the deploy fails

The [deploy workflow](.github/workflows/main_hubspotmcp.yml) runs on every push to `main`: typecheck, lint, test, build, prune dev dependencies, deploy via publish profile, then smoke-test `/health` before going green. The publish profile is stored as the `AZUREAPPSERVICE_PUBLISHPROFILE_*` repository secret that Azure Portal's Deployment Center creates when you connect the App Service to this repo.

Deploy to a **staging slot and swap** for zero-downtime releases and instant rollback.

On `SIGTERM`, shutdown drains in order: fail readiness → close the listener so in-flight requests finish → close MCP sessions → release resources, all bounded by `HTTP_SHUTDOWN_TIMEOUT_MS`.

---

## Testing

```bash
npm test              # 219 tests
npm run test:coverage
```

Unit tests cover retry/backoff semantics, circuit breaker state transitions, token-bucket fairness and refill, OAuth single-flight refresh, error mapping and redaction, the tool registry, and — for the CRM tools — that `objectType` and each `action` / `operation` / `engagementType` discriminator reaches the right HubSpot path and method. Integration tests drive the **real Fastify instance and real MCP transport** through `app.inject()` — full `initialize` → `tools/list` → `tools/call` handshakes in both session modes — faking only the outbound HubSpot call.

Notable invariants under test: an internal error message never reaches a caller; a 401 is not retried under private-app auth but is retried exactly once under OAuth; a client error never trips the circuit breaker; a create is never retried while an update always is; the catalogue is asserted as an **exact set**, so an entry cannot creep back in unnoticed.

---

## Extending the catalogue

Two different jobs, and it matters which one you are doing.

**Adding an object type** (Tickets, or a custom object) is the cheap one, and it is the whole point of the current shape: add the union member to `CrmObjectType`, add its default and read-only property lists in `src/services/`, and every existing tool covers it. No new tools, no growth in the per-turn payload.

**Adding a genuinely new tool** is mechanical, but weigh it against the catalogue cost above first — if the new capability is a variation on an existing tool, it is usually a parameter, not a tool:

1. Add Zod input/output schemas in `src/schemas/crm.schema.ts`. Write every `.describe()` for a model to read — they become the JSON Schema the orchestrator uses, and they are re-sent on every request, so make them discriminating rather than exhaustive.
2. Add a service method in `src/services/` that calls `HubSpotClient`.
3. Add a `ToolDefinition` in `src/tools/crm/`.
4. Register it in the array in `src/tools/crm/index.ts`, in the read → write → destructive ordering.
5. Update the exact-set assertion in `src/tests/server.integration.test.ts`.

Correlation, validation, timing, error mapping, redaction, retry, rate limiting, and circuit breaking are inherited automatically. For write tools, pass `retryable: false` on the HubSpot request and set `destructiveHint: true` / `idempotentHint: false` in the annotations.

---

## Known trade-offs

- **TypeScript is pinned to 5.9.3, not 7.x.** `typescript-eslint@8` supports `>=4.8.4 <6.1.0`; on TS 7 type-aware linting silently stops working. Toolchain coherence beats the newest compiler.
- **The HubSpot SDK's generic request path accepts no `AbortSignal`.** Our per-attempt timeout therefore stops _us_ waiting but cannot cancel the in-flight socket. Cancellation is fully honoured everywhere we control it (rate-limiter queue waits, retry backoff sleeps).
- **OAuth refresh-token rotation is in-memory.** If HubSpot rotates the refresh token, the new value is used for the process lifetime and a warning is logged; update `HUBSPOT_REFRESH_TOKEN` to survive a restart. For multi-instance durability, implement `TokenStore` over Redis or Key Vault and swap it in the composition root.
