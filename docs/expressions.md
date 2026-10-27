# Expressions

FlowPilot uses JavaScript expressions, evaluated by [Jint](https://github.com/sebastienros/jint), to move data between nodes and make decisions.

## Two forms

**1. Templates in config values.** Any string config value that contains `{{ ... }}` is evaluated before the activity runs.

| Config value | Result |
|---|---|
| `"{{ input.body.total }}"` | The value with its JS type kept: `149.5` (a number) |
| `"{{ input.body.items }}"` | An array |
| `"Order {{ input.body.id }} is ready"` | Mixed text: always a string, `"Order 42 is ready"` |
| `"{{ ({ text: 'Hi ' + input.body.name }) }}"` | An object. Wrap object literals in parentheses |

A value that is exactly one `{{ expr }}` keeps the JS result type. Anything else interpolates to a string.

**2. Expression inputs.** Inputs of kind `Expression` take raw JavaScript, **without** braces:

| Activity | Input | Example |
|---|---|---|
| `condition` | `expression` | `input.body.total > 100` |
| `switch` | `cases[].expression` | `input.body.country === 'DE'` |
| `loop.forEach` | `items` | `nodes.fetchUsers.output.body.users` |

`script` is different again: its `code` is a JS function body that ends with `return`.

```js
const total = input.body.items.reduce((sum, i) => sum + i.price * i.qty, 0);
return { total, vat: total * 0.19 };
```

## Scope

| Name | Contents |
|---|---|
| `input` | The output of the node whose edge led here |
| `vars` | Run variables (initial values from the workflow's `variables`, changed by `variable.set`) |
| `nodes` | Outputs of completed nodes: `nodes.<nodeId>.output` |
| `trigger` | The trigger payload |
| `run` | `{ id, workflowId }` |
| `item`, `index` | Inside a `loop.forEach` body: the current element and its index, from the nearest forEach |
| `secrets` | Values of `FLOWPILOT_SECRET_<NAME>` environment variables: `secrets.NAME`. See [Secrets](#secrets) |

## Common patterns

```js
// Webhook trigger output is { method, headers, query, body }
input.body.customer.email

// Reach back to an earlier node, not just the previous one
nodes.lookupCustomer.output.body.tier === 'gold'

// The original trigger payload, from anywhere in the run
trigger.body.orderId

// HTTP responses are { status, headers, body }
nodes.getPrice.output.body.price * 1.2

// After flow.join the output is keyed by source node ID
input.inventoryCheck.body.inStock && input.fraudCheck.body.score < 0.5

// ai.prompt output is { text, json? }
nodes.classify.output.json.category

// Defaults
input.body.priority ?? 'normal'

// Building a JSON body
({ text: `New issue #${input.body.issue.number}: ${input.body.issue.title}` })
```

## Secrets

Keep credentials out of workflow JSON. Give the server environment variables with the `FLOWPILOT_SECRET_` prefix:

```bash
export FLOWPILOT_SECRET_SLACK_WEBHOOK=https://hooks.slack.com/services/T000/B000/XXXX
export FLOWPILOT_SECRET_GITHUB_TOKEN=ghp_...
```

Then reference them as `secrets.NAME`, in any template, condition or script:

```text
url:      {{ secrets.SLACK_WEBHOOK }}
headers:  { "Authorization": "Bearer {{ secrets.GITHUB_TOKEN }}" }
secret:   {{ secrets.GITHUB_WEBHOOK_SECRET }}      (webhook trigger shared secret)
```

How values are protected:

- **The definition holds only the reference.** Templates are evaluated in memory just before the activity runs. The evaluated config is never stored.
- **Persisted data is masked.** Every exact occurrence of a secret value becomes `***`, both in what is stored and in what is logged:
  - node inputs, outputs and errors in run history
  - run variables and `nodes.<id>.output`
  - bookmark payloads
  - the server log line written by `log`
- **Masking is by exact value.** A script that transforms a secret, for example `btoa(secrets.X)`, produces a value the masker does not know. Don't return such values from nodes.
- **`vars` and `nodes.<id>.output` hold the masked value.** Both are read back from storage, so a secret that passes through them comes back as `***`. Reference `secrets.NAME` directly wherever you need the value.
- **Restart to pick up changes.** Secrets are read once at startup.

## Sandbox limits

| Limit | Value |
|---|---|
| Timeout | 2 seconds |
| Memory | 4 MB |
| Statements | 100,000 |
| CLR access | None |

Expressions cannot touch the file system, the network or .NET types. Use `http.request` for network calls and a [custom activity](writing-activities.md) for anything else.

## In custom activities

Activities get an `IExpressionEvaluator` on the context. It evaluates raw JS (no braces) in the current run scope and can add extra variables:

```csharp
var result = context.Expressions.Evaluate(
    "input.items.filter(i => i.price > min)",
    new Dictionary<string, JsonNode?> { ["min"] = 10 });
```

## Troubleshooting

- **Got a string instead of an object?** The value has text outside the braces, even a space or newline. Use exactly `"{{ expr }}"`.
- **`SyntaxError` with object literals?** Write `{{ ({ a: 1 }) }}`, not `{{ { a: 1 } }}`.
- **`undefined` from `nodes.x`?** Use the node's `id`, not its display name, and make sure that node ran earlier in this branch.
- **Braces in a `condition`?** Expression inputs take raw JS. Remove the `{{ }}`.
