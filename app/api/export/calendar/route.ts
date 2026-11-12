import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
const zone = "Africa/Lagos";
const weekdays: Record<string,string> = { Sunday:"SU",Monday:"MO",Tuesday:"TU",Wednesday:"WE",Thursday:"TH",Friday:"FR",Saturday:"SA" };
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
  return Object.fromEntries(parts.map(p=>[p.type,p.value]));
}
function stamp(date: Date) { const p=localParts(date);return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`; }
function utcStamp(date: Date) { return date.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/, "Z"); }
function escapeText(value: unknown) { return String(value??"").replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;"); }
function dayDate(day: string) {
  const now = localParts(new Date());
  const today = new Date(Date.UTC(Number(now.year),Number(now.month)-1,Number(now.day)));
  const target = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].indexOf(day);
  const delta = (target-today.getUTCDay()+7)%7;
  today.setUTCDate(today.getUTCDate()+delta);
  return `${today.getUTCFullYear()}${String(today.getUTCMonth()+1).padStart(2,"0")}${String(today.getUTCDate()).padStart(2,"0")}`;
}
function fold(line: string) { const chunks:string[]=[];let current="";for(const char of line){if(new TextEncoder().encode(current+char).length>72){chunks.push(current);current=" ";}current+=char;}chunks.push(current);return chunks.join("\r\n"); }
export async function GET() {
  const denied=await requireAdmin();if(denied)return denied;
  const [records,assignments,lectures]=await Promise.all([db.academicRecord.findMany({where:{type:{in:["CALENDAR","TIMETABLE"]}},orderBy:{eventDate:"asc"}}),db.assignment.findMany({where:{status:{not:"DONE"},dueAt:{not:null}},include:{course:{select:{code:true}}},orderBy:{dueAt:"asc"}}),db.lectureSession.findMany({where:{scheduledAt:{not:null}},include:{course:{select:{code:true}}},orderBy:{scheduledAt:"asc"}})]);
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//AFIT ClassDesk//Academic Calendar//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VTIMEZONE","TZID:Africa/Lagos","BEGIN:STANDARD","DTSTART:19700101T000000","TZOFFSETFROM:+0100","TZOFFSETTO:+0100","TZNAME:WAT","END:STANDARD","END:VTIMEZONE"] ;
  for(const record of records){
    const m=record.metadata&&typeof record.metadata==="object"&&!Array.isArray(record.metadata)?record.metadata as Record<string,unknown>:{};
    const uid=`${record.id}@classdesk`;
    if(record.type==="CALENDAR"&&record.eventDate){
      const start=stamp(record.eventDate);const date=start.slice(0,8);const endTime=typeof m.endTime==="string"&&/^\d{2}:\d{2}$/.test(m.endTime)?m.endTime:"23:59";
      const end=`${date}T${endTime.replace(":","")}00`;
      lines.push("BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART;TZID=Africa/Lagos:${start}`,`DTEND;TZID=Africa/Lagos:${end}`,`SUMMARY:${escapeText(record.title)}`,`DESCRIPTION:${escapeText(record.content)}`,`LOCATION:${escapeText(m.venue)}`,`CATEGORIES:${escapeText(m.category||"ACADEMIC")}`,"END:VEVENT");
    } else if(record.type==="TIMETABLE"&&typeof m.day==="string"&&weekdays[m.day]&&typeof m.startTime==="string"&&typeof m.endTime==="string"){
      const date=dayDate(m.day);const start=`${date}T${m.startTime.replace(":","")}00`;const end=`${date}T${m.endTime.replace(":","")}00`;
      const description=[record.content,typeof m.lecturer==="string"?`Lecturer: ${m.lecturer}`:""].filter(Boolean).join("\\n");
      lines.push("BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART;TZID=Africa/Lagos:${start}`,`DTEND;TZID=Africa/Lagos:${end}`,`RRULE:FREQ=WEEKLY;BYDAY=${weekdays[m.day]}`,`SUMMARY:${escapeText(record.title)}`,`DESCRIPTION:${escapeText(description)}`,`LOCATION:${escapeText(m.venue)}`,"END:VEVENT");
    }
  }
  for(const assignment of assignments){
    if(!assignment.dueAt) continue;
    const date=stamp(assignment.dueAt).slice(0,8);const next=new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
    const nextDate=`${next.getUTCFullYear()}${String(next.getUTCMonth()+1).padStart(2,"0")}${String(next.getUTCDate()).padStart(2,"0")}`;
    lines.push("BEGIN:VEVENT",`UID:assignment-${assignment.id}@classdesk`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART;VALUE=DATE:${date}`,`DTEND;VALUE=DATE:${nextDate}`,`SUMMARY:${escapeText(`Assignment due: ${assignment.title}`)}`,`DESCRIPTION:${escapeText(`${assignment.details}${assignment.course?.code?`\nCourse: ${assignment.course.code}`:""}`)}`,"CATEGORIES:DEADLINE","END:VEVENT");
  }
  for(const lecture of lectures){
    if(!lecture.scheduledAt) continue;
    lines.push("BEGIN:VEVENT",`UID:lecture-${lecture.id}@classdesk`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART;TZID=Africa/Lagos:${stamp(lecture.scheduledAt)}`,`SUMMARY:${escapeText(lecture.topic)}`,`DESCRIPTION:${escapeText(`${lecture.summary}${lecture.course?.code?`\nCourse: ${lecture.course.code}`:""}`)}`,`LOCATION:${escapeText(lecture.venue)}`,"CATEGORIES:CLASS","END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new NextResponse(lines.map(fold).join("\r\n")+"\r\n",{headers:{"Content-Type":"text/calendar; charset=utf-8","Content-Disposition":"attachment; filename=afit-classdesk-calendar.ics","Cache-Control":"private, no-store"}});
}
