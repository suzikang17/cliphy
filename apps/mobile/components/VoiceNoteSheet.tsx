import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import type { Summary } from "@cliphy/shared";
import { errorText } from "../lib/coach";
import { saveRecording } from "../lib/voiceApi";
import { clock, pickAudioType } from "../lib/voiceNote";
import { FONT, LINE, QuickButton, hardShadow, useCoachTheme } from "./coach/ui";

/** A browser records in whichever kind of audio it can make; the phone always makes m4a. */
function recordingOptions() {
  if (Platform.OS !== "web") return RecordingPresets.HIGH_QUALITY;
  const supported = (type: string) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type);
  const mimeType = pickAudioType(supported) ?? "audio/webm";
  return { ...RecordingPresets.HIGH_QUALITY, web: { mimeType, bitsPerSecond: 96_000 } };
}

/**
 * Record a voice note: one big button to start, the same button to stop.
 * Stopping saves it; its words, summary and tags arrive a moment later.
 */
export function VoiceNoteSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (note: Summary) => void;
}) {
  const t = useCoachTheme();
  const options = useRef(recordingOptions()).current;
  const recorder = useAudioRecorder(options);
  const state = useAudioRecorderState(recorder, 250);
  const [stage, setStage] = useState<"idle" | "recording" | "saving">("idle");
  const [problem, setProblem] = useState<string | null>(null);

  // Opened fresh each time.
  useEffect(() => {
    if (visible) {
      setStage("idle");
      setProblem(null);
    }
  }, [visible]);

  const start = async () => {
    setProblem(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setProblem("Microphone access is off for Cliphy. Turn it on in Settings.");
        return;
      }
      // Record even with the ringer switched to silent.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStage("recording");
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const stop = async (keep: boolean) => {
    const seconds = state.durationMillis / 1000;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (!keep) {
        setStage("idle");
        onClose();
        return;
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording was made");
      setStage("saving");
      const mediaType =
        Platform.OS === "web" ? (options.web?.mimeType ?? "audio/webm") : "audio/mp4";
      const note = await saveRecording({ source: { uri }, mediaType, seconds });
      setStage("idle");
      onSaved(note);
      onClose();
    } catch (err) {
      setStage("idle");
      setProblem(errorText(err));
    }
  };

  const recording = stage === "recording";
  const close = () => {
    if (stage === "saving") return;
    if (recording) void stop(false);
    else onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        {/* Taps inside the sheet stay inside it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: t.bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderWidth: LINE,
            borderColor: t.line,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 36,
            alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: FONT, fontSize: 18, fontWeight: "700", color: t.text }}>
            Voice note
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontFamily: FONT,
              fontSize: 40,
              fontWeight: "700",
              color: recording ? t.text : t.muted,
              marginTop: 14,
              fontVariant: ["tabular-nums"],
            }}
          >
            {clock(recording ? state.durationMillis / 1000 : 0)}
          </Text>

          <Pressable
            onPress={() => (recording ? void stop(true) : void start())}
            disabled={stage === "saving"}
            accessibilityRole="button"
            accessibilityLabel={recording ? "Stop and save" : "Start recording"}
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              marginTop: 18,
              borderWidth: LINE,
              borderColor: t.line,
              backgroundColor: recording ? "#dc2626" : t.fill,
              alignItems: "center",
              justifyContent: "center",
              opacity: stage === "saving" ? 0.5 : 1,
              ...hardShadow(t.line),
            }}
          >
            {/* A square to stop, a dot to start. */}
            <View
              style={{
                width: recording ? 28 : 34,
                height: recording ? 28 : 34,
                borderRadius: recording ? 6 : 17,
                backgroundColor: "#fff",
              }}
            />
          </Pressable>

          <Text style={{ fontFamily: FONT, fontSize: 13, color: t.muted, marginTop: 14 }}>
            {stage === "saving" ? "Saving" : recording ? "Tap to stop and save" : "Tap to record"}
          </Text>
          {problem ? (
            <Text
              style={{
                fontFamily: FONT,
                fontSize: 13,
                color: t.due,
                marginTop: 10,
                textAlign: "center",
              }}
            >
              {problem}
            </Text>
          ) : null}

          <View style={{ flexDirection: "row", marginTop: 18 }}>
            <QuickButton
              label={recording ? "Discard" : "Close"}
              disabled={stage === "saving"}
              onPress={close}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
