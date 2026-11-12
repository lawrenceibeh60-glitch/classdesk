import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

export async function extractText(buffer: Buffer, mime: string, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (mime === "text/plain" || mime === "text/markdown" || lower.endsWith(".txt") || lower.endsWith(".md")) return buffer.toString("utf8");
  if (["image/png", "image/jpeg", "image/webp"].includes(mime) || /\.(png|jpe?g|webp)$/.test(lower)) {
    const worker = await createWorker("eng");
    try { const result = await worker.recognize(buffer); return result.data.text || ""; }
    finally { await worker.terminate(); }
  }
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      if ((result.text || "").trim().length >= 40) return result.text;
    } finally { await parser.destroy(); }
    return await ocrPdf(buffer);
  }
  if (lower.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (lower.endsWith(".pptx") || mime.includes("presentationml")) {
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
    const output: string[] = [];
    for (const slide of slides) {
      const xml = await zip.files[slide].async("string");
      const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
      output.push(texts.join(" "));
    }
    return output.map((s,i) => `Slide ${i+1}\n${s}`).join("\n\n");
  }
  throw new Error("Unsupported file type. Upload PDF, DOCX, PPTX, TXT, Markdown or an image (PNG, JPG, WEBP).");
}

async function ocrPdf(buffer: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await task.promise;
  const worker = await createWorker("eng");
  const pages: string[] = [];
  const totalPages = pdf.numPages;
  const configuredLimit = Number(process.env.OCR_MAX_PAGES || 8);
  const pageLimit = Math.min(totalPages, Number.isFinite(configuredLimit) ? Math.max(1, Math.min(configuredLimit, 20)) : 8);
  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      if (viewport.width > 6000 || viewport.height > 6000) { pages.push(`Page ${pageNumber}: skipped because page dimensions exceed the OCR safety limit.`); continue; }
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      const png = canvas.toBuffer("image/png");
      const result = await worker.recognize(png);
      const text = result.data.text.trim();
      if (text) pages.push(`Page ${pageNumber}\n${text}`);
      page.cleanup();
    }
  } finally { await worker.terminate(); await pdf.destroy(); }
  const limitNote = totalPages > pageLimit ? `OCR indexed the first ${pageLimit} of ${totalPages} pages. The remaining pages were not processed.` : "";
  return [limitNote, ...pages].filter(Boolean).join("\n\n");
}

export function splitIntoChunks(text: string, size = 1400, overlap = 180) {
  const clean = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(" ", end);
      if (boundary > start + size * 0.65) end = boundary;
    }
    chunks.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
