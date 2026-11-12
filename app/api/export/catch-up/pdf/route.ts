import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/http";
export const runtime = "nodejs";
function wrap(value: string, max = 90) {
  const words = value.replace(/\s+/g, " ").trim().split(" "); const lines: string[] = []; let line = "";
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > max && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line); return lines.length ? lines : [""];
}
export async function GET() {
  const denied = await requireAdmin(); if (denied) return denied;
  const [courses, lectures, assignments, documents] = await Promise.all([
    db.course.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.lectureSession.findMany({ include: { course: { select: { code: true } } }, orderBy: [{ heldAt: "asc" }, { createdAt: "asc" }] }),
    db.assignment.findMany({ where: { status: { not: "DONE" } }, include: { course: { select: { code: true } } }, orderBy: { dueAt: "asc" } }),
    db.document.findMany({ where: { status: "READY" }, orderBy: [{ lectureDate: "asc" }, { createdAt: "asc" }], select: { title: true, filename: true, courseCode: true, courseName: true, topic: true, lectureDate: true } }),
  ]);
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]); let y = 790;
  const add = (value: string, size = 10, strong = false) => {
    const safe = value.replace(/[–—]/g, "-").replace(/[•·]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, "?");
    for (const line of wrap(safe, size > 15 ? 58 : 90)) { if (y < 55) { page = pdf.addPage([595.28, 841.89]); y = 790; } page.drawText(line, { x: 48, y, size, font: strong ? bold : regular, color: rgb(0.12, 0.15, 0.19) }); y -= size + 5; }
  };
  const section = (name: string) => { y -= 7; add(name.toUpperCase(), 12, true); y -= 3; };
  add("AFIT CLASSDESK", 10, true); y -= 5; add("ACADEMIC CATCH-UP PACK", 18, true); add(`Generated ${new Date().toLocaleString("en-GB")}`, 9); y -= 12;
  add("Based only on information recorded in ClassDesk. This is not an official AFIT syllabus or confirmation of course coverage.", 9); y -= 8;
  section(`Course catalogue (${courses.length})`); courses.forEach(c => add(`- ${c.code} - ${c.name}${c.lecturer ? ` | Lecturer: ${c.lecturer}` : ""}`)); if (!courses.length) add("No courses recorded.");
  section("Lectures recorded as held"); lectures.forEach(l => add(`- ${l.course?.code || "Unassigned"} - ${l.topic} | ${l.heldAt ? l.heldAt.toLocaleDateString("en-GB") : "Date not recorded"}${l.summary ? ` | ${l.summary}` : " | No summary recorded"}`)); if (!lectures.length) add("No lecture sessions recorded.");
  section("Available lecture documents"); documents.forEach(d => add(`- ${d.courseCode || d.courseName || "Unassigned"} - ${d.topic || d.title} | ${d.lectureDate ? d.lectureDate.toLocaleDateString("en-GB") : "Lecture date unknown"} | ${d.filename}`)); if (!documents.length) add("No searchable documents available.");
  section("Outstanding assignments"); assignments.forEach(a => add(`- ${a.course?.code || "Unassigned"} - ${a.title} | Due: ${a.dueAt ? a.dueAt.toLocaleDateString("en-GB") : "Not recorded"} | ${a.status}${a.details ? ` | ${a.details}` : ""}`)); if (!assignments.length) add("No outstanding assignments recorded.");
  return new NextResponse(new Uint8Array(await pdf.save()), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=afit-classdesk-catch-up.pdf", "Cache-Control": "private, no-store" } });
}
