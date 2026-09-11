# dsh-acp-replay

A community ACP bridge for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that answers `session/load`, so a client can rebuild a session transcript after its own restart.

**Status: prototype.** It works end to end on `dsh 0.1.5-rc.1`, but it is a vendored fork of `@deepseek-ai/dsh-acp` and needs a rebase whenever that package changes.

## Why this exists

`dsh-acp` is an automation-only bridge: its `initialize` advertises `sessionCapabilities: { close, list, resume }` and no `loadSession`, and `session/resume` restores a session *without replaying its updates*. ACP defines `session/load` as the call where the agent "streams the entire conversation history back to the client via notifications", and clients that treat the agent as the durable transcript authority — Paseo, for one — call exactly that method to rebuild a timeline after restarting.

Without it, that model of client shows an empty conversation next to an agent that still remembers everything, because the harness keeps the transcript and the client has no way to read it. This bridge closes that gap; the discussion tracking the missing upstream feature is [deepseek-ai/deepseek-harness#6324](https://github.com/deepseek-ai/deepseek-harness/discussions/6324).

## What it adds

Two changes over `@deepseek-ai/dsh-acp@0.1.5-rc.1`:

- `initialize` advertises `loadSession: true`.
- `session/load` is implemented: it opens the stored session with a read-only persistence handle (`ctx.sessionPersistence.open(id, 'read')`), resumes the session exactly as `session/resume` does, then replays the snapshot through the existing update mapping in `src/updates.ts` before returning.

`src/replay.ts` maps stored events to protocol updates:

| Stored event | ACP update |
| --- | --- |
| `user/message` with `source.kind === 'user'` | `user_message_chunk` |
| `assistant/message` | `agent_thought_chunk`, `agent_message_chunk`, `usage_update` |
| `tool/call` | `tool_call` |
| `tool/result` | `tool_call_update` |

Injected context (the runtime snapshot, skill lists, file-change notices) shares the `user/message` event type but is not something a user said, so it stays off the wire.

## Fail-fast guard

The bridge needs the persistence handle API (`ctx.sessionPersistence.open(id, 'read')`, then `read(0)`) that `0.1.5-rc.1` introduced; `0.1.2-rc.1` read logs with `load`/`inspect` on the service instead. When the mounted harness does not offer what the bridge calls, `src/compat.ts` refuses to mount and prints the missing requirement, the alternative bridge, and this repository:

```
dsh-acp-replay cannot serve session/load in this harness (harness 0.1.6):
  - needs ctx.sessionPersistence.open(), but the mounted sessionPersistence service exposes inspect, list, load, stat
This plugin vendors @deepseek-ai/dsh-acp@0.1.5-rc.1 and needs the persistence handle API it introduced.
Use the shipped bridge instead ("dsh --profile acp"), or update this plugin for the installed harness.
https://github.com/zheng1/dsh-acp-replay
```

Run `node test/selfcheck.mjs` after a harness upgrade to get that answer without a full client.

## Use it

The bridge replaces the shipped `acp` row in a profile. Two ways:

**Install into an existing profile.** Add the package to the profile and append to its `cordis.patch.yml`:

```bash
dsh plugin --profile acp-replay add dsh-acp-replay   # or copy the package into
                                                     # $DSH_HOME/profiles/node_modules/
```

```yaml
- id: acp
  disabled: true

- insert:
    - id: acp-replay
      name: 'dsh-acp-replay'
      inject: [acpAppStartup]
      config:
        provider: deepseek-official
        model: deepseek-flash
```

Then point the client at `dsh --profile acp-replay` instead of `dsh --profile acp`. In Paseo that is the provider's `command`:

```json
{
  "agents": {
    "providers": {
      "dsh": {
        "extends": "acp",
        "label": "DeepSeek Harness",
        "command": ["dsh", "--profile", "acp-replay"]
      }
    }
  }
}
```

**Or use it as a bundle.** The package declares `dsh.bundle.patch`, so adding `dsh-acp-replay` to a profile's `dsh.profile.bundles` composes the same rows.

## Build

```bash
npm install --legacy-peer-deps   # the 0.1.5 peer graph has an rc.1/rc.2 skew
npm run build                    # tsc -> lib/
npm test                         # guard behaviour (node:test)
```

## Verified

Against `dsh 0.1.5-rc.1`, a scratch `DSH_HOME`, and a real API key:

- `initialize` reports `loadSession: true`.
- A session with two prompts runs normally through the bridge (`session/new`, `session/prompt`, `session/close`).
- A **new process** calling `session/load` for that session id receives `user_message_chunk ×2` and `agent_message_chunk ×2` carrying the original prompts and answers, plus `usage_update ×2`.

`test/replay-check.mjs` runs both phases (`record` then `load <session-id>`); `test/selfcheck.mjs` only performs `initialize` and reports whether `loadSession` is advertised.

**End to end through a client** (Paseo 0.7.2 daemon, `dsh 0.1.5-rc.1`, two DSH providers on one daemon so only the bridge differs). Each agent ran one prompt, then the daemon was restarted — the event that used to erase the visible conversation:

| Provider | Before restart | After restart |
| --- | --- | --- |
| `dsh-replay` (this bridge, advertises `loadSession`) | user prompt, assistant answer, reasoning row | **all three rows restored** |
| `dsh` (shipped bridge, no `loadSession`) | user prompt, assistant answer | `No activity to display.` |

Paseo's ACP adapter takes the `loadSession` branch only when the agent advertises the capability, primes its timeline from `streamHistory()`, and needed no change for this to work.

## Not verified / known limits

- Tool-call replay is mapped but not exercised by the test above.
- An older host (`dsh 0.1.2-rc.1`) exposes a different persistence API (`load`/`inspect` instead of `open`/`read`), so this fork targets `0.1.5-rc.1` and newer only.
- Replayed history is delivered before `session/load` returns, one notification at a time; a very long session makes that call proportionally long.
- The profile's own help text still reads `--profile acp` (it comes from the bundled `dsh-acp-app` command provider, not from this package).

## License

MIT, matching the upstream package it vendors. `src/*.ts` except `src/replay.ts` are copied from [`@deepseek-ai/dsh-acp`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) at tag `dsh-v0.1.5-rc.1`; the additions are the `loadSession` capability, the `loadSession` handler in `src/index.ts`, and `src/replay.ts`.
