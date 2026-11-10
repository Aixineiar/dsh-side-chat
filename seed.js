/**
 * Seed construction for a side chat: copy the main Session's committed prefix,
 * mark the end of the inherited part, and balance a turn the fork cut in half.
 * Mirrors `buildForkSeed` from `@deepseek-ai/dsh-session/fork` so this bundle
 * needs no Host package import.
 */

import { syntheticFor } from './prompt.js';

/**
 * Copy one committed event into a seed. The whole envelope is kept — Session
 * validation reads fields this bundle has no business enumerating, so a new
 * Host field must survive by default instead of being silently dropped.
 * @param event - committed source event.
 * @returns a detached seed event.
 */
export function copyEvent(event) {
  if (event === null || typeof event !== 'object') return event;
  const copy = { ...event };
  if (copy.data !== undefined) copy.data = structuredClone(copy.data);
  return copy;
}

/**
 * Synthetic closers for the open tail turn of a seed. Providers reject a
 * dangling assistant tool call, so unanswered calls receive a conservative
 * error result first, then the open step and turn are closed.
 * @param events - seed events scanned from the start.
 * @param mode - the side chat's mode; it picks the synthetic wording.
 * @returns closer events in commit order; empty when the tail is balanced.
 */
export function openTailClosers(events, mode) {
  const synthetic = syntheticFor(mode);
  const pending = new Map();
  let openTurn = null;
  let openStep = null;
  for (const event of events) {
    const data = event.data ?? {};
    switch (event.type) {
      case 'turn/start':
        pending.clear();
        openTurn = data.turn;
        openStep = null;
        continue;
      case 'turn/end':
        pending.clear();
        openTurn = null;
        openStep = null;
        continue;
      case 'step/end':
        pending.clear();
        openStep = null;
        continue;
      case 'step/start':
        openStep = data.step;
        continue;
      case 'assistant/message': {
        const content = data.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type === 'tool-call') pending.set(block.id, { turn: data.turn, step: data.step });
        }
        continue;
      }
      case 'tool/call': {
        const entry = pending.get(data.callId);
        if (entry !== undefined) entry.callSeq = event.seq;
        continue;
      }
      case 'tool/result': {
        const callId = data.message?.source?.callId;
        const entry = pending.get(callId);
        if (entry !== undefined && event.surfaceOp === 'append' && entry.turn === data.turn && entry.step === data.step) {
          pending.delete(callId);
        }
        continue;
      }
      default:
        continue;
    }
  }
  const last = events[events.length - 1];
  if (openTurn === null || last === undefined) return [];
  const time = last.time;
  const closers = [];
  let seq = last.seq + 1;
  for (const [callId, entry] of pending) {
    const started = entry.callSeq !== undefined;
    closers.push({
      type: 'tool/result',
      seq: seq,
      time: time,
      data: {
        turn: entry.turn,
        step: entry.step,
        message: {
          id: `forked-tool-result-${callId}-${seq}`,
          role: 'tool',
          toolCallId: callId,
          isError: true,
          source: { kind: 'tool', callId: callId },
          content: [{ type: 'text', text: started ? synthetic.started : synthetic.notStarted }],
        },
        error: started
          ? { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' }
          : { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' },
      },
      surfaceOp: 'append',
      ...(started ? { sourceEventSeqs: [entry.callSeq] } : {}),
    });
    seq += 1;
  }
  if (openStep !== null) {
    closers.push({ type: 'step/end', seq: seq, time: time, data: { turn: openTurn, step: openStep } });
    seq += 1;
  }
  closers.push({ type: 'turn/end', seq: seq, time: time, data: { turn: openTurn, reason: { kind: 'forked' } } });
  return closers;
}

/**
 * Build a child seed from an inclusive source-event prefix: the inherited cut,
 * the seed-end marker, then the closers that balance the inherited tail.
 * @param events - the source log, contiguous from seq 0.
 * @param boundary - inclusive source event seq the child inherits through.
 * @param mode - the side chat's mode, which selects the synthetic wording.
 * @returns seed events for `agents.create`.
 */
export function buildSeed(events, boundary, mode) {
  const prefix = events.slice(0, boundary + 1).map(copyEvent);
  const origin = events[boundary];
  prefix.push({ type: 'session/end-seed', seq: boundary + 1, time: origin?.time ?? Date.now(), data: { inherited: true } });
  return prefix.concat(openTailClosers(prefix, mode));
}
