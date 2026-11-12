import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

function runs(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(t => t.startsWith("**") && t.endsWith("**") ? new TextRun({ text: t.slice(2, -2), bold: true }) : new TextRun(t));
}

export async function markdownToDocx(title: string, markdown: string) {
  const children: Paragraph[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) children.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][h[1].length - 1], children: runs(h[2]) }));
    else if (b) children.push(new Paragraph({ bullet: { level: 0 }, children: runs(b[1]) }));
    else if (n) children.push(new Paragraph({ numbering: undefined, children: runs(line.trim()) }));
    else children.push(new Paragraph({ spacing: { after: 120 }, children: runs(line) }));
  }
  children.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "Draft prepared by AFIT ClassDesk. Verify all facts before sharing.", italics: true, size: 18 })] }));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}
