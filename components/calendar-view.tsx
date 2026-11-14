"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { offlineDB, type CachedRecord, type OutboxItem } from "@/lib/offline-db";
import LogoutButton from "@/components/logout-button";

type CalendarRecord = CachedRecord & { type: "CALENDAR" | "TIMETABLE" };
type Tab = "calendar" | "timetable";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const nav = [["⌂","Overview","/"],["▤","Lecture & notes","/notes"],["◫","Announcements","/announcements"],["✧","AI assistant","/assistant"],["↗","Catch-up centre","/catch-up"],["◧","Coverage","/coverage"],["▦","Class records","/records"],["∑","Courses","/courses"],["▧","Lectures","/lectures"],["◷","Assignments","/assignments"],["▦","Calendar & timetable","/calendar"],["◉","Attendance","/attendance"],["◇","Class concerns","/concerns"],["⚙","Settings","/settings"]];
const blank = { title:"", content:"", date:"", time:"08:00", endTime:"09:00", venue:"", category:"CLASS", day:"Monday", lecturer:"" };
function nowString() { return new Date().toISOString(); }
function meta(record: CachedRecord) { return (record.metadata || {}) as Record<string, string>; }
function dateLabel(value?: string | null) { if (!value) return "Date not set"; const d = new Date(value); return Number.isNaN(d.getTime()) ? "Date not set" : d.toLocaleString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); }

export default function CalendarView({ isPrimaryAdmin }: { isPrimaryAdmin: boolean }) {
  const [tab,setTab] = useState<Tab>("calendar");
  const [events,setEvents] = useState<CalendarRecord[]>([]);
  const [slots,setSlots] = useState<CalendarRecord[]>([]);
  const [form,setForm] = useState(blank);
  const [editing,setEditing] = useState<string | null>(null);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [online,setOnline] = useState(true);
  const [showForm,setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a,b,c,d] = await Promise.all([fetch("/api/records?type=CALENDAR&limit=200",{cache:"no-store"}),fetch("/api/records?type=TIMETABLE&limit=200",{cache:"no-store"}),fetch("/api/academic?resource=assignments",{cache:"no-store"}),fetch("/api/academic?resource=lectures",{cache:"no-store"})]);
      if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("Could not load calendar records");
      const [ar,br,cr,dr] = await Promise.all([a.json(),b.json(),c.json(),d.json()]);
      const all = [...(ar.records as CachedRecord[]),...(br.records as CachedRecord[])];
      const linked: CachedRecord[] = [
        ...(cr.items as Array<{id:string;title:string;details:string;dueAt:string|null;status:string;course?:{code:string}|null}>).filter(x=>x.dueAt&&x.status!=="DONE").map(x=>({id:`assignment:${x.id}`,type:"CALENDAR",title:x.title,content:x.details,metadata:{category:"DEADLINE",source:"ASSIGNMENT",courseCode:x.course?.code||""},eventDate:x.dueAt,updatedAt:nowString(),version:1,syncState:"synced" as const})),
        ...(dr.items as Array<{id:string;topic:string;summary:string;scheduledAt:string|null;venue:string|null;course?:{code:string}|null}>).filter(x=>x.scheduledAt&&new Date(x.scheduledAt).getTime()>=Date.now()).map(x=>({id:`lecture:${x.id}`,type:"CALENDAR",title:x.topic,content:x.summary,metadata:{category:"CLASS",source:"LECTURE",venue:x.venue||"",courseCode:x.course?.code||""},eventDate:x.scheduledAt,updatedAt:nowString(),version:1,syncState:"synced" as const})),
      ];
      if (offlineDB) {
        const localPending = await offlineDB.records.where("syncState").equals("pending").toArray();
        const pendingIds = new Set(localPending.map(x=>x.id));
        const pendingDeletes = new Set((await offlineDB.outbox.toArray()).filter(x=>x.operation==="delete").map(x=>x.entityId));
        await offlineDB.records.bulkPut(all.filter(x=>!pendingIds.has(x.id)&&!pendingDeletes.has(x.id)).map(x=>({...x,metadata:x.metadata||{},syncState:"synced" as const})));
        const merged = [...all.filter(x=>!pendingIds.has(x.id)&&!pendingDeletes.has(x.id)),...localPending.filter(x=>x.type==="CALENDAR"||x.type==="TIMETABLE")];
        setEvents([...merged.filter(x=>x.type==="CALENDAR"),...linked] as CalendarRecord[]);
        setSlots(merged.filter(x=>x.type==="TIMETABLE") as CalendarRecord[]);
      } else {
        setEvents([...(ar.records as CachedRecord[]),...linked] as CalendarRecord[]); setSlots(br.records);
      }
    } catch {
      if (offlineDB) {
        const local = await offlineDB.records.where("type").anyOf(["CALENDAR","TIMETABLE"]).toArray();
        setEvents(local.filter(x=>x.type==="CALENDAR") as CalendarRecord[]);
        setSlots(local.filter(x=>x.type==="TIMETABLE") as CalendarRecord[]);
        setMessage("Showing saved device data. Connect to sync changes.");
      } else setMessage("Unable to load calendar data.");
    }
  },[]);

  const sync = useCallback(async () => {
    if (!navigator.onLine || !offlineDB) return;
    const queue = await offlineDB.outbox.orderBy("createdAt").limit(100).toArray();
    if (!queue.length) return;
    setBusy(true);
    try {
      const response = await fetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mutations:queue})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sync failed");
      if (result.appliedIds?.length) {
        await offlineDB.outbox.bulkDelete(result.appliedIds);
        for (const id of result.appliedIds) { const mutation = queue.find(x=>x.id===id); if (mutation?.operation==="upsert") { const local=await offlineDB.records.get(mutation.entityId); if(local) await offlineDB.records.put({...local,syncState:"synced"}); } }
      }
      if (result.conflicts?.length) {
        for (const conflict of result.conflicts as Array<{id:string;entityId:string;reason:string;serverRecord:CachedRecord|null}>) {
          const mutation=queue.find(x=>x.id===conflict.id);
          if(mutation) await offlineDB.meta.put({key:`conflict:${conflict.id}`,value:JSON.stringify({...conflict,mutation,createdAt:new Date().toISOString()})});
        }
        setMessage(`${result.conflicts.length} change(s) need review in the dashboard conflict panel.`);
      } else setMessage(result.rejected?.length ? "Some changes remain queued." : "Calendar changes synced.");
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Sync failed; local changes are retained."); }
    finally { setBusy(false); }
  },[load]);

  useEffect(()=>{ setOnline(navigator.onLine); void load(); const on=()=>{setOnline(navigator.onLine);if(navigator.onLine) void sync();}; window.addEventListener("online",on);window.addEventListener("offline",on);return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",on);}; },[load,sync]);

  const orderedSlots = useMemo(()=>[...slots].sort((a,b)=>{const ma=meta(a),mb=meta(b);return DAYS.indexOf(ma.day)-DAYS.indexOf(mb.day)||String(ma.startTime).localeCompare(String(mb.startTime));}),[slots]);
  const orderedEvents = useMemo(()=>[...events].sort((a,b)=>new Date(a.eventDate||0).getTime()-new Date(b.eventDate||0).getTime()),[events]);

  function reset() { setForm(blank);setEditing(null);setShowForm(false); }
  function edit(record: CalendarRecord) { const m=meta(record);setEditing(record.id);setForm({title:record.title,content:record.content,date:record.eventDate?(()=>{const d=new Date(record.eventDate);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;})():"",time:m.time||m.startTime||"08:00",endTime:m.endTime||"09:00",venue:m.venue||"",category:m.category||"CLASS",day:m.day||"Monday",lecturer:m.lecturer||""});setShowForm(true); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (tab==="calendar" && !form.date) {setMessage("Choose a date for this event.");return;}
    if (form.endTime<=form.time) {setMessage("The class end time must be after its start time.");return;}
    const id=editing || crypto.randomUUID();
    const type=tab==="calendar"?"CALENDAR":"TIMETABLE";
    const eventDate=tab==="calendar"?new Date(`${form.date}T${form.time}:00`).toISOString():null;
    const metadata=tab==="calendar"?{category:form.category,venue:form.venue,time:form.time,endTime:form.endTime}:{day:form.day,startTime:form.time,endTime:form.endTime,venue:form.venue,lecturer:form.lecturer};
    const now=new Date().toISOString();
    const old=[...events,...slots].find(x=>x.id===id);
    const record: CachedRecord={id,type,title:form.title.trim(),content:form.content,metadata,eventDate,updatedAt:now,version:old?.version??0,syncState:"pending"};
    setBusy(true);setMessage("");
    try {
      const queuedBeforeSave = offlineDB ? await offlineDB.outbox.where("entityId").equals(id).first() : undefined;
      if (navigator.onLine && !(editing && queuedBeforeSave)) {
        const response=await fetch("/api/records",{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(editing?{id,title:record.title,type,content:record.content,metadata,eventDate}:{id,title:record.title,type,content:record.content,metadata,eventDate})});
        const result=await response.json();if(!response.ok) throw new Error(result.error||"Could not save record");
        if(offlineDB) await offlineDB.records.put({...result.record,metadata:result.record.metadata||{},syncState:"synced"});
        setMessage("Saved to ClassDesk.");
      } else {
        if (!offlineDB) throw new Error("Offline storage is unavailable in this browser.");
        await offlineDB.records.put(record);
        const queued = await offlineDB.outbox.where("entityId").equals(id).first();
        const mutation:OutboxItem={id:queued?.id||crypto.randomUUID(),entityType:"record",entityId:id,operation:"upsert",baseVersion:queued?.baseVersion??old?.version??0,payload:record,createdAt:queued?.createdAt||now};
        await offlineDB.outbox.put(mutation);
        setMessage("Saved on this device. It will sync when you reconnect.");
        if (navigator.onLine) void sync();
      }
      reset();await load();
    } catch(e) { setMessage(e instanceof Error?e.message:"Could not save item."); }
    finally {setBusy(false);}
  }

  async function remove(record: CalendarRecord) {
    if (!isPrimaryAdmin) { setMessage("Only the Class Representative can delete calendar entries."); return; }
    if (!window.confirm(`Delete “${record.title}”?`)) return;
    try {
      if(navigator.onLine) {const r=await fetch(`/api/records?id=${encodeURIComponent(record.id)}`,{method:"DELETE"});if(!r.ok) throw new Error("Could not delete item");if(offlineDB){await offlineDB.records.delete(record.id);const queued=await offlineDB.outbox.where("entityId").equals(record.id).first();if(queued) await offlineDB.outbox.delete(queued.id);}}
      else if(offlineDB) {await offlineDB.records.delete(record.id);const queued=await offlineDB.outbox.where("entityId").equals(record.id).first();if(queued?.operation==="upsert"&&queued.baseVersion===0){await offlineDB.outbox.delete(queued.id);}else{await offlineDB.outbox.put({id:queued?.id||crypto.randomUUID(),entityType:"record",entityId:record.id,operation:"delete",baseVersion:queued?.baseVersion??record.version,payload:{},createdAt:queued?.createdAt||new Date().toISOString()});}}
      await load();setMessage("Item deleted.");
    } catch(e) {setMessage(e instanceof Error?e.message:"Delete failed.");}
  }

  const activeRecords=tab==="calendar"?orderedEvents:orderedSlots;
  return <div className="shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">✳</div><div><strong>ClassDesk</strong><small>AFIT · ND1 · 2026/27</small></div></div><div className="nav-label">Workspace</div><nav className="nav">{nav.filter(([label])=>label!=="Settings"||isPrimaryAdmin).map(([icon,label,href])=><Link key={href} className={href==="/calendar"?"active":""} href={href}><span>{icon}</span>{label}</Link>)}</nav><div style={{marginTop:"auto"}} className="notice">Private workspace<br/><span className="muted">Two authorised staff accounts</span></div><LogoutButton/></aside>
    <main className="main"><div className="topline"><div><div className="eyebrow">ACADEMIC PLANNING / 2026–2027</div><h1>Calendar & timetable</h1><div className="sub">Keep recurring class times separate from dated academic events. Only enter schedules that have been confirmed.</div></div><div className="actions"><span className="tag">{online?"ONLINE":"OFFLINE"}</span><button className="btn ghost" onClick={()=>void sync()} disabled={busy}>{busy?"Syncing…":"↻ Sync"}</button></div></div>
      {message&&<p className="sub" role="status">{message}</p>}
      <div className="row" style={{marginBottom:16,flexWrap:"wrap"}}><div className="actions"><button className={`btn ${tab==="calendar"?"primary":""}`} onClick={()=>{setTab("calendar");reset();}}>Academic calendar</button><button className={`btn ${tab==="timetable"?"primary":""}`} onClick={()=>{setTab("timetable");reset();}}>Weekly timetable</button></div><div className="actions"><a className="btn" href="/api/export/calendar">↓ Export .ics</a><button className="btn primary" onClick={()=>{reset();setShowForm(true);}}>＋ Add {tab==="calendar"?"event":"class slot"}</button></div></div>
      {showForm&&<form className="panel" onSubmit={save} style={{marginBottom:16}}><div className="row"><h2>{editing?"Edit":"Add"} {tab==="calendar"?"academic event":"weekly class slot"}</h2><button type="button" className="btn ghost" onClick={reset}>Close</button></div>
        <div className="field"><label>{tab==="calendar"?"Event title":"Course / class title"}</label><input required maxLength={180} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder={tab==="calendar"?"e.g. Departmental test":"e.g. EEE 111 — Basic Electricity"}/></div>
        <div className="grid"><div className="field" style={{gridColumn:"span 6"}}><label>{tab==="calendar"?"Date":"Day of week"}</label>{tab==="calendar"?<input required type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>:<select value={form.day} onChange={e=>setForm({...form,day:e.target.value})}>{DAYS.slice(1).concat(DAYS[0]).map(d=><option key={d}>{d}</option>)}</select>}</div><div className="field" style={{gridColumn:"span 3"}}><label>Starts</label><input required type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></div><div className="field" style={{gridColumn:"span 3"}}><label>Ends</label><input required type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></div></div>
        {tab==="calendar"&&<div className="field"><label>Event category</label><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option value="CLASS">Class / lecture</option><option value="TEST">Test / assessment</option><option value="EXAM">Examination</option><option value="DEADLINE">Academic deadline</option><option value="DEPARTMENT">Departmental activity</option><option value="OTHER">Other</option></select></div>}
        <div className="grid"><div className="field" style={{gridColumn:"span 6"}}><label>Venue</label><input maxLength={120} value={form.venue} onChange={e=>setForm({...form,venue:e.target.value})} placeholder="Room / lecture hall"/></div>{tab==="timetable"&&<div className="field" style={{gridColumn:"span 6"}}><label>Lecturer (optional)</label><input maxLength={120} value={form.lecturer} onChange={e=>setForm({...form,lecturer:e.target.value})}/></div>}</div>
        <div className="field"><label>Notes / details</label><textarea value={form.content} onChange={e=>setForm({...form,content:e.target.value})} placeholder="Add verified details, source or instructions…"/></div><div className="actions"><button className="btn primary" disabled={busy}>{busy?"Saving…":"Save"}</button><button type="button" className="btn" onClick={reset}>Cancel</button></div></form>}
      <section className="panel"><div className="row"><div><h2>{tab==="calendar"?"Upcoming academic events":"Weekly class timetable"}</h2><p className="sub">{tab==="calendar"?"Dated events, open assignment deadlines and scheduled lectures in one chronological view.":"Recurring weekly slots. The timetable is empty until confirmed class times are entered."}</p></div><span className="tag">{activeRecords.length} {tab==="calendar"?"EVENTS":"SLOTS"}</span></div>
        {activeRecords.length===0?<div className="empty">Nothing recorded yet. Add confirmed {tab==="calendar"?"academic events":"weekly class slots"} to build this view.</div>:tab==="calendar"?orderedEvents.map(r=><div className="item" key={r.id}><div className="row"><strong>{r.title}</strong><span className="tag">{meta(r).category||"EVENT"}</span></div><p>{dateLabel(r.eventDate)}{meta(r).venue?` · ${meta(r).venue}`:""}{meta(r).courseCode?` · ${meta(r).courseCode}`:""}</p>{r.content&&<p>{r.content}</p>}{meta(r).source? <div className="actions" style={{marginTop:9}}><Link className="btn" href={meta(r).source==="ASSIGNMENT"?"/assignments":"/lectures"}>Open {meta(r).source.toLowerCase()} →</Link></div>:<div className="actions" style={{marginTop:9}}><button className="btn" onClick={()=>edit(r)}>Edit</button>{isPrimaryAdmin&&<button className="btn" onClick={()=>void remove(r)}>Delete</button>}</div>}</div>):DAYS.slice(1).concat(DAYS[0]).map(day=>{const rows=orderedSlots.filter(x=>meta(x).day===day);return <div className="item" key={day}><div className="row"><strong>{day}</strong><span className="tag">{rows.length} CLASSES</span></div>{rows.length?rows.map(r=><div key={r.id} style={{padding:"10px 0 4px 12px",borderLeft:"2px solid var(--accent)",margin:"9px 0"}}><div className="row"><strong>{meta(r).startTime}–{meta(r).endTime} · {r.title}</strong><span className="muted">{meta(r).venue}</span></div>{meta(r).lecturer&&<p>{meta(r).lecturer}</p>}{r.content&&<p>{r.content}</p>}<div className="actions" style={{marginTop:7}}><button className="btn" onClick={()=>edit(r)}>Edit</button>{isPrimaryAdmin&&<button className="btn" onClick={()=>void remove(r)}>Delete</button>}</div></div>):<p className="muted">No confirmed class slots.</p>}</div>})}
      </section><div className="notice" style={{marginTop:16}}>ClassDesk does not fetch or assume AFIT&apos;s official timetable. Treat every entry as unverified until you confirm it with the relevant lecturer or department.</div><footer className="sub" style={{marginTop:28}}>AFIT ClassDesk · Personal-use academic administration · Not an official AFIT portal.</footer></main></div>;
}
