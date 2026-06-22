import { useState } from 'react';
import { toast } from 'sonner';
import { tpmStore, type ChatMessage } from '@/lib/tpm-chat-store';

export function useTpmChat() {
  const [streaming, setStreaming] = useState(false);

  const handleSend = async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMsgs = [...tpmStore.messages, userMsg];
    tpmStore.setMessages(newMsgs);

    setStreaming(true);
    tpmStore.setStreaming(true);
    
    tpmStore.setMessages([...newMsgs, { role: 'assistant', content: '', toolCalls: [] }]);

    const abort = new AbortController();
    tpmStore.abortController = abort;

    try {
      const res = await fetch('/api/tpm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          messages: [
            ...newMsgs.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error('Chat request failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data: ')) continue;
          const data = t.slice(6);
          if (data === '[DONE]') continue;
          try {
            const p = JSON.parse(data);
            if (p.type === 'text' && p.content) tpmStore.appendToLast(p.content);
            else if (p.type === 'tool_start') {
              tpmStore.addToolCall({ id: p.id, name: p.name, arguments: p.arguments, status: 'running', startTime: Date.now(), duration: 0 });
            } else if (p.type === 'tool_end') {
              tpmStore.updateLastToolCall(p.id, { status: p.status || 'success', result: p.result, duration: p.startTime ? Date.now() - p.startTime : undefined });
            } else if (p.type === 'error') toast.error(p.error || 'Server error');
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      toast.error('TPM failed', { description: err.message });
      tpmStore.setMessages(newMsgs);
    } finally {
      setStreaming(false);
      tpmStore.setStreaming(false);
      tpmStore.abortController = null;
    }
  };

  return { handleSend, streaming };
}
