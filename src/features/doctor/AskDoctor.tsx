import { KeyRound, MessageCircleQuestion, Send, Sparkles, Square, Trash2, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { useSettings } from "../../state/settingsStore";
import { askDoctor, buildDroneContext, type ChatMessage } from "./askDoctor";
import type { Finding } from "./diagnostics";
import { GENERIC_STARTERS } from "./droneKnowledge";

// --- tiny markdown-ish renderer: paragraphs, bullet lists, **bold**, `code` ---
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) {
      blocks.push(<ul key={key}>{list.map((li, i) => <li key={i}><Inline text={li} /></li>)}</ul>);
      list = [];
    }
  };
  lines.forEach((ln, i) => {
    const t = ln.trim();
    const m = t.match(/^[-*]\s+(.*)/) || t.match(/^\d+\.\s+(.*)/);
    if (m) {
      list.push(m[1]);
    } else {
      flush(`ul-${i}`);
      if (t) blocks.push(<p key={`p-${i}`}><Inline text={t.replace(/^#+\s*/, "")} /></p>);
    }
  });
  flush("ul-end");
  return <>{blocks}</>;
}

export function AskDoctor({ findings }: { findings: Finding[] }) {
  const aiKey = useSettings((s) => s.aiKey);
  const aiModel = useSettings((s) => s.aiModel);
  const setSetting = useSettings((s) => s.set);
  const connected = useLink((s) => !!s.vehicle);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || !aiKey) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setStreaming("");
    const ac = new AbortController();
    abortRef.current = ac;
    const link = useLink.getState();
    const context = buildDroneContext({
      vehicle: link.vehicle,
      armed: link.vehicle?.armed ?? false,
      findings,
      telemetry: link.telemetry,
      params: useParams.getState().values,
    });
    let acc = "";
    try {
      await askDoctor({ apiKey: aiKey, model: aiModel, messages: next, context, signal: ac.signal, onDelta: (d) => { acc += d; setStreaming(acc); } });
      setMessages((m) => [...m, { role: "assistant", content: acc }]);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        if (acc) setMessages((m) => [...m, { role: "assistant", content: `${acc} …(stopped)` }]);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setStreaming(null);
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();
  const clear = () => { setMessages([]); setError(null); };

  // --- key setup gate ---
  if (!aiKey) {
    return (
      <section className="panel ask-panel">
        <div className="panel-head"><h3><MessageCircleQuestion size={17} /> Ask the Doctor</h3></div>
        <div className="panel-body ask-setup">
          <div className="ask-setup-ic"><Sparkles size={22} /></div>
          <h4>Add your Anthropic API key to chat</h4>
          <p>Ask anything about building, tuning or fixing your drone and get answers grounded in <strong>your connected aircraft's live data</strong>. AERONEX has no server — you use your own Anthropic key, and it's stored only in this browser.</p>
          <div className="ask-key-row">
            <KeyRound size={15} />
            <input className="input" type="password" placeholder="sk-ant-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && keyDraft.trim() && setSetting("aiKey", keyDraft.trim())} />
            <button className="btn btn-primary" disabled={!keyDraft.trim()} onClick={() => setSetting("aiKey", keyDraft.trim())}>Save</button>
          </div>
          <p className="ask-setup-note">Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>. Your key stays on this device (saved in local storage) and is sent only to Anthropic. You can remove it anytime in Settings.</p>
        </div>
      </section>
    );
  }

  const topIssues = findings.filter((f) => f.severity !== "ok").slice(0, 3);
  const starters = [
    ...topIssues.map((f) => `Help me fix: ${f.title.toLowerCase()}`),
    ...GENERIC_STARTERS,
  ].slice(0, 5);

  return (
    <section className="panel ask-panel">
      <div className="panel-head">
        <h3><MessageCircleQuestion size={17} /> Ask the Doctor</h3>
        <div className="ask-head-actions">
          {connected && <span className="ask-grounded" title="Answers use your connected drone's live data"><Sparkles size={12} /> grounded in live data</span>}
          {messages.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clear}><Trash2 size={14} /> Clear</button>}
        </div>
      </div>
      <div className="panel-body ask-body">
        <div className="ask-scroll" ref={scrollRef}>
          {messages.length === 0 && streaming === null && (
            <div className="ask-empty">
              <p>I'm an ArduPilot expert that can see your drone. Ask me anything — building, calibration, tuning, a pre-arm error, why it's behaving oddly.</p>
              <div className="ask-starters">
                {starters.map((s) => (
                  <button key={s} className="ask-starter" onClick={() => void send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ask-msg ${m.role}`}>
              <div className="ask-bubble">{m.role === "assistant" ? <Rich text={m.content} /> : m.content}</div>
            </div>
          ))}
          {streaming !== null && (
            <div className="ask-msg assistant">
              <div className="ask-bubble">{streaming ? <Rich text={streaming} /> : <span className="ask-typing"><span /><span /><span /></span>}</div>
            </div>
          )}
          {error && <div className="callout warn ask-error"><TriangleAlert size={15} /><span>{error}</span></div>}
        </div>

        <form className="ask-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <textarea
            className="input"
            rows={1}
            placeholder="Ask about your drone…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          />
          {busy ? (
            <button type="button" className="btn btn-danger ask-send" onClick={stop} title="Stop"><Square size={16} /></button>
          ) : (
            <button type="submit" className="btn btn-primary ask-send" disabled={!input.trim()} title="Send"><Send size={16} /></button>
          )}
        </form>
        <p className="ask-disclaimer">Answers come from Anthropic's model using your key, grounded in ArduPilot guidance and your live data. Always double-check safety-critical changes.</p>
      </div>
    </section>
  );
}
