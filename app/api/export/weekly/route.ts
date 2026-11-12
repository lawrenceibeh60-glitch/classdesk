import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/http";
import { markdownToDocx } from "@/lib/docx-export";
export const runtime = "nodejs";
export async function GET() {
  const denied = await requireAdmin(); if (denied) return denied;
  const since = new Date(Date.now() - 7 * 86400000);
  const [records, lectures, assignments, announcements, concerns] = await Promise.all([
    db.academicRecord.findMany({ where: { updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: 100 }),
    db.lectureSession.findMany({ where: { OR: [{ heldAt: { gte: since } }, { scheduledAt: { gte: since } }] }, include: { course: { select: { code: true } } }, orderBy: { heldAt: "desc" } }),
    db.assignment.findMany({ where: { OR: [{ updatedAt: { gte: since } }, { dueAt: { gte: new Date() } }] }, include: { course: { select: { code: true } } }, orderBy: { dueAt: "asc" } }),
    db.announcement.findMany({ where: { updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" } }),
    db.classConcern.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);
  const lines = ["# Weekly class representative report", `Reporting period: ${since.toLocaleDateString("en-GB")} – ${new Date().toLocaleDateString("en-GB")}`, "", "This report contains recorded information only. Blank sections mean no corresponding information was entered; they do not mean no activity occurred.", "", "## Class records"];
  lines.push(...(records.length ? records.map((r) => `- **${r.type} — ${r.title}** · ${r.status}\n  ${r.content.slice(0, 500)}`) : ["- No class records updated this week."]));
  lines.push("", "## Lecture sessions"); lines.push(...(lectures.length ? lectures.map((l) => `- ${l.course?.code || "Unassigned"} — ${l.topic} · ${l.heldAt?.toLocaleDateString("en-GB") || "Date not recorded"}`) : ["- No lecture sessions recorded for this period."]));
  lines.push("", "## Assignments and deadlines"); lines.push(...(assignments.length ? assignments.map((a) => `- ${a.course?.code || "Unassigned"} — ${a.title} · ${a.status} · Due ${a.dueAt?.toLocaleDateString("en-GB") || "not recorded"}`) : ["- No relevant assignments recorded."]));
  lines.push("", "## Announcements"); lines.push(...(announcements.length ? announcements.map((a) => `- ${a.title} · ${a.status}`) : ["- No announcements updated this week."]));
  lines.push("", "## Unresolved class concerns"); lines.push(...(concerns.length ? concerns.map((c) => `- ${c.category} — ${c.title} · ${c.status}\n  ${c.details}`) : ["- No unresolved concerns recorded."]));
  const buffer = await markdownToDocx("Weekly class report", lines.join("\n"));
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": "attachment; filename=afit-classdesk-weekly-report.docx", "Cache-Control": "private, no-store" } });
}
