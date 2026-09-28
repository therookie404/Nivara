import React, { useState, useRef, useEffect } from 'react';
import { coachReply, COACH_GREETING_CHIPS } from '../chatbot.js';

// Floating "Nivara Coach" assistant. Every answer is grounded in the user's
// live data (stress model, months, goals, alerts, assets) via chatbot.js —
// no external LLM, no API keys. It can also run real what-if simulations.
export default function ChatBot({ ctx }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [chips, setChips] = useState(COACH_GREETING_CHIPS);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const greeted = useRef(false);

  // Greets once (per mount) when the panel opens, then focuses the input for typing.
  useEffect(() => {
    if (open && !greeted.current) {
      greeted.current = true;
      setMsgs([{
        from: 'bot',
        text: `Hey ${ctx.userName} 👋 I'm **Nivara Coach** — ask me anything about your money, and I'll answer from your real numbers.`,
      }]);
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open, ctx.userName]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing, open]);

  // Sends a message (from the input or a tapped chip) and asks the coach brain
  // for a reply grounded in the user's live data; then refreshes the chips.
  const send = async (raw) => {
    const text = (raw ?? input).trim();
    if (!text || typing) return;
    setInput('');
    setChips([]);
    setMsgs((m) => [...m, { from: 'user', text }]);
    setTyping(true);
    try {
      // Small beat so it feels conversational, not instant.
      const [reply] = await Promise.all([
        coachReply(text, ctx),
        new Promise((r) => setTimeout(r, 450)),
      ]);
      setMsgs((m) => [...m, { from: 'bot', text: reply.text }]);
      setChips(reply.chips || []);
    } catch (e) {
      setMsgs((m) => [...m, { from: 'bot', text: 'Something glitched on my end — try asking again.' }]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <>
      {/* ---- Floating open button (hidden while the panel is open) ---- */}
      {!open && (
        <button className="coach-fab" onClick={() => setOpen(true)} aria-label="Chat with Nivara Coach" title="Ask Nivara Coach">
          💬
        </button>
      )}
      {/* ---- Chat panel ---- */}
      {open && (
        <div className="coach-panel" role="dialog" aria-label="Nivara Coach chat">
          <div className="coach-head">
            <div>
              <b>🤖 Nivara Coach</b>
              <span>answers from your real numbers</span>
            </div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
          </div>
          {/* ---- Message list ---- */}
          <div className="coach-msgs" ref={bodyRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`coach-msg ${m.from}`}>
                <RichText text={m.text} />
              </div>
            ))}
            {/* Typing dots while the coach brain answers. */}
            {typing && (
              <div className="coach-msg bot coach-typing"><span /><span /><span /></div>
            )}
          </div>
          {/* ---- Quick-reply suggestion chips ---- */}
          {chips.length > 0 && !typing && (
            <div className="coach-chips">
              {chips.map((c) => (
                <button key={c} className="coach-chip" onClick={() => send(c)}>{c}</button>
              ))}
            </div>
          )}
          {/* ---- Composer ---- */}
          <div className="coach-input">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="Ask about your money…"
              maxLength={300}
            />
            <button className="btn" onClick={() => send()} disabled={!input.trim() || typing} aria-label="Send">➤</button>
          </div>
        </div>
      )}
    </>
  );
}

// Minimal rich text: **bold** + line breaks.
// Props: text — the raw message string.
function RichText({ text }) {
  return (
    <>
      {String(text).split('\n').map((line, i) => (
        <div key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**')
              ? <b key={j}>{part.slice(2, -2)}</b>
              : <span key={j}>{part}</span>
          )}
        </div>
      ))}
    </>
  );
}
