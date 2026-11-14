import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/http";
import { markdownToDocx } from "@/lib/docx-export";
export const runtime = "nodejs";
export async function GET() {
  const denied = await requireStaff(); if (denied) return denied;
  const [courses, lectures, assignments, documents] = await Promise.all([
    db.course.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.lectureSession.findMany({ include: { course: { select: { code: true, name: true } } }, orderBy: [{ heldAt: "asc" }, { createdAt: "asc" }] }),
    db.assignment.findMany({ where: { status: { not: "DONE" } }, include: { course: { select: { code: true, name: true } } }, orderBy: { dueAt: "asc" } }),
    db.document.findMany({ where: { status: "READY" }, orderBy: [{ lectureDate: "asc" }, { createdAt: "asc" }], select: { title: true, filename: true, courseCode: true, courseName: true, topic: true, lectureDate: true } }),
  ]);
  const lines = ["# Academic catch-up pack", `Generated: ${new Date().toLocaleString("en-GB")}`, "", "This pack is based only on information recorded in ClassDesk. It does not establish official AFIT coverage or deadlines. Confirm details with lecturers and departmental notices.", "", "## Course catalogue"];
  lines.push(...(courses.length ? courses.map((c) => `- **${c.code} — ${c.name}**${c.lecturer ? ` · Lecturer: ${c.lecturer}` : ""}`) : ["- No courses recorded."]));
  lines.push("", "## Lectures recorded as held");
  lines.push(...(lectures.length ? lectures.map((l) => `- **${l.course?.code || "Unassigned"} — ${l.topic}** · ${l.heldAt ? l.heldAt.toLocaleDateString("en-GB") : "Date not recorded"}${l.venue ? ` · ${l.venue}` : ""}\n  ${l.summary || "No lecture summary recorded."}`) : ["- No lecture sessions recorded."]));
  lines.push("", "## Available lecture documents");
  lines.push(...(documents.length ? documents.map((d) => `- **${d.courseCode || d.courseName || "Unassigned course"} — ${d.topic || d.title}** · ${d.lectureDate ? d.lectureDate.toLocaleDateString("en-GB") : "Upload date only / lecture date unknown"} · ${d.filename}`) : ["- No searchable documents available."]));
  lines.push("", "## Outstanding assignments");
  lines.push(...(assignments.length ? assignments.map((a) => `- **${a.course?.code || "Unassigned"} — ${a.title}** · Due: ${a.dueAt ? a.dueAt.toLocaleDateString("en-GB") : "Not recorded"} · Status: ${a.status}\n  ${a.details || "No details recorded."}`) : ["- No outstanding assignments recorded."]));
  const buffer = await markdownToDocx("Academic catch-up pack", lines.join("\n"));
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": "attachment; filename=afit-classdesk-catch-up.docx", "Cache-Control": "private, no-store" } });
}
