"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { getApi } from "@multica/core/api";
import { useT } from "../i18n";
import { voiceZone, type VoiceZone } from "./voice-zone";
import { SpeechSession, capturePCM16, resolveSpeechToken, speechRealtimeURL } from "./voice-speech";

/** Matches the native composer's long-press delay. */
export const VOICE_LONG_PRESS_MS = 280;
/**
 * After the finger lifts, browsers still synthesize a click on whatever is
 * underneath. Keep swallowing touches through that click.
 */
export const VOICE_TOUCH_SHIELD_MS = 400;

interface VoiceHoldOptions {
  enabled: boolean;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
}

interface VoiceHoldHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  /** True when this pointer release belongs to a voice hold, so the field should ignore it. */
  onPointerUp: (event: PointerEvent<HTMLElement>) => boolean;
  onPointerCancel: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  overlay: ReactNode;
}

export function useVoiceHold({ enabled, onSend, onEdit }: VoiceHoldOptions): VoiceHoldHandlers {
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
  const enabledRef = useRef(enabled);
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const shieldRef = useRef<(() => void) | null>(null);
  const releaseRef = useRef<() => void>(() => {});
  onSendRef.current = onSend;
  onEditRef.current = onEdit;
  enabledRef.current = enabled;

  const clearPress = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press) clearTimeout(press.timer);
  }, []);

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
    shieldRef.current?.();
    const press = pressRef.current;
    pressRef.current = null;
    if (press) clearTimeout(press.timer);
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
  releaseRef.current = release;

  const armShield = useCallback((target: HTMLElement) => {
    shieldRef.current?.();
    let dropTimer: ReturnType<typeof setTimeout> | null = null;
    let ended = false;
    let removed = false;
    let remove = () => {};
    const disarm = () => {
      if (removed) return;
      removed = true;
      if (dropTimer) clearTimeout(dropTimer);
      dropTimer = null;
      remove();
      if (shieldRef.current === disarm) shieldRef.current = null;
    };
    const pointOf = (event: Event) => {
      if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
        const touch = event.changedTouches[0] ?? event.touches[0];
        return touch ? { x: touch.clientX, y: touch.clientY } : null;
      }
      if ("clientX" in event && "clientY" in event) {
        const pointer = event as globalThis.PointerEvent;
        return { x: pointer.clientX, y: pointer.clientY };
      }
      return null;
    };
    const finishContact = (cancel: boolean) => {
      if (ended) return;
      ended = true;
      if (pressRef.current) {
        clearPress();
        if (!cancel) target.focus();
      } else if (activeRef.current) {
        if (cancel) {
          zoneRef.current = "cancel";
          setZone("cancel");
        }
        releaseRef.current();
      }
      dropTimer = setTimeout(disarm, VOICE_TOUCH_SHIELD_MS);
    };
    const onEvent = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const type = event.type;
      if (type === "pointermove" || type === "touchmove") {
        const point = pointOf(event);
        if (!point || !activeRef.current) return;
        const next = voiceZone(point.x, point.y, window.innerWidth, window.innerHeight);
        zoneRef.current = next;
        setZone(next);
        return;
      }
      if (type === "pointerup" || type === "touchend") {
        const point = pointOf(event);
        if (point && activeRef.current) {
          const next = voiceZone(point.x, point.y, window.innerWidth, window.innerHeight);
          zoneRef.current = next;
          setZone(next);
        }
        finishContact(false);
        return;
      }
      if (type === "pointercancel" || type === "touchcancel") {
        finishContact(true);
        return;
      }
      if ((type === "click" || type === "auxclick") && ended) disarm();
    };
    const types = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "mousedown",
      "mousemove",
      "mouseup",
      "click",
      "auxclick",
      "contextmenu",
    ];
    for (const type of types) {
      window.addEventListener(type, onEvent, { capture: true, passive: false });
    }
    remove = () => {
      for (const type of types) window.removeEventListener(type, onEvent, { capture: true });
    };
    shieldRef.current = disarm;
  }, [clearPress]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabledRef.current || event.button > 0 || pressRef.current || activeRef.current) return;
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    armShield(target);
    pressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        pressRef.current = null;
        if (!enabledRef.current) return;
        if (document.activeElement === target) target.blur();
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // jsdom and a lost pointer do not support capture; window listeners cover release.
        }
        void begin();
      }, VOICE_LONG_PRESS_MS),
    };
  }, [armShield, begin]);

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (!enabledRef.current || pressRef.current || activeRef.current) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.preventDefault();
    const target = event.currentTarget;
    armShield(target);
    pressRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      timer: setTimeout(() => {
        pressRef.current = null;
        if (!enabledRef.current) return;
        if (document.activeElement === target) target.blur();
        void begin();
      }, VOICE_LONG_PRESS_MS),
    };
  }, [armShield, begin]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!activeRef.current) return;
    const next = voiceZone(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
    zoneRef.current = next;
    setZone(next);
  }, []);

  const onPointerUp = useCallback((_event: PointerEvent<HTMLElement>) => {
    if (pressRef.current) {
      clearPress();
      return false;
    }
    if (!activeRef.current) return false;
    release();
    return true;
  }, [clearPress, release]);

  const onPointerCancel = useCallback(() => {
    if (pressRef.current) {
      clearPress();
      return;
    }
    if (!activeRef.current) return;
    zoneRef.current = "cancel";
    setZone("cancel");
    release();
  }, [clearPress, release]);

  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (enabledRef.current || activeRef.current) event.preventDefault();
  }, []);

  const hint = zone === "cancel"
    ? t(($) => $.composer.voice_release_cancel)
    : zone === "edit"
      ? t(($) => $.composer.voice_release_edit)
      : t(($) => $.composer.voice_release_send);

  const overlay = (
    <>
      {holding && createPortal(
        <div
          className="pointer-events-auto fixed inset-0 z-[200] flex touch-none flex-col bg-black/90"
          role="dialog"
          aria-label={hint}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="max-w-sm rounded-2xl bg-primary px-4 py-3 text-body text-primary-foreground">
              {preview || t(($) => $.composer.voice_listening)}
            </p>
          </div>
          <div className="grid grid-cols-3 items-end px-6 pb-10 text-center text-sm">
            <span className={zone === "cancel" ? "font-medium text-red-400" : "text-white/70"}>
              {t(($) => $.composer.voice_cancel)}
            </span>
            <span className="text-white/70">{hint}</span>
            <span className={zone === "edit" ? "font-medium text-white" : "text-white/70"}>
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

  return { onPointerDown, onTouchStart, onPointerMove, onPointerUp, onPointerCancel, onContextMenu, overlay };
}
