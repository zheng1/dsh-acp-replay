/**
 * Replay one persisted session log as standard ACP updates.
 *
 * `session/load` requires the agent to stream the session's whole conversation
 * history back to the client before the call returns, so the bridge walks the
 * stored event log and reuses the live update mapping from `updates.ts`.
 *
 * @module dsh-acp-replay/replay
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { assistantBlockToAcp } from './content.ts'
import { assistantUpdates, toolCallUpdate, toolResultUpdate } from './updates.ts'

/**
 * Convert every transcript-forming stored event into ordered protocol updates.
 * @param ctx - bridge context carrying attachment and token-meter services.
 * @param session - the restored session, used for context-pressure reporting.
 * @param events - the session's validated stored log, oldest first.
 * @returns updates in log order, ready to notify before `session/load` returns.
 */
export async function replaySessionUpdates(
  ctx: Context,
  session: Session,
  events: readonly SessionEvent[],
): Promise<SessionUpdate[]> {
  const updates: SessionUpdate[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        // Only a direct human prompt is a user turn. Context the harness
        // injects (file-change notices, the runtime snapshot, skill lists)
        // shares this event type but is not something a user said.
        if (event.data.source.kind !== 'user') break
        for (const block of event.data.content) {
          const content = await assistantBlockToAcp(ctx, block)
          if (content !== undefined) {
            updates.push({
              sessionUpdate: 'user_message_chunk',
              messageId: event.data.id,
              content,
            })
          }
        }
        break
      }
      case 'assistant/message':
        updates.push(...await assistantUpdates(ctx, session, event))
        break
      case 'tool/call':
        updates.push(toolCallUpdate(event))
        break
      case 'tool/result':
        updates.push(await toolResultUpdate(ctx, event))
        break
      default:
        // Stream chunks, turn markers, notices, and every other non-surface
        // event stay off the wire; the surface above is what a client renders.
        break
    }
  }
  return updates
}
