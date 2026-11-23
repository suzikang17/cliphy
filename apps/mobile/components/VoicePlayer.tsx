import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { clock } from "../lib/voiceNote";
import { FONT, LINE, useCoachTheme } from "./coach/ui";

/** Play a voice note back: one button, how far in it is, and how long it runs. */
export function VoicePlayer({ url, seconds }: { url: string; seconds?: number }) {
  const t = useCoachTheme();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const length = status.duration || seconds || 0;
  const at = Math.min(status.currentTime, length || status.currentTime);

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Heard through the speaker even with the ringer switched to silent.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    // Finished: start again from the beginning.
    if (length > 0 && at >= length - 0.25) await player.seekTo(0);
    player.play();
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderWidth: LINE,
        borderColor: t.line,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: t.card,
      }}
    >
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play voice note"}
        hitSlop={8}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: LINE,
          borderColor: t.line,
          backgroundColor: t.fill,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={status.playing ? "pause" : "play"} size={20} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.hairline }}>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: t.accent,
              width: `${length > 0 ? Math.min(100, (at / length) * 100) : 0}%`,
            }}
          />
        </View>
        <Text
          style={{
            fontFamily: FONT,
            fontSize: 12,
            color: t.muted,
            marginTop: 6,
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${clock(at)} / ${clock(length)}`}
        </Text>
      </View>
    </View>
  );
}
