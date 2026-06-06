import EventSource from 'react-native-sse';

import { API_BASE_URL } from './config';
import { api } from './http';
import { getAccessToken } from '../auth/token-store';

export interface ConversationSummary {
  id: string;
  title?: string;
  preview?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

/** ChatGPT-style history list (reuses the agent conversation store). */
export async function listConversations(
  teamId: string,
): Promise<ConversationSummary[]> {
  const { data } = await api.get<ConversationSummary[]>('/agent/conversations', {
    params: { teamId },
  });
  return Array.isArray(data) ? data : [];
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const { data } = await api.get<ConversationMessage[]>(
    `/agent/conversations/${conversationId}/messages`,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Streams a turn from POST /agent/chat/stream (SSE). Bridges the backend agent
 * loop into the Vault app: deltas render live, `client_action` events hand a
 * native action to the device, and `done` carries the conversationId to resume.
 */
export interface AgentChatBody {
  teamId: string;
  message: string;
  conversationId?: string;
  entityType?: 'vault' | 'document' | 'board' | 'mesh' | 'card' | 'script' | 'team';
  entityId?: string;
  enabledToolIds?: string[];
  clientActionResult?: {
    id?: string;
    tool: string;
    success?: boolean;
    output?: any;
    error?: string;
  };
}

export interface ClientActionEvent {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface AgentStreamHandlers {
  onDelta?(text: string): void;
  onToolStart?(e: { id?: string; tool: string; input: unknown }): void;
  onToolDone?(e: {
    id?: string;
    tool: string;
    success: boolean;
    input?: unknown;
    output: unknown;
    durationMs?: number;
  }): void;
  /**
   * Emitted by the backend right after `tool_done` (separate event, same
   * tool_use_id). Carries the raw result payload. Kept distinct from
   * `onToolDone` so callers can render the result line exactly like the web.
   */
  onToolResult?(e: { id?: string; tool: string; success: boolean; data: unknown }): void;
  /** A tool is paused awaiting user approval (chip → "approval" state). */
  onToolApproval?(e: { id?: string; tool: string; input: unknown }): void;
  onClientAction?(e: ClientActionEvent): void;
  onDone?(e: { conversationId: string; messageId: string; text: string }): void;
  onError?(message: string): void;
}

export interface AgentStreamHandle {
  close(): void;
}

export async function streamAgentChat(
  body: AgentChatBody,
  handlers: AgentStreamHandlers,
): Promise<AgentStreamHandle> {
  const token = await getAccessToken();
  const es = new EventSource(`${API_BASE_URL}/agent/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify(body),
    // The backend streams `data: {json}` lines; we parse them ourselves.
    pollingInterval: 0,
  });

  es.addEventListener('message', (event) => {
    if (!event.data) return;
    let evt: any;
    try {
      evt = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (evt.type) {
      case 'delta':
        handlers.onDelta?.(String(evt.text ?? ''));
        break;
      case 'tool_start':
        // Forward the backend tool_use_id (evt.id) so the chip is keyed by it —
        // dropping it caused finished events to mis-match the started chip.
        handlers.onToolStart?.({ id: evt.id, tool: evt.tool, input: evt.input });
        break;
      case 'tool_done':
        handlers.onToolDone?.({
          id: evt.id,
          tool: evt.tool,
          success: !!evt.success,
          input: evt.input,
          output: evt.output,
          durationMs: evt.durationMs,
        });
        break;
      case 'tool_result':
        handlers.onToolResult?.({
          id: evt.id,
          tool: evt.tool,
          success: evt.success !== false,
          data: evt.data,
        });
        break;
      case 'tool_approval_request':
        handlers.onToolApproval?.({ id: evt.id, tool: evt.tool, input: evt.input ?? {} });
        break;
      case 'client_action':
        handlers.onClientAction?.({ id: evt.id, tool: evt.tool, input: evt.input ?? {} });
        break;
      case 'done':
        handlers.onDone?.({
          conversationId: evt.conversationId,
          messageId: evt.messageId,
          text: String(evt.text ?? ''),
        });
        es.close();
        break;
      case 'error':
        handlers.onError?.(String(evt.message ?? 'agent error'));
        es.close();
        break;
    }
  });

  es.addEventListener('error', () => {
    handlers.onError?.('stream connection error');
    es.close();
  });

  return { close: () => es.close() };
}
