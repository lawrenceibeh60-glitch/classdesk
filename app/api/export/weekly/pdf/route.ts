import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/http";
export const runtime = "nodejs";
function wrap(value: string, max = 92) {
  const words = value.replace(/\s+/g, " ").trim().split(" "); const lines: string[] = []; let line = "";
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > max && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line); return lines.length ? lines : [""];
}
export async function GET() {
  const denied = await requireAdmin(); if (denied) return denied;
  const [courses, lectures, assignments, announcements, concerns] = await Promise.all([
    db.course.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.lectureSession.findMany({ include: { course: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.assignment.findMany({ where: { status: { not: "DONE" } }, include: { course: { select: { code: true } } }, orderBy: { dueAt: "asc" }, take: 100 }),
    db.announcement.findMany({ where: { status: { in: ["APPROVED", "PUBLISHED"] } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.classConcern.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]); let y = 790;
  const addLine = (text: string, size = 10, strong = false) => {
    const safeText = text.replace(/[–—]/g, "-").replace(/[•·]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, "?");
    for (const line of wrap(safeText, size > 15 ? 58 : 92)) {
      if (y < 55) { page = pdf.addPage([595.28, 841.89]); y = 790; }
      page.drawText(line, { x: 48, y, size, font: strong ? bold : regular, color: rgb(0.12, 0.15, 0.19), maxWidth: 500 }); y -= size + 5;
    }
  };
  addLine("AFIT CLASSDESK", 10, true); y -= 6; addLine("WEEKLY CLASS ADMINISTRATION REPORT", 18, true); addLine(`Generated ${new Date().toLocaleString("en-GB")}`, 9); y -= 12;
  addLine("This report contains information entered into ClassDesk. It is not an official AFIT timetable, directive, or confirmation of departmental information.", 9); y -= 12;
  const section = (name: string) => { y -= 6; addLine(name.toUpperCase(), 12, true); y -= 3; };
  section(`Active courses (${courses.length})`); courses.forEach(c => addLine(`• ${c.code} — ${c.name}${c.lecturer ? ` | Lecturer: ${c.lecturer}` : ""}`)); if (!courses.length) addLine("No active courses recorded.");
  section("Lecture sessions recorded"); lectures.forEach(l => addLine(`• ${l.course?.code || "Unassigned"} — ${l.topic} | ${l.heldAt ? `Held ${l.heldAt.toLocaleDateString("en-GB")}` : "Not marked as held"}${l.summary ? ` | ${l.summary}` : ""}`)); if (!lectures.length) addLine("No lecture sessions recorded.");
  section("Outstanding assignments"); assignments.forEach(a => addLine(`• ${a.course?.code || "Unassigned"} — ${a.title} | Due: ${a.dueAt ? a.dueAt.toLocaleDateString("en-GB") : "Not recorded"} | ${a.status}`)); if (!assignments.length) addLine("No outstanding assignments recorded.");
  section("Approved / published notices"); announcements.forEach(a => addLine(`• ${a.title} | ${a.status} | ${a.updatedAt.toLocaleDateString("en-GB")}`)); if (!announcements.length) addLine("No approved or published notices recorded.");
  section("Open class concerns"); concerns.forEach(c => addLine(`• ${c.category}: ${c.title} | ${c.status}`)); if (!concerns.length) addLine("No open concerns recorded.");
  const bytes = await pdf.save(); return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=afit-classdesk-weekly-report.pdf", "Cache-Control": "private, no-store" } });
}
