"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* Minimal Web Speech typings (not in the TS DOM lib). */
type Rec = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; start(): void; stop(): void; abort(): void };
type RecCtor = new () => Rec;
const AWAKE_MS = 8000;


export function cleanForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " I've left the code on screen. ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/https?:\/\/\S+/g, "the link")
    .replace(/^\s*[-*•]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "").replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`~|>#]/g, "").replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\be\.g\./gi, "for example").replace(/\bi\.e\./gi, "that is").replace(/\betc\./gi, "and so on")
    .replace(/&/g, " and ").replace(/\s*\n+\s*/g, ". ").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim().slice(0, 1800);
}
function sentences(text: string, max = 170) {
  const parts = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const out: string[] = []; let cur = "";
  for (const part of parts) { if ((cur + part).length > max && cur) { out.push(cur.trim()); cur = part; } else cur += part; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const GB_NAMES = /sonia|libby|maisie|mia\b|hazel|susan|serena|google uk english female|uk english female|female/i;
const OTHER = [/natural/i, /aria|jenny|emma|samantha|karen|zira/i, /female/i];
function pickVoice(name?: string | null): SpeechSynthesisVoice | undefined {
  let voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith("en"));
  if (!navigator.onLine) { const local = voices.filter(v => v.localService); if (local.length) voices = local; } // offline: installed voices only
  if (!voices.length) voices = window.speechSynthesis.getVoices();
  if (name) { const saved = voices.find(v => v.name === name); if (saved) return saved; }
  const gb = voices.filter(v => /en[-_]gb/i.test(v.lang));
  const british = gb.find(v => /natural/i.test(v.name) && GB_NAMES.test(v.name)) || gb.find(v => GB_NAMES.test(v.name)) || gb[0];
  if (british) return british;
  for (const re of OTHER) { const hit = voices.find(v => re.test(v.name)); if (hit) return hit; }
  return voices[0];
}
export const ACKS = ["Right away, boss.", "On it, boss.", "Of course, boss.", "Consider it done, boss."];
export const FOLLOWUPS = ["Anything else, boss?", "Anything else for me, boss?", "Shall I do anything else, boss?"];
export const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/** 16 kHz mono 16-bit WAV from raw microphone frames. */
function encodeWav(chunks: Float32Array[], inRate: number) {
  const total = chunks.reduce((n, c) => n + c.length, 0); const merged = new Float32Array(total); let o = 0;
  for (const c of chunks) { merged.set(c, o); o += c.length; }
  const ratio = inRate / 16000; const outLen = Math.floor(total / ratio);
  const buf = new ArrayBuffer(44 + outLen * 2); const v = new DataView(buf);
  const w = (at: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(at + i, str.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + outLen * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, outLen * 2, true);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio)); let s = 0;
    for (let j = a; j < b; j++) s += merged[j];
    const x = Math.max(-1, Math.min(1, s / Math.max(1, b - a))); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export type AvaHandlers = { onCommand: (command: string) => void | Promise<void>; onStopListening?: () => void };

export function useAva(handlers: AvaHandlers) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [awake, setAwake] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voices, setVoices] = useState<string[]>([]);
  const [voiceName, setVoiceNameState] = useState("");
  const [cloud, setCloud] = useState({ stt: false, tts: false });
  const cloudRef = useRef({ stt: false, tts: false });
  const recRef = useRef<Rec | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playToken = useRef(0);
  const voiceRef = useRef("");
  const wantRef = useRef(false);
  const awakeUntil = useRef(0);
  const mutedUntil = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const setVoiceName = useCallback((n: string) => { voiceRef.current = n; setVoiceNameState(n); try { localStorage.setItem("ava-voice", n); } catch { /* ignore */ } }, []);

  const stopSpeaking = useCallback(() => {
    playToken.current++; window.speechSynthesis?.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  }, []);

  const speakBrowser = useCallback((chunks: string[], finish: () => void) => {
    const synth = window.speechSynthesis; if (!synth) { finish(); return; }
    const voice = pickVoice(voiceRef.current);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-GB";
      const q = /\?\s*$/.test(chunk), x = /!\s*$/.test(chunk);
      u.rate = x ? 1.05 : 1.0; u.pitch = q ? 1.08 : x ? 1.06 : 1.0; u.volume = 1;
      if (i === chunks.length - 1) { u.onend = finish; u.onerror = finish; }
      synth.speak(u);
    });
  }, []);

  /** Natural cloud voice (ElevenLabs): all pieces fetched in parallel, played in order. Returns false if it could not start. */
  const speakCloud = useCallback(async (chunks: string[], finish: () => void, token: number) => {
    const groups = sentences(chunks.join(" "), 300);
    const fetches = groups.map(text => fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(r => r.ok ? r.blob() : Promise.reject(new Error("tts"))));
    fetches.forEach(p => p.catch(() => undefined));
    for (let i = 0; i < fetches.length; i++) {
      let blob: Blob;
      try { blob = await fetches[i]; } catch { if (i === 0) return false; break; }
      if (token !== playToken.current) return true;
      const url = URL.createObjectURL(blob); const audio = new Audio(url); audioRef.current = audio;
      await new Promise<void>(res => { audio.onended = () => res(); audio.onerror = () => res(); audio.play().catch(() => res()); });
      URL.revokeObjectURL(url);
      if (token !== playToken.current) return true;
    }
    finish(); return true;
  }, []);

  const speak = useCallback((text: string, tail = "", openMic = false) => {
    if (typeof window === "undefined") return;
    const body = (cleanForSpeech(text) + " " + tail).trim(); if (!body) return;
    stopSpeaking();
    setSpeaking(true);
    const token = playToken.current;
    const chunks = sentences(body);
    mutedUntil.current = Date.now() + 120_000; // ignore the mic while talking
    const finish = () => {
      setSpeaking(false);
      mutedUntil.current = Date.now() + 900;
      if (openMic && wantRef.current) { awakeUntil.current = Date.now() + 900 + AWAKE_MS; setAwake(true); setTimeout(() => setAwake(Date.now() < awakeUntil.current), AWAKE_MS + 1000); }
    };
    if (cloudRef.current.tts && navigator.onLine) { void speakCloud(chunks, finish, token).then((ok: boolean) => { if (!ok && token === playToken.current) speakBrowser(chunks, finish); }); return; }
    speakBrowser(chunks, finish);
  }, [stopSpeaking, speakCloud, speakBrowser]);

  const shutUp = useCallback(() => { stopSpeaking(); mutedUntil.current = Date.now() + 500; }, [stopSpeaking]);

  const handleFinal = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text || Date.now() < mutedUntil.current) return;
    setHeard(text);
    // The microphone button explicitly starts voice mode; no wake word is required.
    awakeUntil.current = 0;
    setAwake(false);
    setProcessing(true);
    void Promise.resolve(handlersRef.current.onCommand(text))
      .catch((error) => setVoiceError(error instanceof Error ? error.message : "Ava could not complete that command."))
      .finally(() => setProcessing(false));
  }, []);

  /** Listening with Mistral Voxtral: detect speech locally, send each phrase for transcription. */
  const startCloud = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1); const sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
    const frameMs = (4096 / ctx.sampleRate) * 1000;
    let pre: Float32Array[] = [], seg: Float32Array[] = [], speaking = false, silent = 0, voiced = 0, floor = 0.01;
    const send = async (blob: Blob) => {
      try {
        const fd = new FormData(); fd.append("file", blob, "speech.wav");
        const r = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setVoiceError(d.error || "Transcription failed"); return; }
        setVoiceError(""); if (d.text) handleFinal(d.text);
      } catch { setVoiceError("Couldn't reach the speech service. Check your internet."); }
    };
    proc.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      if (Date.now() < mutedUntil.current) { pre = []; seg = []; speaking = false; silent = voiced = 0; return; }
      let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length); const threshold = Math.max(0.02, floor * 3.5);
      if (rms > threshold) { if (!speaking) { speaking = true; seg = [...pre]; voiced = 0; } silent = 0; voiced += frameMs; seg.push(data); }
      else if (speaking) {
        seg.push(data); silent += frameMs;
        if (silent > 850 || seg.length * frameMs > 15000) { const ok = voiced > 350; const blob = ok ? encodeWav(seg, ctx.sampleRate) : null; speaking = false; seg = []; silent = voiced = 0; if (blob) void send(blob); }
      } else { floor = floor * 0.97 + rms * 0.03; pre.push(data); if (pre.length > 4) pre.shift(); }
    };
    cleanupRef.current = () => { proc.onaudioprocess = null; try { proc.disconnect(); src.disconnect(); } catch { /* ignore */ } stream.getTracks().forEach(t => t.stop()); void ctx.close(); };
  }, [handleFinal]);

  const startBrowserRec = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setVoiceError("Listening isn't supported here. Add a MISTRAL_API_KEY in keys/API-KEYS.env, or use Chrome, Edge or Safari."); wantRef.current = false; return false; }
    const rec = new Ctor(); rec.lang = "en-NG"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) handleFinal(e.results[i][0].transcript); };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { wantRef.current = false; setListening(false); setVoiceError("Microphone permission denied. Allow it in your browser settings."); }
      else if (e.error === "language-not-supported") rec.lang = "en-US";
      else if (e.error === "network") { wantRef.current = false; setListening(false); setVoiceError(navigator.onLine ? "This window has no speech service. Add MISTRAL_API_KEY in keys/API-KEYS.env, or use the Edge window option." : "You're offline: listening needs internet, but typing works and Ava still speaks replies."); }
    };
    rec.onend = () => { if (wantRef.current) { try { rec.start(); } catch { /* already started */ } } else setListening(false); };
    recRef.current = rec;
    try { rec.start(); return true; } catch { setVoiceError("Could not start the microphone."); return false; }
  }, [handleFinal]);

  const start = useCallback(async () => {
    setVoiceError(""); wantRef.current = true;
    if (cloudRef.current.stt && navigator.onLine) {
      try {
        await startCloud();
        if (!wantRef.current) { cleanupRef.current?.(); cleanupRef.current = null; return; }
        setListening(true);
        setTimeout(() => { if (wantRef.current) speak("Ava is ready. Go ahead."); }, 300);
        return;
      } catch {
        if (!wantRef.current) return;
        wantRef.current = false;
        setVoiceError("Microphone unavailable or permission denied.");
        return;
      }
    }
    if (startBrowserRec()) {
      if (!wantRef.current) { recRef.current?.abort(); recRef.current = null; return; }
      setListening(true);
      setTimeout(() => { if (wantRef.current) speak("Ava is ready. Go ahead."); }, 300);
    }
  }, [startCloud, startBrowserRec, speak]);

  const stop = useCallback(() => {
    wantRef.current = false; awakeUntil.current = 0; setAwake(false); setListening(false); setProcessing(false);
    recRef.current?.abort(); recRef.current = null; cleanupRef.current?.(); cleanupRef.current = null; stopSpeaking();
    handlersRef.current.onStopListening?.();
  }, [stopSpeaking]);

  const toggle = useCallback(() => { if (wantRef.current) stop(); else void start(); }, [start, stop]);

  useEffect(() => {
    const w = window as any; const hasBrowserRec = Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    const hasMicrophoneInput = Boolean(navigator.mediaDevices?.getUserMedia);
    setSupported(hasBrowserRec);
    fetch("/api/health").then(r => r.json()).then(d => {
      const flags = { stt: Boolean(d.sttConfigured), tts: Boolean(d.ttsConfigured) };
      cloudRef.current = flags;
      setCloud(flags);
      setSupported(hasBrowserRec || (hasMicrophoneInput && flags.stt));
    }).catch(() => { setSupported(hasBrowserRec); });
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices().filter(v => v.lang.toLowerCase().startsWith("en")).map(v => v.name) || []);
    try { const saved = localStorage.getItem("ava-voice"); if (saved) { voiceRef.current = saved; setVoiceNameState(saved); } } catch { /* ignore */ }
    loadVoices(); window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => { window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices); wantRef.current = false; recRef.current?.abort(); cleanupRef.current?.(); stopSpeaking(); };
  }, [stopSpeaking]);

  return { supported, listening, speaking, processing, awake, heard, voiceError, toggle, stop, speak, shutUp, voices, voiceName, setVoiceName, cloud };
}
