import { LocalAgent } from './local-agent.model';
import { saveMemory, searchMemory } from './memory/memory-tools';
import { getDocument, documentToText } from '../core/api/documents.client';

/**
 * Runs a local agent against the cloud agent loop. The agent's identity
 * (persona, system prompt, assigned docs, memory) is assembled HERE on the
 * device and prepended to the user's message; the backend only ever sees the
 * composed prompt — the agent definition never leaves the phone (plan D).
 */
export class LocalAgentRuntime {
  private docCache = new Map<string, string>();

  constructor(private readonly agent: LocalAgent) {}

  private async assignedDocsText(): Promise<string> {
    const ids = this.agent.assignedDocIds ?? [];
    if (ids.length === 0) return '';
    const texts: string[] = [];
    for (const id of ids) {
      if (this.docCache.has(id)) {
        texts.push(this.docCache.get(id)!);
        continue;
      }
      try {
        const doc = await getDocument(id);
        const text = documentToText(doc);
        this.docCache.set(id, text);
        texts.push(text);
      } catch {
        // Doc unavailable (deleted / offline) — skip it.
      }
    }
    return texts.join('\n\n---\n\n');
  }

  /**
   * Builds the message to send to /agent/chat: persona + assigned docs +
   * retrieved memory + the user's actual message.
   */
  async composeMessage(userMessage: string): Promise<string> {
    const [docs, memories] = await Promise.all([
      this.assignedDocsText(),
      searchMemory(this.agent.id, userMessage, 5),
    ]);

    const sections: string[] = [];
    sections.push(
      `Eres "${this.agent.name}". ${this.agent.personality}`.trim(),
    );
    if (this.agent.systemPrompt.trim()) {
      sections.push(this.agent.systemPrompt.trim());
    }
    if (docs) {
      sections.push(`Documentos de referencia del usuario:\n${docs}`);
    }
    if (memories.length) {
      const mem = memories.map((m) => `- ${m.text}`).join('\n');
      sections.push(`Memoria relevante de conversaciones anteriores:\n${mem}`);
    }
    sections.push(`Mensaje del usuario:\n${userMessage}`);
    return sections.join('\n\n');
  }

  /** Persists a compact memory of the exchange for future recall. */
  async remember(userMessage: string, assistantText: string): Promise<void> {
    const summary = assistantText.trim().slice(0, 500);
    if (!summary) return;
    await saveMemory(
      this.agent.id,
      `El usuario dijo: "${userMessage.trim().slice(0, 200)}". ${this.agent.name} respondió: "${summary}"`,
      { kind: 'exchange' },
    );
  }
}
