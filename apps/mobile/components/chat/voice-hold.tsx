import { useCallback, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useAudioRecorder } from "@siteed/audio-studio";
import { SpeechSession, speechRealtimeURL } from "@/data/speech-session";
import { getToken } from "@/data/secure-storage";
import { useT } from "@/lib/i18n";
import { audioChunkToPCM16 } from "@/lib/pcm16";
import { voiceZone, type VoiceZone } from "@/lib/voice-zone";
import { VoiceInputOverlay } from "./voice-input-overlay";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
const IS_IOS = process.env.EXPO_OS === "ios";

const quietLogger = {
  log() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Long-press the empty composer to talk. Release sends, the lower-left arc
 * cancels, and the lower-right arc fills the draft and focuses the keyboard.
 */
export function VoiceHoldLayer({
  enabled,
  corpus,
  onSend,
  onEdit,
  suppressExpandUntil,
  children,
}: {
  enabled: boolean;
  corpus: string;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
  /** Touches that end the hold should not also expand the keyboard. */
  suppressExpandUntil: { current: number };
  children: ReactNode;
}) {
  const { t } = useT("chat");
  const { width, height } = useWindowDimensions();
  const { startRecording, stopRecording } = useAudioRecorder({ logger: quietLogger });
  const [active, setActive] = useState(false);
  const [zone, setZone] = useState<VoiceZone>("send");
  const [transcript, setTranscript] = useState("");
  const live = useRef(false);
  const zoneRef = useRef<VoiceZone>("send");
  const sessionRef = useRef<SpeechSession | null>(null);

  const fail = useCallback(
    (message: string) => {
      live.current = false;
      setActive(false);
      sessionRef.current?.cancel();
      sessionRef.current = null;
      Alert.alert(t("voice.unavailable"), message);
    },
    [t],
  );

  const begin = useCallback(() => {
    if (!enabled || live.current || Platform.OS === "web") return;
    live.current = true;
    suppressExpandUntil.current = Date.now() + 60_000;
    zoneRef.current = "send";
    setZone("send");
    setTranscript("");
    setActive(true);
    if (IS_IOS) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void (async () => {
      try {
        const token = await getToken();
        if (!live.current) return;
        if (!token || !API_URL) {
          fail(t("voice.unavailable"));
          return;
        }
        const session = new SpeechSession(speechRealtimeURL(API_URL), token, corpus);
        session.onPartial = (text) => {
          if (live.current) setTranscript(text);
        };
        sessionRef.current = session;
        await session.start();
        if (!live.current) {
          session.cancel();
          return;
        }
        await startRecording({
          sampleRate: 16000,
          channels: 1,
          encoding: "pcm_16bit",
          interval: 100,
          streamFormat: "raw",
          enableProcessing: false,
          showNotification: false,
          keepAwake: true,
          bufferDurationSeconds: 0.1,
          output: { primary: { enabled: false } },
          onAudioStream: async (event) => {
            const pcm = audioChunkToPCM16(event.data);
            if (pcm) sessionRef.current?.push(pcm);
          },
        });
      } catch {
        if (live.current) fail(t("voice.permission"));
      }
    })();
  }, [corpus, enabled, fail, startRecording, suppressExpandUntil, t]);

  const move = useCallback(
    (x: number, y: number) => {
      if (!live.current) return;
      const next = voiceZone(x, y, width, height);
      if (next === zoneRef.current) return;
      zoneRef.current = next;
      setZone(next);
      if (IS_IOS) void Haptics.selectionAsync();
    },
    [height, width],
  );

  const end = useCallback(() => {
    if (!live.current) return;
    suppressExpandUntil.current = Date.now() + 400;
    live.current = false;
    const chosen = zoneRef.current;
    setActive(false);
    const session = sessionRef.current;
    sessionRef.current = null;
    void (async () => {
      try {
        await stopRecording();
      } catch {
        // The recorder may already have stopped when permission failed.
      }
      if (!session) return;
      if (chosen === "cancel") {
        session.cancel();
        return;
      }
      const text = (await session.commit()).trim();
      session.cancel();
      if (!text) return;
      if (chosen === "edit") onEdit(text);
      else onSend(text);
    })();
  }, [onEdit, onSend, stopRecording, suppressExpandUntil]);

  const pan = Gesture.Pan()
    .enabled(enabled && Platform.OS !== "web")
    .activateAfterLongPress(280)
    .onStart(() => {
      runOnJS(begin)();
    })
    .onUpdate((event) => {
      runOnJS(move)(event.absoluteX, event.absoluteY);
    })
    .onFinalize(() => {
      runOnJS(end)();
    });

  return (
    <GestureDetector gesture={pan}>
      <View>
        {children}
        {active ? <VoiceInputOverlay zone={zone} text={transcript} /> : null}
      </View>
    </GestureDetector>
  );
}

/** True while a voice gesture should swallow the composer's tap-to-expand. */
export function voiceHoldSuppressesExpand(until: number, now = Date.now()): boolean {
  return now < until;
}
