import { db } from "@/lib/db";
const STOP = new Set(["the","and","for","with","from","that","this","what","how","are","was","you","can","about","please","give","show","tell","explain","into","have","has","not","but","all","any"]);
export async function retrieveRelevantChunks(query: string, limit = 8) {
  const terms = [...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(t => !STOP.has(t)))].slice(0, 10);
  if (!terms.length) return [];
  const where = { document: { is: { status: "READY" as const } }, OR: terms.map(term => ({ content: { contains: term, mode: "insensitive" as const } })) };
  const rows = await db.documentChunk.findMany({ where, take: limit * 5, orderBy: { createdAt: "desc" }, include: { document: { select: { title: true, filename: true, courseCode: true, courseName: true, lectureDate: true, topic: true } } } });
  const score = (c: (typeof rows)[number]) => { const t = (c.content + " " + c.document.title + " " + (c.document.topic || "")).toLowerCase(); return terms.reduce((n, term) => n + (t.includes(term) ? 1 : 0), 0); };
  return rows.map(c => ({ c, s: score(c) })).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.c);
}
