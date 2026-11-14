"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAva, ACKS, FOLLOWUPS, pick } from "@/lib/use-ava";
import SectionShell from "@/components/section-shell";
import { offlineDB, type QueuedAIRequest } from "@/lib/offline-db";
type Source = { title?: string; filename?: string };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };
const suggestions: [string, string][] = [["Explain a topic from my uploaded Electrical Principles notes.", "💡"], ["Create a catch-up plan from verified lecture records.", "🗓"], ["Draft a clear WhatsApp class announcement.", "✎"], ["Summarise the latest uploaded lecture material.", "📄"]];
export default function AIWorkspace({ initialKind = "announcement" }: { initialKind?: string } = {}) {
  const [prompt, setPrompt] = useState(""); const [messages, setMessages] = useState<Message[]>([]); const [busy, setBusy] = useState(false); const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [kind, setKind] = useState(initialKind); const [queued, setQueued] = useState(0); const [voicePanelOpen, setVoicePanelOpen] = useState(false); const processingRef = useRef(false);

  const queueRequest = useCallback(async (item: Omit<QueuedAIRequest, "id" | "createdAt">, requestId = crypto.randomUUID()) => {
    if (!offlineDB) throw new Error("Offline request storage is unavailable in this browser.");
    await offlineDB.aiQueue.put({ ...item, id: requestId, createdAt: new Date().toISOString() });
    setQueued(await offlineDB.aiQueue.count());
  }, []);

  const processQueue = useCallback(async () => {
    if (!navigator.onLine || !offlineDB || processingRef.current) return;
    const pending = await offlineDB.aiQueue.orderBy("createdAt").toArray();
    if (!pending.length) { setQueued(0); return; }
    processingRef.current = true; setBusy(true); setError(""); setStatus("Processing queued AI requests…");
    try {
      for (const item of pending) {
        const endpoint = item.kind === "chat" ? "/api/ai/chat" : "/api/ai/generate";
        const payload = item.kind === "chat" ? { message: item.prompt, history: item.history, clientRequestId: item.id } : { kind: item.draftKind, prompt: item.prompt, query: item.prompt, clientRequestId: item.id };
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Queued AI request could not be processed.");
        await offlineDB.meta.put({ key: `ai-result:${item.id}`, value: JSON.stringify({ kind: item.kind, draftKind: item.draftKind, prompt: item.prompt, answer: item.kind === "chat" ? data.answer : data.output, sources: data.sources || [], createdAt: new Date().toISOString() }) });
        setMessages(current => {
          const question = item.kind === "chat" ? item.prompt : `Generate ${item.draftKind}: ${item.prompt}`;
          const withQuestion = current.some(message => message.role === "user" && message.content === question) ? current : [...current, { role: "user" as const, content: question }];
          return [...withQuestion, { role: "assistant", content: item.kind === "chat" ? data.answer || "No answer was returned." : data.output || "No output was returned.", sources: data.sources || [] }];
        });
        await offlineDB.aiQueue.delete(item.id);
      }
      setError("Queued AI requests have been processed.");
    } catch (e) { setError(e instanceof Error ? `${e.message} Your queued request is preserved.` : "AI queue could not be processed. Your request is preserved."); }
    finally { setQueued(await offlineDB.aiQueue.count()); processingRef.current = false; setBusy(false); setStatus(""); }
  }, []);

  useEffect(() => {
    if (offlineDB) {
      void offlineDB.aiQueue.count().then(setQueued);
      void offlineDB.aiQueue.toArray().then(requests => { if (requests.length) setMessages(current => [...current, ...requests.map(request => ({ role: "user" as const, content: request.kind === "chat" ? request.prompt : `Generate ${request.draftKind}: ${request.prompt}` }))]); });
      void offlineDB.meta.where("key").startsWith("ai-result:").toArray().then(async results => {
        if (!results.length) return;
        setMessages(current => [...current, ...results.flatMap((entry): Message[] => { try { const result = JSON.parse(entry.value); return [{ role: "user", content: result.kind === "chat" ? result.prompt : `Generate ${result.draftKind || "draft"}: ${result.prompt}` }, { role: "assistant", content: result.answer || "No output was returned.", sources: result.sources || [] }]; } catch { return [{ role: "assistant", content: "A queued AI result was received but could not be read." }]; } })]);
        await offlineDB?.meta.bulkDelete(results.map(entry => entry.key));
      });
    }
    const online = () => void processQueue();
    window.addEventListener("online", online);
    if (navigator.onLine) void processQueue();
    return () => window.removeEventListener("online", online);
  }, [processQueue]);

  async function ask(text = prompt, spoken = false) {
    if (!text.trim() || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    const requestId = crypto.randomUUID();
    setMessages(m => [...m, { role: "user", content: text }]); setPrompt(""); setError("");
    if (!navigator.onLine) { try { await queueRequest({ kind: "chat", prompt: text, history, draftKind: kind }, requestId); setError("Saved locally. ClassDesk will answer when your device reconnects and the AI service is available."); } catch (e) { setError(e instanceof Error ? e.message : "Could not queue request"); } return; }
    setBusy(true); setStatus("Searching class notes…");
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history, clientRequestId: requestId, voice: spoken }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "AI request failed");
      setMessages(m => [...m, { role: "assistant", content: data.answer || "No answer was returned.", sources: data.sources || [] }]);
    } catch (e) {
      if (e instanceof TypeError) { try { await queueRequest({ kind: "chat", prompt: text, history, draftKind: kind }, requestId); setError("Network lost. Your question is queued and will be answered when you reconnect."); } catch (queueError) { setError(queueError instanceof Error ? queueError.message : "Could not queue request"); } }
      else setError(e instanceof Error ? e.message : "AI request failed");
    } finally { setBusy(false); setStatus(""); }
  }

  async function generate(forced?: string, forcedKind?: string) {
    const text = forced || prompt; if (!text.trim() || busy) return;
    const draftKind = forcedKind || (forced ? "weekly" : kind);
    const requestId = crypto.randomUUID();
    setMessages(m => [...m, { role: "user", content: `Generate ${draftKind}: ${text}` }]); setPrompt(""); setError("");
    if (!navigator.onLine) { try { await queueRequest({ kind: "generate", prompt: text, history: [], draftKind }, requestId); setError("Draft request saved locally. It will be generated when you reconnect and the AI service is available."); } catch (e) { setError(e instanceof Error ? e.message : "Could not queue request"); } return; }
    setBusy(true); setStatus(draftKind === "announcement" ? "Drafting announcement…" : "Generating document…");
    try {
      const response = await fetch("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: draftKind, prompt: text, query: text, clientRequestId: requestId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Generation failed");
      setMessages(m => [...m, { role: "assistant", content: data.output || "No output was returned.", sources: data.sources || [] }]);
    } catch (e) {
      if (e instanceof TypeError) { try { await queueRequest({ kind: "generate", prompt: text, history: [], draftKind }, requestId); setError("Network lost. Your draft request is queued for when you reconnect."); } catch (queueError) { setError(queueError instanceof Error ? queueError.message : "Could not queue request"); } }
      else setError(e instanceof Error ? e.message : "Generation failed");
    } finally { setBusy(false); setStatus(""); }
  }
  const router = useRouter(); const voiceReply = useRef(false); const spokenCount = useRef(0);
  const PAGES: Record<string, string> = { dashboard: "/", home: "/", records: "/records", notes: "/notes", upload: "/notes", announcements: "/announcements", assistant: "/assistant", "catch up": "/catch-up", "catch-up": "/catch-up", courses: "/courses", lectures: "/lectures", assignments: "/assignments", attendance: "/attendance", concerns: "/concerns", settings: "/settings", coverage: "/coverage", calendar: "/calendar", timetable: "/calendar" };
  const avaRef = useRef<ReturnType<typeof useAva> | null>(null);
  const ava = useAva({
    onCommand: async (cmd) => {
      const A = () => avaRef.current!;
      const c = cmd.toLowerCase().replace(/[.!?,]+$/, "").trim();
      const say = (t: string, ask = false) => { if (A().listening) A().speak(t, ask ? pick(FOLLOWUPS) : "", ask); };
      const download = (href: string) => { const a = document.createElement("a"); a.href = href; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); };
      const addRecord = async (type: string, title: string) => { const r = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, title: title.slice(0, 180), content: "" }) }); return r.ok; };
      if (/^(stop|be quiet|quiet|shut up|cancel|stop talking|that's enough)$/.test(c)) { A().shutUp(); return; }
      if (/^(stop listening|go to sleep|goodbye|bye|turn off|that's all|that is all|nothing|no|nope|no thanks|i'm good)$/.test(c)) { say(/^(no|nope|no thanks|nothing|i'm good)$/.test(c) ? "Alright, boss. I'm here whenever you need me." : "Very good, boss. Switching off the microphone."); if (!/^(no|nope|no thanks|nothing|i'm good)$/.test(c)) setTimeout(() => A().stop(), 3200); return; }
      if (/^(thanks|thank you|cheers|nice one|great|well done)/.test(c)) { say("Anytime, boss.", true); return; }
      if (/^(hello|hi|hey|are you there|you there)$/.test(c)) { say("Right here, boss. What do you need?", false); return; }
      if (/^(clear|clear chat|new chat|start over|clear the chat)$/.test(c)) { setMessages([]); setError(""); say("Chat cleared, boss.", true); return; }
      if (/^(repeat|say that again|read that again|read it again|read it out|read that)$/.test(c)) { const last = [...messages].reverse().find(m => m.role === "assistant"); say(last ? last.content : "There's nothing to read yet, boss.", !!last); return; }
      if (/^(copy that|copy it|copy this)$/.test(c)) { const last = [...messages].reverse().find(m => m.role === "assistant"); if (last) { await navigator.clipboard?.writeText(last.content); say("Copied, boss.", true); } else say("Nothing to copy yet, boss."); return; }
      const nav = c.match(/^(?:open|go to|take me to|show me|show|launch)\s+(?:the\s+)?(.+?)(?:\s+page)?$/);
      if (nav && PAGES[nav[1]]) { say(`Opening ${nav[1]}, boss.`); setTimeout(() => router.push(PAGES[nav[1]]), 1800); return; }
      const dl = c.match(/^(?:download|export|get)\s+(?:the\s+|my\s+)?(catch[- ]?up (?:pdf|document|word|docx)?|weekly (?:report )?pdf|weekly report|calendar|timetable|archive|backup)/);
      if (dl) { const k = dl[1]; const href = /^catch/.test(k) ? (/pdf/.test(k) ? "/api/export/catch-up/pdf" : "/api/export/catch-up") : /^weekly/.test(k) ? "/api/export/weekly/pdf" : /calendar|timetable/.test(k) ? "/api/export/calendar" : "/api/export/archive"; say(`Downloading that now, boss.`, true); download(href); return; }
      if (/(what'?s|what is|anything|list|read).*(due|deadline|assignments?)|^(assignments|deadlines)$/.test(c)) {
        const r = await fetch("/api/academic?resource=assignments"); const d = await r.json().catch(() => ({ items: [] }));
        const items = ((d.items || []) as Array<{ title: string; dueAt?: string | null; status?: string; course?: { code?: string } }>).filter(i => i.status !== "DONE").sort((x, y) => String(x.dueAt || "9").localeCompare(String(y.dueAt || "9"))).slice(0, 5);
        say(items.length ? `You have ${items.length} open assignment${items.length > 1 ? "s" : ""}, boss. ` + items.map(i => `${i.course?.code ? i.course.code + ": " : ""}${i.title}${i.dueAt ? ", due " + new Date(i.dueAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : ""}`).join(". ") + "." : "Nothing outstanding at the moment, boss.", true); return;
      }
      const task = c.match(/^(?:add|create|new|make)\s+(?:a\s+)?(task|concern|reminder|to-?do)\s*(?:to|for|about|called|:)?\s+(.+)$/);
      if (task) { const type = /concern/.test(task[1]) ? "CONCERN" : "TASK"; const title = cmd.slice(cmd.toLowerCase().lastIndexOf(task[2])); const ok = await addRecord(type, title); say(ok ? `Done, boss. I've added that ${type === "CONCERN" ? "concern" : "task"}.` : "Sorry boss, I couldn't save that one.", ok); return; }
      const draft = c.match(/^(?:draft|write|prepare|generate|create|make)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(announcement|weekly report|catch[- ]?up (?:guide|plan)|study summary|summary)\s*(?:about|on|for|of|:)?\s*(.*)$/);
      if (draft) { const k = draft[1]; const dk = /announcement/.test(k) ? "announcement" : /weekly/.test(k) ? "weekly" : /catch/.test(k) ? "catchup" : "summary"; voiceReply.current = true; say(pick(ACKS)); await generate(draft[2] ? cmd.slice(cmd.toLowerCase().indexOf(draft[2])) : `Prepare the ${k}.`, dk); return; }
      if (/weekly report/.test(c)) { voiceReply.current = true; say(pick(ACKS)); await generate("Prepare this week's class report from the recorded activities.", "weekly"); return; }
      voiceReply.current = true; await ask(cmd, true);
    }
  });
  avaRef.current = ava;
  useEffect(() => {
    if (messages.length <= spokenCount.current) { spokenCount.current = messages.length; return; }
    spokenCount.current = messages.length;
    const last = messages[messages.length - 1];
    if (voiceReply.current && last?.role === "assistant") { voiceReply.current = false; if (ava.listening) ava.speak(last.content, pick(FOLLOWUPS), true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  useEffect(() => { if (error && voiceReply.current) { voiceReply.current = false; if (ava.listening) ava.speak(error); } }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === "a") { e.preventDefault(); setVoicePanelOpen(open => { if (open) { avaRef.current?.stop(); return false; } avaRef.current?.toggle(); return true; }); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  const send = () => void ask();
  return <SectionShell bare title="AI Workspace" description="A document-aware assistant for academic coordination, class communication and study support."><div className="workspace">
    <div className="workspace-head"><div><div className="workspace-title">ClassDesk Intelligence</div><div className="workspace-meta">AFIT · ND1 Electrical &amp; Electronics · Private session</div></div><div className="actions"><span className="tag">{busy ? "Processing" : queued ? `${queued} QUEUED` : "Ready"}</span><Link className="btn ghost" href="/api/export/catch-up">Catch-up DOCX</Link><Link className="btn ghost" href="/api/export/catch-up/pdf">Catch-up PDF</Link><Link className="btn ghost" href="/api/export/weekly/pdf">Weekly PDF</Link></div></div>
    {!messages.length ? <div className="ai-intro"><div className="ai-orb">✳</div><div className="hello">Hello, Class Rep</div><h1>What are we working on?</h1><p>Ask about your uploaded lecture materials, organise class information, or prepare a draft. Answers should be checked against verified AFIT information before sharing.</p><div className="prompt-suggestions">{suggestions.map(([text, icon]) => <button key={text} className="suggestion" onClick={() => setPrompt(text)}>{text}<span className="s-icon">{icon}</span></button>)}</div></div> : <div className="chat-stream">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><div className={`message-avatar ${message.role}`}>{message.role === "assistant" ? "✳" : ""}</div><div className="message-body"><div className="message-role">{message.role === "assistant" ? "CLASSDESK AI" : "YOUR MESSAGE"}</div><div className="message-content" style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>{message.role === "assistant" && <><button type="button" className="btn ghost" onClick={() => void navigator.clipboard?.writeText(message.content)}>Copy</button><button type="button" className="btn ghost" onClick={() => { const url = URL.createObjectURL(new Blob([message.content], { type: "text/markdown" })); const link = document.createElement("a"); link.href = url; link.download = `classdesk-${kind}-${new Date().toISOString().slice(0, 10)}.md`; link.click(); URL.revokeObjectURL(url); }}>Download</button><button type="button" className="btn ghost" onClick={async () => { const response = await fetch("/api/export/docx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `ClassDesk ${kind} ${new Date().toISOString().slice(0, 10)}`, content: message.content }) }); if (!response.ok) { setError("Word export failed"); return; } const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `classdesk-${kind}.docx`; link.click(); URL.revokeObjectURL(url); }}>Word</button></>}{message.sources?.length ? <div className="message-sources">{message.sources.map((source, i) => <span className="source-chip" key={i}>{source.title || source.filename || `Document ${i + 1}`}</span>)}</div> : null}</div></div>)}</div>}
    {busy && <div className="status-line"><span className="status-dot" />{status || "Thinking…"}<div className="loading-bar" /></div>}{ava.listening && <div className="status-line" role="status"><span className="status-dot" />{ava.awake ? "Ava: I'm listening — go ahead…" : "Listening — say “Ava, …” to give a command"}{ava.heard ? <span style={{opacity:.6}}> · heard: “{ava.heard}”</span> : null}</div>}{ava.listening && ava.voices.length > 1 && <select className="chip-select" aria-label="Ava voice" value={ava.voiceName} onChange={e => { ava.setVoiceName(e.target.value); ava.speak("Hi, this is how I sound now."); }}><option value="">Ava voice: auto (best)</option>{ava.voices.map(v => <option key={v} value={v}>{v.replace(/^Microsoft |^Google /, "")}</option>)}</select>}{ava.listening && <div className="approval-note">Ears: {ava.cloud.stt ? "Mistral Voxtral" : "browser"} · Voice: {ava.cloud.tts ? "ElevenLabs" : "PC voice"}</div>}{ava.listening && !messages.length && <div className="approval-note">Try: “Ava, what’s due?” · “Ava, draft an announcement about Friday’s lecture” · “Ava, open calendar” · “Ava, add a task to print lab sheets”. Shortcut: Alt+A.</div>}{ava.voiceError && <div className="error-text" role="alert">{ava.voiceError}</div>}{error && <div className="error-text" role="status">{error}</div>}
    <div className="composer-wrap"><div className="composer"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Message ClassDesk…" aria-label="Message ClassDesk" /><div className="composer-bottom"><div className="composer-tools"><Link className="icon-btn" href="/notes" aria-label="Open lecture notes upload">＋</Link><button type="button" className={`icon-btn mic-btn${ava.listening ? " on" : ""}${ava.awake ? " awake" : ""}`} aria-pressed={ava.listening} aria-label={ava.listening ? "Stop listening" : "Talk to Ava"} title={ava.supported ? (ava.listening ? "Listening for “Ava…” — tap to stop" : "Tap to start Ava voice") : "Voice not supported in this browser"} disabled={!ava.supported} onClick={() => { if (voicePanelOpen) { ava.stop(); setVoicePanelOpen(false); } else { setVoicePanelOpen(true); ava.toggle(); } }}>{ava.listening ? "◉" : "🎙"}</button><select className="chip-select" aria-label="Draft type" value={kind} onChange={event => setKind(event.target.value)}><option value="announcement">Announcement</option><option value="weekly">Weekly report</option><option value="catchup">Catch-up guide</option><option value="summary">Study summary</option></select></div><div className="actions"><button className="btn" disabled={busy} onClick={() => void generate("Prepare this week's class report from the recorded activities.")}>Weekly report</button><button className="btn" disabled={busy || !prompt.trim()} onClick={() => void generate()}>Generate draft</button><button className="send-btn" aria-label="Send" disabled={busy || !prompt.trim()} onClick={send}>↑</button></div></div></div><div className="approval-note">AI output is a draft, not an official AFIT notice. Verify facts and approve all content before sharing it with the class.</div></div>
    {voicePanelOpen && <div className="ava-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { ava.stop(); setVoicePanelOpen(false); } }}>
      <section className="ava-voice-panel" role="dialog" aria-modal="true" aria-labelledby="ava-voice-title">
        <div className="ava-voice-top"><span className="tag">CLASSDESK VOICE</span><button type="button" className="icon-btn" aria-label="Close voice interface" onClick={() => { ava.stop(); setVoicePanelOpen(false); }}>×</button></div>
        <div className={"ava-voice-orb " + (ava.listening ? "is-listening" : "")} aria-hidden="true"><span>✳</span></div>
        <h2 id="ava-voice-title">Ava</h2>
        <p className="ava-voice-state">{ava.listening ? "Listening — speak naturally" : ava.voiceError ? "Voice unavailable" : "Voice session paused"}</p>
        <div className="ava-voice-transcript" aria-live="polite">{ava.heard || "Tap the microphone to begin speaking. You do not need a wake word."}</div>
        {ava.voiceError && <div className="error-text" role="alert">{ava.voiceError}</div>}
        <div className="ava-voice-actions"><button type="button" className="btn" onClick={() => { ava.stop(); setVoicePanelOpen(false); }}>Close</button><button type="button" className="btn primary" onClick={() => { if (ava.listening) ava.stop(); else ava.toggle(); }}>{ava.listening ? "Stop listening" : "Start listening"}</button></div>
        <p className="approval-note">Ava only uses your microphone while this voice session is active.</p>
      </section>
    </div>}
  </div></SectionShell>;
}
