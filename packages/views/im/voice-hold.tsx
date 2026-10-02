"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic } from "lucide-react";
import { getApi } from "@multica/core/api";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../i18n";
import { voiceZone, type VoiceZone } from "./voice-zone";
import { SpeechSession, capturePCM16, resolveSpeechToken, speechRealtimeURL } from "./voice-speech";

interface VoiceHoldButtonProps {
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
}

export function VoiceHoldButton({ onSend, onEdit }: VoiceHoldButtonProps) {
  const { t } = useT("im");
  const [holding, setHolding] = useState(false);
  const [zone, setZone] = useState<VoiceZone>("send");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const zoneRef = useRef<VoiceZone>("send");
  const sessionRef = useRef<SpeechSession | null>(null);
  const bufferRef = useRef<Uint8Array[]>([]);
  const stopMicRef = useRef<(() => Promise<void>) | null>(null);
  const releasedRef = useRef(false);
  const readyRef = useRef(false);
  const activeRef = useRef(false);
  const finishingRef = useRef(false);
  const genRef = useRef(0);
  const onSendRef = useRef(onSend);
  const onEditRef = useRef(onEdit);
  onSendRef.current = onSend;
  onEditRef.current = onEdit;

  const stopMic = useCallback(async () => {
    const stop = stopMicRef.current;
    stopMicRef.current = null;
    await stop?.().catch(() => {});
  }, []);

  const fail = useCallback((err: unknown) => {
    const name = err instanceof DOMException ? err.name : "";
    setError(
      name === "NotAllowedError" || name === "PermissionDeniedError"
        ? t(($) => $.composer.voice_permission)
        : t(($) => $.composer.voice_unavailable),
    );
  }, [t]);

  const finish = useCallback(async (gen: number) => {
    if (finishingRef.current || gen !== genRef.current || !readyRef.current) return;
    finishingRef.current = true;
    const zoneNow = zoneRef.current;
    const session = sessionRef.current;
    sessionRef.current = null;
    readyRef.current = false;
    activeRef.current = false;
    setHolding(false);
    setPreview("");
    await stopMic();
    if (!session) {
      finishingRef.current = false;
      return;
    }
    if (zoneNow === "cancel") {
      session.cancel();
      finishingRef.current = false;
      return;
    }
    try {
      const text = await session.commit();
      if (!text) return;
      if (zoneNow === "edit") onEditRef.current(text);
      else onSendRef.current(text);
    } catch (err) {
      fail(err);
    } finally {
      finishingRef.current = false;
    }
  }, [fail, stopMic]);

  const begin = useCallback(async () => {
    if (activeRef.current) return;
    const gen = ++genRef.current;
    activeRef.current = true;
    releasedRef.current = false;
    readyRef.current = false;
    finishingRef.current = false;
    bufferRef.current = [];
    // Widened so TS doesn't keep "send" across the awaits below.
    zoneRef.current = "send" as VoiceZone;
    setZone("send");
    setPreview("");
    setError(null);
    setHolding(true);
    try {
      const token = await Promise.all([
        resolveSpeechToken(),
        capturePCM16((pcm) => {
          const session = sessionRef.current;
          if (session && readyRef.current) session.push(pcm);
          else bufferRef.current.push(pcm);
        }).then((stop) => {
          stopMicRef.current = stop;
        }),
      ]).then(([issued]) => issued);
      if (gen !== genRef.current) {
        await stopMic();
        return;
      }
      const session = new SpeechSession(speechRealtimeURL(getApi().getBaseUrl()), token, "");
      session.onPartial = (text) => {
        if (gen === genRef.current) setPreview(text);
      };
      sessionRef.current = session;
      await session.start();
      if (gen !== genRef.current) {
        session.cancel();
        await stopMic();
        return;
      }
      readyRef.current = true;
      for (const chunk of bufferRef.current) session.push(chunk);
      bufferRef.current = [];
      if (releasedRef.current && zoneRef.current === "cancel") {
        genRef.current += 1;
        session.cancel();
        sessionRef.current = null;
        readyRef.current = false;
        activeRef.current = false;
        setHolding(false);
        await stopMic();
        return;
      }
      if (releasedRef.current) void finish(gen);
    } catch (err) {
      if (gen !== genRef.current) return;
      sessionRef.current?.cancel();
      sessionRef.current = null;
      readyRef.current = false;
      activeRef.current = false;
      setHolding(false);
      await stopMic();
      fail(err);
    }
  }, [fail, finish, stopMic]);

  useEffect(() => () => {
    genRef.current += 1;
    sessionRef.current?.cancel();
    void stopMicRef.current?.();
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  const abort = useCallback(() => {
    genRef.current += 1;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    readyRef.current = false;
    activeRef.current = false;
    setHolding(false);
    setPreview("");
    void stopMic();
  }, [stopMic]);

  const release = useCallback(() => {
    releasedRef.current = true;
    if (readyRef.current) {
      void finish(genRef.current);
      return;
    }
    if (zoneRef.current === "cancel") abort();
  }, [abort, finish]);

  useEffect(() => {
    if (!holding) return;
    const move = (e: PointerEvent) => {
      const next = voiceZone(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
      zoneRef.current = next;
      setZone(next);
    };
    const up = (e: PointerEvent) => {
      if (e.type === "pointercancel") {
        zoneRef.current = "cancel";
        setZone("cancel");
      }
      release();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [holding, release]);

  const hint = zone === "cancel"
    ? t(($) => $.composer.voice_release_cancel)
    : zone === "edit"
      ? t(($) => $.composer.voice_release_edit)
      : t(($) => $.composer.voice_release_send);

  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        className="shrink-0 touch-none rounded-full"
        aria-label={t(($) => $.composer.voice_hold)}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button > 0) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // jsdom and a lost pointer do not support capture; window listeners cover release.
          }
          void begin();
        }}
        onPointerMove={(e) => {
          if (!activeRef.current) return;
          const next = voiceZone(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
          zoneRef.current = next;
          setZone(next);
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          zoneRef.current = "cancel";
          setZone("cancel");
          release();
        }}
      >
        <Mic />
      </Button>
      {holding && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-background/80" role="dialog" aria-label={hint}>
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="max-w-sm rounded-2xl bg-primary px-4 py-3 text-body text-primary-foreground">
              {preview || t(($) => $.composer.voice_listening)}
            </p>
          </div>
          <div className="grid grid-cols-3 items-end px-6 pb-10 text-center text-sm">
            <span className={zone === "cancel" ? "font-medium text-destructive" : "text-muted-foreground"}>
              {t(($) => $.composer.voice_cancel)}
            </span>
            <span className="text-muted-foreground">{hint}</span>
            <span className={zone === "edit" ? "font-medium text-foreground" : "text-muted-foreground"}>
              {t(($) => $.composer.voice_edit)}
            </span>
          </div>
        </div>,
        document.body,
      )}
      {error && createPortal(
        <p role="status" className="fixed inset-x-0 bottom-24 z-50 px-4 text-center text-sm text-foreground">
          {error}
        </p>,
        document.body,
      )}
    </>
  );
}
