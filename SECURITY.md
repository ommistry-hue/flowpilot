# Security Policy

## Supported versions

FlowPilot is pre-1.0. Security fixes land on `main` and ship in the next release. Only the latest release is supported.

| Version | Supported |
|---|---|
| latest release | Yes |
| older releases | No |

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](https://github.com/ommistry-hue/flowpilot/security/advisories/new).

Include:

- the affected version or commit
- steps to reproduce, or a proof of concept
- the impact as you understand it

What to expect:

- acknowledgement within **3 business days**
- an initial assessment within **10 business days**
- a fix, an advisory and credit (if you want it) once the fix is released

We ask for coordinated disclosure: give us up to 90 days before you publish.

## Hardening checklist for self-hosters

FlowPilot runs code you put in workflows and calls URLs you configure. Treat access to the designer as access to the server's network.

- **Set `FlowPilot:ApiKey`** before exposing the server. Without it, `/api/*` and `/hubs/*` are open, and the server logs a warning at startup outside Development. Docker Compose refuses to start without `FLOWPILOT_API_KEY`.
- **Authenticate webhooks.** `/hooks/*` does not check the API key. Set the webhook trigger's **Shared secret**, ideally as `{{ secrets.NAME }}`. Callers must then send it in `X-FlowPilot-Secret` or sign the raw body with HMAC-SHA256 in `X-Hub-Signature-256` (GitHub style). Both are compared in constant time. Bodies over `FlowPilot:Webhooks:MaxBodyBytes` (1 MB) are rejected. `Cookie`, `Authorization`, `X-Api-Key` and `X-FlowPilot-Secret` are never stored in the run input.
- **Put a TLS reverse proxy in front** (Caddy, nginx, Traefik). The container listens on plain HTTP on port 5080.
- **Restrict egress** if workflow authors are not fully trusted. `http.request` can reach anything the server can reach, including cloud metadata endpoints and internal services. `FlowPilot:Http:BlockPrivateNetworks=true` blocks the following, checked after DNS resolution, with proxies disabled:
  - loopback, private, link-local and CGNAT ranges
  - NAT64 and 6to4 ranges

  The Docker image enables it by default. Responses over `FlowPilot:Http:MaxResponseBytes` (10 MB) fail the node.
- **Plugins are full-trust code.** A DLL in the plugins folder runs in-process with the server's permissions. Install only plugins you trust.
- **Expressions are sandboxed.** Every template, condition and script runs in a fresh Jint engine with no CLR access and these limits:
  - 2 s timeout
  - 4 MB memory
  - 100k statements
  - recursion depth 256
  - 1 s regex timeout

  Report any escape as a vulnerability.
- **Runaway runs are capped.** A run fails after `FlowPilot:Engine:MaxStepsPerRun` (10,000) node executions. Finished runs are deleted after `FlowPilot:Retention:Days` (30).
- **Keep secrets out of workflow JSON.** Define `FLOWPILOT_SECRET_<NAME>` environment variables and reference them as `{{ secrets.NAME }}`. The values never enter the workflow definition. They are masked as `***` in persisted node inputs and outputs, variables, errors and `log` output. Masking matches exact values, so a secret that a script transforms (for example, base64-encodes) is not caught. Don't write such derived values to outputs. See [docs/expressions.md](docs/expressions.md#secrets).
- **Run as non-root.** The official image already does; keep it that way.
