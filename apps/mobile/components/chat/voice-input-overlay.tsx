import { StyleSheet, View } from "react-native";
import { Portal } from "@rn-primitives/portal";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import type { VoiceZone } from "@/lib/voice-zone";

const BUBBLE = "#95EC69";
const CANCEL = "#FA5151";

/** Full-screen hold overlay: live transcript in the center, cancel and edit arcs below. */
export function VoiceInputOverlay({
  zone,
  text,
}: {
  zone: VoiceZone;
  text: string;
}) {
  const { t } = useT("chat");
  const hint =
    zone === "cancel"
      ? t("voice.release_cancel")
      : zone === "edit"
        ? t("voice.release_edit")
        : t("voice.release_send");
  return (
    <Portal name="voice-input">
      <View pointerEvents="none" style={styles.fill}>
        <View style={styles.dim} />
        <View style={styles.center}>
          <View style={[styles.bubble, zone === "cancel" && styles.bubbleCancel]}>
            <Text style={styles.bubbleText} numberOfLines={4}>
              {text || t("voice.listening")}
            </Text>
          </View>
          <Text style={styles.hint}>{hint}</Text>
        </View>
        <View style={styles.bottom}>
          <View style={[styles.arc, styles.arcLeft, zone === "cancel" && styles.arcOn]}>
            <Text style={[styles.arcLabel, zone === "cancel" && styles.arcLabelOn]}>
              {t("voice.cancel")}
            </Text>
          </View>
          <View style={styles.well} />
          <View style={[styles.arc, styles.arcRight, zone === "edit" && styles.arcOn]}>
            <Text style={[styles.arcLabel, zone === "edit" && styles.arcLabelOn]}>
              {t("voice.edit")}
            </Text>
          </View>
        </View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  bubble: {
    maxWidth: 280,
    minWidth: 168,
    borderRadius: 16,
    backgroundColor: BUBBLE,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  bubbleCancel: {
    backgroundColor: CANCEL,
  },
  bubbleText: {
    color: "#111",
    fontSize: 20,
    lineHeight: 28,
    textAlign: "center",
  },
  hint: {
    marginTop: 14,
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
  },
  bottom: {
    height: 168,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingBottom: 18,
  },
  arc: {
    width: 132,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(60,60,60,0.55)",
  },
  arcLeft: {
    borderTopRightRadius: 80,
    borderBottomLeftRadius: 28,
    transform: [{ rotate: "-18deg" }, { translateY: 8 }],
  },
  arcRight: {
    borderTopLeftRadius: 80,
    borderBottomRightRadius: 28,
    transform: [{ rotate: "18deg" }, { translateY: 8 }],
  },
  arcOn: {
    backgroundColor: "rgba(255,255,255,0.88)",
  },
  arcLabel: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 16,
  },
  arcLabelOn: {
    color: "#111",
  },
  well: {
    position: "absolute",
    left: 72,
    right: 72,
    bottom: -28,
    height: 92,
    borderTopLeftRadius: 120,
    borderTopRightRadius: 120,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
});
