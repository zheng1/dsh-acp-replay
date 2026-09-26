# dsh-acp-replay

A community ACP bridge for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that answers `session/load`, so a client can rebuild a session transcript after its own restart.

**Status: prototype.** It works end to end on `dsh 0.1.5-rc.1`, `0.1.5-rc.3`, and `0.1.7-rc.2`, but it is a vendored fork of `@deepseek-ai/dsh-acp` and needs a rebase whenever that package changes. No harness version probed here advertises `loadSession` itself, so the bridge is still the only path to a rebuilt transcript; a field report of `0.1.6-alpha.1` answering nothing did not reproduce on the `0.1.7` release candidate.

Published on npm as `dsh-acp-replay`. Its version is independent of the harness version it targets, which `peerDependencies` states. `0.1.2` ships `test/*.mjs` and exposes the self-check and the pin check as bins, so both run from an installed copy. (`0.1.5-rc.1` was published with an incomplete file list, so it fails to load; it is deprecated.)

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

Run the self-check after a harness upgrade to get that answer without a full client. From a checkout that is `node test/selfcheck.mjs`; from an installed copy it is `npx dsh-acp-replay-selfcheck`, and a global install puts the same command on `PATH`. `dsh-acp-replay-pincheck` runs both profiles and prints which of the upgrade outcomes below applies.

The self-check reports "no ACP initialize response" when the harness never answers, which is also what a failed mount looks like. `dsh` rewrites the profile's `cordis.yml` while preparing it, so a sandbox that denies writes to `DSH_HOME` exits on EPERM before answering; the check says so when it sees `EPERM` or `prepareProfile` in the captured stderr, and prints that stderr otherwise.

## Upgrading the harness pin

The pin is the harness version whose `dsh-acp` this fork was rebased against. Check the candidate before moving it:

```
$ DSH_BIN=~/.local/bin/dsh npx dsh-acp-replay-pincheck
harness: /Users/you/.local/bin/dsh (0.1.5-rc.3)
shipped profile "acp"             does not advertise loadSession
bridge profile "acp-replay"       advertises loadSession (image: yes)

PIN: bridge — upgrade the harness and move the pin; this bridge answers session/load on it
```

| Outcome | Meaning | What to do |
| --- | --- | --- |
| `upstream` | The shipped profile advertises `loadSession` too | Drop the bridge and unpin; point the client back at `dsh --profile acp` |
| `bridge` | Only the bridged profile advertises it | Upgrade the harness, then move the pin |
| `refuses` | Neither profile advertises it | Stay on the pinned harness |

`test/replay-check.mjs` is the other half of that check: it records a session and replays it in a new process, so use a session with real content. A 376-byte session legitimately replays nothing, and zero counts then look like a broken bridge.

## Use it

The bridge replaces the shipped `acp` row in a profile. Either way you install it, the bridge row needs a `provider` and a `model`.

**From npm.** The package declares `dsh.bundle.patch`, so installing it composes the rows: the shipped `acp` row is disabled and the bridge is inserted.

```bash
dsh plugin --profile acp-replay add dsh-acp-replay
```

Then set the model on the inserted row, because the bundle carries none (the model id changes between harness releases) — that is an id-targeted override in the profile's own patch layer, not a second `insert`:

```yaml
# $DSH_HOME/profiles/acp-replay/cordis.patch.yml
- id: acp-replay
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
```

Read the values off the shipped row rather than guessing, since the id differs per release (`deepseek-flash` on 0.1.5, `deepseek-v4-flash` on 0.1.7):

```bash
DSH_HOME=~/.dsh dsh --profile acp --dump-config | sed -n '/- id: acp$/,/^$/p'
```

Skip that step and prompts answer with `Internal error: prompt variable "{{model}}" has no value for this assembly`. Add a second `insert` entry for `acp-replay` while the bundle is active and the mount fails with `duplicate loader entry id: acp-replay`.

**From a checkout (no bundle).** Install globally (`npm install -g dsh-acp-replay`) or copy `lib/`, `package.json`, and `cordis.patch.yml` into `$DSH_HOME/profiles/node_modules/dsh-acp-replay/`, then spell out both rows:

```yaml
# $DSH_HOME/profiles/acp-replay/cordis.patch.yml
- id: acp
  disabled: true

- insert:
    - id: acp-replay
      name: 'dsh-acp-replay'
      inject: [acpAppStartup]
      config:
        provider: deepseek-official
        model: deepseek-v4-flash
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

The rows the bundle composes are the same two above, so a profile can point at either path without changing the client config.

## Build

```bash
npm install --legacy-peer-deps   # the 0.1.5 peer graph has an rc.1/rc.2 skew
npm run build                    # tsc -> lib/
npm test                         # guard behaviour (node:test)
```

### pnpm

Reported from a field install with pnpm 12 (this repository is developed with pnpm 10, where a plain install is enough): pnpm 12 fails on `ERR_PNPM_IGNORED_BUILDS` even when the dependency tree resolved, and `--ignore-scripts` does not bypass it. Declaring the builds is what works:

```yaml
allowBuilds:
  "@deepseek-ai/dsh-subprocess-local": true
  "@google/genai": true
  koffi: true
  node-pty: true
  protobufjs: true
```

`@deepseek-ai/dsh-subprocess-local` is the one that matters: its postinstall restores the executable bit on node-pty's `spawn-helper`. A packaged prebuild already ships that file `0755`, so skipping the script is invisible until an install lacks the bit and pty support disappears without a message.

## Verified

Against `dsh 0.1.5-rc.1`, a scratch `DSH_HOME`, and a real API key:

- `initialize` reports `loadSession: true`.
- A session with two prompts runs normally through the bridge (`session/new`, `session/prompt`, `session/close`).
- A **new process** calling `session/load` for that session id receives `user_message_chunk ×2` and `agent_message_chunk ×2` carrying the original prompts and answers, plus `usage_update ×2`.

`test/replay-check.mjs` runs both phases (`record` then `load <session-id>`); `test/selfcheck.mjs` only performs `initialize` and reports whether `loadSession` is advertised.

**Harness versions.** Each candidate installed with `dsh plugin --profile acp-replay add dsh-acp-replay` into a profile created by that same harness:

| Harness | Shipped `acp` profile | Bridged profile | Note |
| --- | --- | --- | --- |
| `0.1.5-rc.1` | answers, no `loadSession` | `loadSession: true` | original target; replay verified |
| `0.1.5-rc.3` (npm `latest`) | answers, no `loadSession` | `loadSession: true` | guard passes, so the pin can move |
| `0.1.7-rc.2` (npm `next`) | answers, no `loadSession` | `loadSession: true` | record + replay verified |

The shipped profile answering every time is the part a bare `initialize` probe can misread: no harness version probed here advertises `loadSession` itself, so the bridge stays necessary.

**End to end through a client** (Paseo 0.7.2 daemon, `dsh 0.1.5-rc.1`, two DSH providers on one daemon so only the bridge differs). Each agent ran one prompt, then the daemon was restarted — the event that used to erase the visible conversation:

| Provider | Before restart | After restart |
| --- | --- | --- |
| `dsh-replay` (this bridge, advertises `loadSession`) | user prompt, assistant answer, reasoning row | **all three rows restored** |
| `dsh` (shipped bridge, no `loadSession`) | user prompt, assistant answer | `No activity to display.` |

Paseo's ACP adapter takes the `loadSession` branch only when the agent advertises the capability, primes its timeline from `streamHistory()`, and needed no change for this to work.

**Independent confirmation** (`dsh 0.1.5-rc.2`, Paseo 0.9.1 daemon, macOS, own `DSH_HOME`):

| Probe | Shipped `acp` | `dsh-acp-replay` |
| --- | --- | --- |
| `initialize.agentCapabilities.loadSession` | absent (`sessionCapabilities: { close, list, resume }`) | `true` |
| `session/load` on a persisted session | no replay | `user_message_chunk` ×1, `agent_message_chunk` ×17, `tool_call` ×24 |

That client-side branch was read off the shipped Paseo 0.9.1 build: its ACP client tests `agentCapabilities.loadSession` first and only falls back to `unstable_resumeSession`, and `dsh` reaches the client through the generic ACP path, so the shipped bridge takes the second branch. Switching the provider to this bridge rendered the conversations that had reopened blank, and `paseo provider diagnostic dsh` reported Ready.

**The self-check from an installed copy** (`0.1.1`, an `npm install` of the packed tarball, `dsh 0.1.5-rc.1`, scratch `DSH_HOME`) — the check that could not be run before `0.1.1`, because `test/` was not in the published file list:

```
$ DSH_PROFILE=acp-replay dsh-acp-replay-selfcheck
OK: profile "acp-replay" advertises loadSession (image: yes)

$ DSH_PROFILE=acp dsh-acp-replay-selfcheck
FAIL: the bridge answered but does not advertise loadSession        # exit 1
```

**`0.1.1` changed no served code.** A downstream field check diffed the published `0.1.1` tarball against the installed `0.1.0`: `lib/` and `cordis.patch.yml` byte-identical, `package.json` differing only in the version, the `bin` entry, and `files`. After the upgrade the same 1.2 MB session replayed to identical counts (`user_message_chunk` 17, `agent_message_chunk` 90, `agent_thought_chunk` 103, `tool_call` 114, `tool_call_update` 114, `usage_update` 113) and the provider diagnostic stayed Ready.

## Not verified / known limits

- Tool-call replay is mapped but not exercised by the test above.
- The `0.1.6-alpha.1` no-response finding was a field report and does not generalize: `0.1.5-rc.3` and `0.1.7-rc.2` both answer and both mount this bridge. No alpha harness has been probed here.
- An older host (`dsh 0.1.2-rc.1`) exposes a different persistence API (`load`/`inspect` instead of `open`/`read`), so this fork targets `0.1.5-rc.1` and newer only.
- Replayed history is delivered before `session/load` returns, one notification at a time; a very long session makes that call proportionally long.
- The profile's own help text still reads `--profile acp` (it comes from the bundled `dsh-acp-app` command provider, not from this package).

## License

MIT, matching the upstream package it vendors. `src/*.ts` except `src/replay.ts` are copied from [`@deepseek-ai/dsh-acp`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) at tag `dsh-v0.1.5-rc.1`; the additions are the `loadSession` capability, the `loadSession` handler in `src/index.ts`, and `src/replay.ts`.
