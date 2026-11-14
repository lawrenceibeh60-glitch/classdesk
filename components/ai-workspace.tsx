"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAva, ACKS, FOLLOWUPS, pick } from "@/lib/use-ava";
import SectionShell from "@/components/section-shell";
import { offlineDB, type QueuedAIRequest } from "@/lib/offline-db";
type Source = { title?: string; filename?: string };
type AvaActionConfirmation = { type: "delete_document"; documentId: string; title: string; filename: string; sizeBytes: number; originalInSharedStorage: boolean };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[]; actionConfirmation?: AvaActionConfirmation };
type AvaTask = { id: string; kind: string; status: string; progress: number; currentStep: string; errorMessage?: string | null; resultDocumentId?: string | null; createdAt: string };
const suggestions: [string, string][] = [["Explain a topic from my uploaded Electrical Principles notes.", "💡"], ["Create a catch-up plan from verified lecture records.", "🗓"], ["Draft a clear WhatsApp class announcement.", "✎"], ["Summarise the latest uploaded lecture material.", "📄"]];
export default function AIWorkspace({ initialKind = "announcement" }: { initialKind?: string } = {}) {
  const [prompt, setPrompt] = useState(""); const [messages, setMessages] = useState<Message[]>([]); const [busy, setBusy] = useState(false); const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [kind, setKind] = useState(initialKind); const [queued, setQueued] = useState(0); const [voicePanelOpen, setVoicePanelOpen] = useState(false); const [tasks, setTasks] = useState<AvaTask[]>([]); const processingRef = useRef(false);

  const queueRequest = useCallback(async (item: Omit<QueuedAIRequest, "id" | "createdAt">, requestId = crypto.randomUUID()) => {
    if (!offlineDB) throw new Error("Offline request storage is unavailable in this browser.");
    await offlineDB.aiQueue.put({ ...item, id: requestId, createdAt: new Date().toISOString() });
    setQueued(await offlineDB.aiQueue.count());
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/tasks", { cache: "no-store" });
      if (response.ok) { const data = await response.json(); setTasks(data.tasks || []); }
    } catch { /* Task status is refreshed on the next poll. */ }
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
        await offlineDB.meta.put({ key: `ai-result:${item.id}`, value: JSON.stringify({ kind: item.kind, draftKind: item.draftKind, prompt: item.prompt, answer: item.kind === "chat" ? data.answer : data.output, sources: data.sources || [], actionConfirmation: data.actionConfirmation, createdAt: new Date().toISOString() }) });
        setMessages(current => {
          const question = item.kind === "chat" ? item.prompt : `Generate ${item.draftKind}: ${item.prompt}`;
          const withQuestion = current.some(message => message.role === "user" && message.content === question) ? current : [...current, { role: "user" as const, content: question }];
          return [...withQuestion, { role: "assistant", content: item.kind === "chat" ? data.answer || "No answer was returned." : data.output || "No output was returned.", sources: data.sources || [], actionConfirmation: data.actionConfirmation }];
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

  useEffect(() => {
    void refreshTasks();
    const timer = window.setInterval(() => void refreshTasks(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshTasks]);

  async function ask(text = prompt, spoken = false) {
    if (!text.trim() || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    const requestId = crypto.randomUUID();
    setMessages(m => [...m, { role: "user", content: text }]); setPrompt(""); setError("");
    const requestsAssignmentPdf = /\b(assignments?|homework)\b/i.test(text) && /\b(pdf|solve|work through|answer|complete|do them)\b/i.test(text) && /\b(upload|uploaded|document|file|notes)\b/i.test(text);
    if (requestsAssignmentPdf && navigator.onLine) {
      setBusy(true); setStatus("Finding your uploaded assignment documents…");
      try {
        const libraryResponse = await fetch("/api/documents", { cache: "no-store" });
        const library = await libraryResponse.json().catch(() => ({}));
        if (!libraryResponse.ok) throw new Error(library.error || "Could not search the document library.");
        const available = (library.documents || []).filter((doc: { id: string; title: string; filename: string; status: string }) => doc.status === "READY");
        const named = available.filter((doc: { title: string; filename: string }) => /assignment|homework|worksheet|problem[- ]?set|exercise/i.test(doc.title + " " + doc.filename));
        const selected = (named.length ? named : available.length === 1 ? available : []).slice(0, 10);
        if (!selected.length) {
          const names = available.slice(0, 6).map((doc: { title: string; filename: string }) => doc.title || doc.filename);
          setMessages(m => [...m, { role: "assistant", content: names.length ? "I found recent uploads, but I can't safely identify which ones are assignments. Please rename the relevant files to include “assignment” or tell me their exact titles: " + names.join("; ") : "I couldn't find any ready uploaded documents. Upload the assignment first, then ask me to work through it and create a PDF." }]);
        } else {
          setStatus("Queuing a persistent assignment task…");
          const taskResponse = await fetch("/api/ai/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "assignment_pdf", documentIds: selected.map((doc: { id: string }) => doc.id), prompt: text }) });
          const payload = await taskResponse.json().catch(() => ({}));
          if (!taskResponse.ok) throw new Error(payload.error || "Ava could not queue the assignment task.");
          await refreshTasks();
          const titles = selected.map((doc: { title: string }) => doc.title).join(", ");
          setMessages(m => [...m, { role: "assistant", content: "I've queued this as a background task. I'll keep working after you close the voice panel. Source documents: " + titles + ". You can follow progress in the Ava Tasks panel below; the PDF download will appear here when it's ready." }]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the Ava task.");
      } finally { setBusy(false); setStatus(""); }
      return;
    }
    if (!navigator.onLine) { try { await queueRequest({ kind: "chat", prompt: text, history, draftKind: kind }, requestId); setError("Saved locally. ClassDesk will answer when your device reconnects and the AI service is available."); } catch (e) { setError(e instanceof Error ? e.message : "Could not queue request"); } return; }
    setBusy(true); setStatus("Searching class notes…");
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history, clientRequestId: requestId, voice: spoken }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "AI request failed");
      setMessages(m => [...m, { role: "assistant", content: data.answer || "No answer was returned.", sources: data.sources || [], actionConfirmation: data.actionConfirmation }]);
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
  async function confirmDocumentDelete(action: AvaActionConfirmation, messageIndex: number) {
    setBusy(true); setStatus("Verifying permanent deletion…"); setError("");
    try {
      const response = await fetch("/api/ai/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_document", documentId: action.documentId, confirmPermanent: true, confirmTitle: action.title })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Permanent deletion failed.");
      if (!result.deleted?.databaseRecord || (action.originalInSharedStorage && !result.deleted?.sharedStorageObject)) {
        throw new Error("The deletion result was incomplete. Check the privileged-action audit log before retrying.");
      }
      setMessages(current => current.map((message, index) => index === messageIndex
        ? { ...message, content: "Verified: " + action.title + " was deleted from the ClassDesk database" + (action.originalInSharedStorage ? " and shared object storage." : "."), actionConfirmation: undefined }
        : message));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permanent deletion failed.");
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
  // Voice activation is intentionally microphone-button-only; no keyboard shortcut starts the microphone.
  const send = () => void ask();
  return <SectionShell bare title="AI Workspace" description="A document-aware assistant for academic coordination, class communication and study support."><div className="workspace">
    <div className="workspace-head"><div><div className="workspace-title">ClassDesk Intelligence</div><div className="workspace-meta">AFIT · ND1 Electrical &amp; Electronics · Private session</div></div><div className="actions"><span className="tag">{busy ? "Processing" : queued ? `${queued} QUEUED` : "Ready"}</span><Link className="btn ghost" href="/api/export/catch-up">Catch-up DOCX</Link><Link className="btn ghost" href="/api/export/catch-up/pdf">Catch-up PDF</Link><Link className="btn ghost" href="/api/export/weekly/pdf">Weekly PDF</Link></div></div>
    {tasks.length > 0 && <section className="task-panel" aria-label="Ava background tasks" style={{ margin: "14px 0", padding: 14, border: "1px solid #26384B", background: "#0D1723" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}><strong style={{ color: "#42D9F5", letterSpacing: 1 }}>AVA TASK ACTIVITY</strong><button type="button" className="btn ghost" onClick={() => void refreshTasks()}>Refresh</button></div>
      {tasks.map(task => <div key={task.id} style={{ padding: "10px 0", borderTop: "1px solid #26384B" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong>{task.kind === "assignment_pdf" ? "Assignment worked solutions" : "Study summary"}</strong><span>{task.status}</span></div>
        <div style={{ color: "#91A4B8", fontSize: 12, margin: "5px 0" }}>{task.currentStep} · {task.progress}%</div>
        <div style={{ height: 4, background: "#26384B" }}><div style={{ width: Math.max(0, Math.min(100, task.progress)) + "%", height: 4, background: "#42D9F5" }} /></div>
        {task.errorMessage && <div className="error-text">{task.errorMessage}</div>}
        {task.resultDocumentId && <a className="btn ghost" href={"/api/documents/" + task.resultDocumentId}>Download generated PDF</a>}
        {task.status === "QUEUED" && <button type="button" className="btn ghost" onClick={async () => { const r = await fetch("/api/ai/tasks/" + task.id, { method: "DELETE" }); if (r.ok) void refreshTasks(); }}>Cancel queued task</button>}
      </div>)}
    </section>}
    {!messages.length ? <div className="ai-intro"><div className="ai-orb">✳</div><div className="hello">Hello, Class Rep</div><h1>What are we working on?</h1><p>Ask about your uploaded lecture materials, organise class information, or prepare a draft. Answers should be checked against verified AFIT information before sharing.</p><div className="prompt-suggestions">{suggestions.map(([text, icon]) => <button key={text} className="suggestion" onClick={() => setPrompt(text)}>{text}<span className="s-icon">{icon}</span></button>)}</div></div> : <div className="chat-stream">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><div className={`message-avatar ${message.role}`}>{message.role === "assistant" ? "✳" : ""}</div><div className="message-body"><div className="message-role">{message.role === "assistant" ? "CLASSDESK AI" : "YOUR MESSAGE"}</div><div className="message-content" style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>{message.role === "assistant" && <><button type="button" className="btn ghost" onClick={() => void navigator.clipboard?.writeText(message.content)}>Copy</button><button type="button" className="btn ghost" onClick={() => { const url = URL.createObjectURL(new Blob([message.content], { type: "text/markdown" })); const link = document.createElement("a"); link.href = url; link.download = `classdesk-${kind}-${new Date().toISOString().slice(0, 10)}.md`; link.click(); URL.revokeObjectURL(url); }}>Download</button><button type="button" className="btn ghost" onClick={async () => { const response = await fetch("/api/export/docx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `ClassDesk ${kind} ${new Date().toISOString().slice(0, 10)}`, content: message.content }) }); if (!response.ok) { setError("Word export failed"); return; } const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `classdesk-${kind}.docx`; link.click(); URL.revokeObjectURL(url); }}>Word</button></>}{message.sources?.length ? <div className="message-sources">{message.sources.map((source, i) => <span className="source-chip" key={i}>{source.title || source.filename || `Document ${i + 1}`}</span>)}</div> : null{message.actionConfirmation && <div className="approval-note" style={{ marginTop: 12, padding: 12, border: "1px solid #A34D4D" }}><strong>PERMANENT DELETION CONFIRMATION</strong><p>{message.actionConfirmation.title} · {message.actionConfirmation.filename}</p><p>This will remove the database record, extracted text, indexed chunks and original file from shared storage.</p><button type="button" className="btn" disabled={busy} onClick={() => void confirmDocumentDelete(message.actionConfirmation!, index)}>Confirm permanent deletion</button><button type="button" className="btn ghost" disabled={busy} onClick={() => setMessages(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, actionConfirmation: undefined, content: item.content + " You cancelled the deletion." } : item))}>Cancel</button></div>}}</div></div>)}</div>}
    {busy && <div className="status-line"><span className="status-dot" />{status || "Thinking…"}<div className="loading-bar" /></div>}{ava.listening && <div className="status-line" role="status"><span className="status-dot" />{ava.awake ? "Ava: I'm listening — go ahead…" : "Listening — speak naturally"}{ava.heard ? <span style={{opacity:.6}}> · heard: “{ava.heard}”</span> : null}</div>}{ava.listening && ava.voices.length > 1 && <select className="chip-select" aria-label="Ava voice" value={ava.voiceName} onChange={e => { ava.setVoiceName(e.target.value); ava.speak("Hi, this is how I sound now."); }}><option value="">Ava voice: auto (best)</option>{ava.voices.map(v => <option key={v} value={v}>{v.replace(/^Microsoft |^Google /, "")}</option>)}</select>}{ava.listening && <div className="approval-note">Ears: {ava.cloud.stt ? "Mistral Voxtral" : "browser"} · Voice: {ava.cloud.tts ? "ElevenLabs" : "PC voice"}</div>}{ava.listening && !messages.length && <div className="approval-note">Try: “What’s due?” · “Draft an announcement about Friday’s lecture” · “Open calendar” · “Add a task to print lab sheets”. Tap the microphone to start voice mode.</div>}{ava.voiceError && <div className="error-text" role="alert">{ava.voiceError}</div>}{error && <div className="error-text" role="status">{error}</div>}
    <div className="composer-wrap"><div className="composer"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Message ClassDesk…" aria-label="Message ClassDesk" /><div className="composer-bottom"><div className="composer-tools"><Link className="icon-btn" href="/notes" aria-label="Open lecture notes upload">＋</Link><button type="button" className={`icon-btn mic-btn${ava.listening ? " on" : ""}${ava.awake ? " awake" : ""}`} aria-pressed={ava.listening} aria-label={ava.listening ? "Stop listening" : "Talk to Ava"} title={ava.supported ? (ava.listening ? "Listening — tap to stop" : "Tap to start Ava voice") : "Voice not supported in this browser"} disabled={!ava.supported} onClick={() => { if (voicePanelOpen) { ava.stop(); setVoicePanelOpen(false); } else { setVoicePanelOpen(true); ava.toggle(); } }}>{ava.listening ? "◉" : "🎙"}</button><select className="chip-select" aria-label="Draft type" value={kind} onChange={event => setKind(event.target.value)}><option value="announcement">Announcement</option><option value="weekly">Weekly report</option><option value="catchup">Catch-up guide</option><option value="summary">Study summary</option></select></div><div className="actions"><button className="btn" disabled={busy} onClick={() => void generate("Prepare this week's class report from the recorded activities.")}>Weekly report</button><button className="btn" disabled={busy || !prompt.trim()} onClick={() => void generate()}>Generate draft</button><button className="send-btn" aria-label="Send" disabled={busy || !prompt.trim()} onClick={send}>↑</button></div></div></div><div className="approval-note">AI output is a draft, not an official AFIT notice. Verify facts and approve all content before sharing it with the class.</div></div>
    {voicePanelOpen && <div className="ava-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { ava.stop(); setVoicePanelOpen(false); } }}>
      <section className="ava-voice-panel" role="dialog" aria-modal="true" aria-labelledby="ava-voice-title">
        <div className="ava-voice-top"><div><span className="ava-kicker">AFIT CLASSDESK / VOICE INTERFACE</span><div className="ava-voice-topline">AVA <span>INTELLIGENCE CORE</span></div></div><button type="button" className="ava-close" aria-label="Close voice interface" onClick={() => { ava.stop(); setVoicePanelOpen(false); }}>×</button></div>
        <div className={"ava-voice-orb " + (ava.voiceError ? "is-error" : ava.speaking ? "is-speaking" : ava.processing ? "is-processing" : ava.listening ? "is-listening" : "is-idle")} aria-hidden="true"><span>✳</span><i /><b /></div>
        <div className="ava-voice-heading"><h2 id="ava-voice-title">Ava</h2><span className={"ava-state-indicator " + (ava.voiceError ? "error" : ava.speaking ? "speaking" : ava.processing ? "processing" : ava.listening ? "listening" : "idle")}><i />{ava.voiceError ? "VOICE ERROR" : ava.speaking ? "SPEAKING" : ava.processing ? "PROCESSING" : ava.listening ? "LISTENING" : "STANDBY"}</span></div>
        <p className="ava-voice-state">{ava.voiceError ? "Audio channel needs attention" : ava.speaking ? "Ava is responding" : ava.processing ? "Interpreting your request" : ava.listening ? "Listening for your instruction" : "Voice session is paused"}</p>
        <div className="ava-voice-readout" aria-live="polite"><div className="ava-readout-label">LATEST INPUT <span>01 / VOICE</span></div><div className="ava-voice-transcript">{ava.heard || "Your spoken instruction will appear here when you activate the microphone."}</div><div className="ava-readout-label response">LATEST RESPONSE <span>02 / AVA</span></div><div className="ava-voice-response">{[...messages].reverse().find(message => message.role === "assistant")?.content || "Ava's response will appear here."}</div></div>
        {ava.voiceError && <div className="error-text" role="alert">{ava.voiceError}</div>}
        <div className="ava-voice-actions"><button type="button" className="btn" onClick={() => { ava.stop(); setVoicePanelOpen(false); }}>END SESSION</button><button type="button" className="btn primary" onClick={() => { if (ava.listening) ava.stop(); else ava.toggle(); }}>{ava.listening ? "PAUSE MICROPHONE" : "ACTIVATE MICROPHONE"}</button></div>
        <p className="ava-privacy-line">MICROPHONE ACCESS IS LIMITED TO AN ACTIVE VOICE SESSION.</p>
      </section>
    </div>}
  </div></SectionShell>;
}
