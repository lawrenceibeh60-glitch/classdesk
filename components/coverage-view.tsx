"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionShell from "@/components/section-shell";

type Course = { id: string; code: string; name: string; active: boolean; lecturer?: string | null };
type Lecture = { id: string; topic: string; heldAt?: string | null; scheduledAt?: string | null; summary?: string; course?: { id: string; code: string; name: string } | null };
type DocumentItem = { id: string; title: string; courseCode?: string | null; courseName?: string | null; topic?: string | null; lectureDate?: string | null; status: string };
export default function CoverageView() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/academic?resource=courses", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error("Could not load courses"); return r.json(); }),
      fetch("/api/academic?resource=lectures", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error("Could not load lecture records"); return r.json(); }),
      fetch("/api/documents", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error("Could not load documents"); return r.json(); })
    ]).then(([c,l,d]) => { if (alive) { setCourses(c.items || []); setLectures(l.items || []); setDocuments(d.documents || []); } }).catch(e => { if (alive) setError(e instanceof Error ? e.message : "Unable to load coverage"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const rows = useMemo(() => courses.filter(c => `${c.code} ${c.name}`.toLowerCase().includes(query.toLowerCase())).map(course => {
    const held = lectures.filter(l => l.course?.id === course.id && Boolean(l.heldAt));
    const docs = documents.filter(d => d.status === "READY" && ((d.courseCode || "").toLowerCase() === course.code.toLowerCase() || (d.courseName || "").toLowerCase() === course.name.toLowerCase()));
    const dates = held.map(l => l.heldAt!).sort();
    return { course, held, docs, lastHeld: dates.at(-1) || null };
  }), [courses, lectures, documents, query]);
  const totalHeld = rows.reduce((n,r) => n + r.held.length, 0);
  const totalDocs = rows.reduce((n,r) => n + r.docs.length, 0);
  return <SectionShell title="Academic coverage" description="A factual record of lecture sessions and searchable materials entered into ClassDesk. This is not an official AFIT syllabus or a confirmation of departmental coverage.">
    <div className="coverage-stats"><div className="stat"><label>ACTIVE COURSES</label><strong>{courses.filter(c=>c.active).length}</strong></div><div className="stat"><label>LECTURES RECORDED AS HELD</label><strong>{totalHeld}</strong></div><div className="stat"><label>SEARCHABLE DOCUMENTS</label><strong>{totalDocs}</strong></div></div>
    <div className="panel"><div className="row"><h2>Course-by-course record</h2><Link className="btn" href="/courses">Manage courses</Link></div><div className="field"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter by course code or name" aria-label="Filter courses" /></div>
      {loading ? <p className="sub">Loading recorded coverage…</p> : error ? <p role="alert" className="sub">{error}</p> : rows.length ? rows.map(({course,held,docs,lastHeld}) => <article className="item" key={course.id}><div className="row"><div><strong>{course.code} · {course.name}</strong><p className="sub">{course.lecturer || "Lecturer not recorded"}</p></div><span className="tag">{course.active ? "ACTIVE" : "INACTIVE"}</span></div><div className="coverage-stats compact"><div><label>HELD SESSIONS</label><strong>{held.length}</strong></div><div><label>MATERIALS</label><strong>{docs.length}</strong></div><div><label>LAST RECORDED</label><strong className="date-value">{lastHeld ? new Date(lastHeld).toLocaleDateString("en-GB") : "—"}</strong></div></div>
        {held.length ? <div className="coverage-list"><strong>Recorded sessions</strong>{held.sort((a,b)=>String(b.heldAt).localeCompare(String(a.heldAt))).slice(0,5).map(l=><div key={l.id}><span>{l.topic}</span><small>{l.heldAt ? new Date(l.heldAt).toLocaleDateString("en-GB") : "Date not recorded"}</small></div>)}</div> : <p className="sub">No sessions have been recorded as held for this course.</p>}
        {docs.length ? <p className="sub">Materials: {docs.map(d=>d.topic || d.title).join(" · ")}</p> : <p className="sub">No searchable materials are linked to this course yet.</p>}
        <div className="actions"><Link className="btn ghost" href="/lectures">Add lecture record</Link><Link className="btn ghost" href="/notes">Add course material</Link></div>
      </article>) : <div className="empty">No courses match this filter. Add verified course details first.</div>}
    </div>
  </SectionShell>;
}
