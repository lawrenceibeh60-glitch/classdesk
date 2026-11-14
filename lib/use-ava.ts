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
  const [inputMode, setInputMode] = useState<"browser" | "cloud" | null>(null);
  const [awake, setAwake] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voices, setVoices] = useState<string[]>([]);
  const [voiceName, setVoiceNameState] = useState("");
  const [cloud, setCloud] = useState({ tts: false, stt: false });
  const cloudRef = useRef({ tts: false, stt: false });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
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

  const startCloudRecorder = useCallback(async () => {
    if (!cloudRef.current.stt) {
      wantRef.current = false;
      setVoiceError("This browser has no built-in speech recognition and cloud transcription is not configured. Use Chrome or type to Ava.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      wantRef.current = false;
      setVoiceError("This browser cannot record audio. Use a supported browser or type to Ava.");
      return;
    }
    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      acquiredStream = stream;
      if (!wantRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onerror = () => {
        wantRef.current = false;
        setListening(false);
        setVoiceError("Audio recording failed. Check microphone permission and try again.");
        stream.getTracks().forEach(track => track.stop());
      };
      recorder.onstop = async () => {
        setListening(false);
        setProcessing(true);
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        stream.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (!blob.size) { setProcessing(false); setVoiceError("No audio was recorded. Tap the microphone and try again."); return; }
        try {
          const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
          const form = new FormData();
          form.set("file", blob, `ava-recording.${extension}`);
          const response = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Ava could not transcribe that recording.");
          handleFinal(typeof result.text === "string" ? result.text : "");
        } catch (error) {
          setVoiceError(error instanceof Error ? error.message : "Cloud transcription failed. Please try again.");
        } finally {
          setProcessing(false);
        }
      };
      recorder.start(500);
      setInputMode("cloud");
      setListening(true);
    } catch (error) {
      wantRef.current = false;
      acquiredStream?.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setListening(false);
      setVoiceError(error instanceof Error && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access in your browser settings, then tap again."
        : "Ava could not start audio recording. Check that the page is open over HTTPS and microphone access is allowed.");
    }
  }, [handleFinal]);

  const startBrowserRec = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return false;
    const rec = new Ctor(); rec.lang = "en-NG"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) handleFinal(e.results[i][0].transcript); };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false; setListening(false);
        setVoiceError("Microphone permission was denied. Allow microphone access in your browser settings, then tap the microphone again.");
      } else if (e.error === "language-not-supported") rec.lang = "en-US";
      else if (e.error === "network") {
        if (navigator.onLine && cloudRef.current.stt) {
          wantRef.current = false;
          rec.onend = null;
          rec.onerror = null;
          rec.abort();
          recRef.current = null;
          wantRef.current = true;
          setListening(false);
          setVoiceError("Browser speech recognition is unavailable. Ava is switching to tap-to-record cloud transcription.");
          void startCloudRecorder();
        } else {
          wantRef.current = false; setListening(false);
          setVoiceError(navigator.onLine ? "The browser speech service could not be reached. Try Chrome or Edge, or configure the optional cloud transcription fallback." : "You're offline. Website speech recognition needs a connection; you can still type to Ava.");
        }
      } else if (e.error === "audio-capture") {
        wantRef.current = false; setListening(false);
        setVoiceError("The browser could not access a microphone. Check that your microphone is connected and permitted.");
      } else if (e.error === "aborted" && wantRef.current) {
        wantRef.current = false; setListening(false);
        setVoiceError("The browser stopped the speech session. Tap the microphone to start a fresh session.");
      }
    };
    rec.onend = () => {
      if (!wantRef.current) { setListening(false); return; }
      try { rec.start(); }
      catch { wantRef.current = false; setListening(false); setVoiceError("The browser speech session stopped unexpectedly. Tap the microphone to try again."); }
    };
    recRef.current = rec;
    try { rec.start(); setInputMode("browser"); return true; } catch { setVoiceError("Could not start the microphone."); return false; }
  }, [handleFinal, startCloudRecorder]);

  const start = useCallback(async () => {
    setVoiceError("");
    wantRef.current = true;
    if (startBrowserRec()) {
      if (!wantRef.current) { recRef.current?.abort(); recRef.current = null; return; }
      setListening(true);
      setTimeout(() => { if (wantRef.current) speak("Ava is ready. Go ahead."); }, 300);
      return;
    }
    await startCloudRecorder();
  }, [startBrowserRec, startCloudRecorder, speak]);

  const stop = useCallback(() => {
    wantRef.current = false; awakeUntil.current = 0; setAwake(false); setListening(false); setInputMode(null);
    recRef.current?.abort(); recRef.current = null;
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    else mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    stopSpeaking();
    handlersRef.current.onStopListening?.();
  }, [stopSpeaking]);

  const toggle = useCallback(() => { if (wantRef.current) stop(); else void start(); }, [start, stop]);

  useEffect(() => {
    const w = window as any; const hasBrowserRec = Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    setSupported(hasBrowserRec);
    fetch("/api/health").then(r => r.json()).then(d => {
      const flags = { tts: Boolean(d.ttsConfigured), stt: Boolean(d.sttConfigured) };
      cloudRef.current = flags;
      setCloud(flags);
      setSupported(hasBrowserRec || (flags.stt && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined"));
    }).catch(() => { setCloud({ tts: false, stt: false }); });
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices().filter(v => v.lang.toLowerCase().startsWith("en")).map(v => v.name) || []);
    try { const saved = localStorage.getItem("ava-voice"); if (saved) { voiceRef.current = saved; setVoiceNameState(saved); } } catch { /* ignore */ }
    loadVoices(); window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
      wantRef.current = false;
      recRef.current?.abort();
      // Navigation/unmount discards an unfinished recording; it must never upload implicitly.
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onerror = null;
        if (mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
      stopSpeaking();
    };
  }, [stopSpeaking]);

  return { supported, listening, speaking, processing, inputMode, awake, heard, voiceError, toggle, stop, speak, shutUp, voices, voiceName, setVoiceName, cloud };
}
