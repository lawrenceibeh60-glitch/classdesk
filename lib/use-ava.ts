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
  const [cloud, setCloud] = useState({ tts: false });
  const cloudRef = useRef({ tts: false });
  const recRef = useRef<Rec | null>(null);
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

  const startBrowserRec = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setVoiceError("This browser does not provide speech recognition. Please use a supported browser such as Chrome, Edge or Safari."); wantRef.current = false; return false; }
    const rec = new Ctor(); rec.lang = "en-NG"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) handleFinal(e.results[i][0].transcript); };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { wantRef.current = false; setListening(false); setVoiceError("Microphone permission denied. Allow it in your browser settings."); }
      else if (e.error === "language-not-supported") rec.lang = "en-US";
      else if (e.error === "network") { wantRef.current = false; setListening(false); setVoiceError(navigator.onLine ? "This browser could not reach its speech recognition service. Check your connection or try Chrome or Edge." : "You're offline: listening needs internet, but typing works and Ava still speaks replies."); }
    };
    rec.onend = () => { if (wantRef.current) { try { rec.start(); } catch { /* already started */ } } else setListening(false); };
    recRef.current = rec;
    try { rec.start(); return true; } catch { setVoiceError("Could not start the microphone."); return false; }
  }, [handleFinal]);

  const start = useCallback(() => {
    setVoiceError("");
    wantRef.current = true;
    if (startBrowserRec()) {
      if (!wantRef.current) { recRef.current?.abort(); recRef.current = null; return; }
      setListening(true);
      setTimeout(() => { if (wantRef.current) speak("Ava is ready. Go ahead."); }, 300);
    }
  }, [startBrowserRec, speak]);

  const stop = useCallback(() => {
    wantRef.current = false; awakeUntil.current = 0; setAwake(false); setListening(false); setProcessing(false);
    recRef.current?.abort(); recRef.current = null; stopSpeaking();
    handlersRef.current.onStopListening?.();
  }, [stopSpeaking]);

  const toggle = useCallback(() => { if (wantRef.current) stop(); else void start(); }, [start, stop]);

  useEffect(() => {
    const w = window as any; const hasBrowserRec = Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    setSupported(hasBrowserRec);
    fetch("/api/health").then(r => r.json()).then(d => {
      const flags = { tts: Boolean(d.ttsConfigured) };
      cloudRef.current = flags;
      setCloud(flags);
    }).catch(() => { setCloud({ tts: false }); });
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices().filter(v => v.lang.toLowerCase().startsWith("en")).map(v => v.name) || []);
    try { const saved = localStorage.getItem("ava-voice"); if (saved) { voiceRef.current = saved; setVoiceNameState(saved); } } catch { /* ignore */ }
    loadVoices(); window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => { window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices); wantRef.current = false; recRef.current?.abort(); stopSpeaking(); };
  }, [stopSpeaking]);

  return { supported, listening, speaking, processing, awake, heard, voiceError, toggle, stop, speak, shutUp, voices, voiceName, setVoiceName, cloud };
}
