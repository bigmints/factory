/**
 * Singleton chat store — lives outside the React component tree.
 * State survives tab switches, re-mounts, and any future Next.js navigation.
 */

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'success' | 'failed';
  result?: string;
  startTime?: number;
  duration?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  tokenCount?: number;
  durationMs?: number;
  tokensPerSec?: number;
}

export interface ParsedStory {
  kind: 'app' | 'feature';
  filename: string;
  yaml: string;
  name: string;
  phase?: number;
  dependsOn?: string[];
}

export interface MentionItem {
  id: string;
  label: string;
  type: 'story' | 'queue' | 'knowledge';
  slug?: string;
  status?: string;
}

const BASE_STORAGE_KEY = 'tpm-chat-messages-v3';

function getStorageKey(projectId?: string) {
  return projectId ? `${BASE_STORAGE_KEY}-${projectId}` : BASE_STORAGE_KEY;
}

function loadFromStorage(projectId?: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(msgs: ChatMessage[], projectId?: string) {
  try {
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(msgs.slice(-50)));
  } catch {}
}

type Listener = () => void;

class TpmChatStore {
  messages: ChatMessage[] = [];
  streaming = false;
  abortController: AbortController | null = null;
  mentionItems: MentionItem[] = [];
  projectId?: string;
  private listeners = new Set<Listener>();

  constructor() {
    this.messages = loadFromStorage();
  }

  setProject(projectId: string) {
    if (this.projectId === projectId) return;
    this.projectId = projectId;
    this.messages = loadFromStorage(projectId);
    this.notify();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  setMessages(msgs: ChatMessage[]) {
    this.messages = msgs;
    saveToStorage(msgs, this.projectId);
    this.notify();
  }

  appendToLast(delta: string) {
    const msgs = [...this.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') {
      last.content += delta;
      this.messages = msgs;
      saveToStorage(msgs, this.projectId);
      this.notify();
    }
  }

  updateLastToolCall(id: string, patch: Partial<ToolCall>) {
    const msgs = [...this.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant' && last.toolCalls) {
      const tc = last.toolCalls.find((c) => c.id === id);
      if (tc) Object.assign(tc, patch);
      this.messages = msgs;
      this.notify();
    }
  }

  addToolCall(tc: ToolCall) {
    const msgs = [...this.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') {
      if (!last.toolCalls) last.toolCalls = [];
      if (!last.toolCalls.some((c) => c.id === tc.id)) last.toolCalls.push(tc);
      this.messages = msgs;
      this.notify();
    }
  }

  setStreaming(val: boolean) {
    this.streaming = val;
    this.notify();
  }

  setMentionItems(items: MentionItem[]) {
    this.mentionItems = items;
    this.notify();
  }

  clear() {
    this.messages = [];
    saveToStorage([], this.projectId);
    this.notify();
  }

  tickRunningToolCalls() {
    let changed = false;
    const msgs = this.messages.map((msg) => {
      if (!msg.toolCalls) return msg;
      const updated = msg.toolCalls.map((tc) => {
        if (tc.status === 'running' && tc.startTime) {
          changed = true;
          return { ...tc, duration: Date.now() - tc.startTime };
        }
        return tc;
      });
      return { ...msg, toolCalls: updated };
    });
    if (changed) {
      this.messages = msgs;
      this.notify();
    }
  }
}

export const tpmStore = new TpmChatStore();
