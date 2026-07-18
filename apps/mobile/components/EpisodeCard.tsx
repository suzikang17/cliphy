import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PodcastEpisode } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

interface Props {
  episode: PodcastEpisode;
  onQueue: () => void;
  onSkip: () => void;
}

export function EpisodeCard({ episode, onQueue, onSkip }: Props) {
  const duration = formatDuration(episode.durationSeconds);

  return (
    <View
      className="border-2 border-black dark:border-[#505050] bg-white dark:bg-[#282828] mb-2 p-3 rounded-lg"
      style={brutalShadowSm()}
    >
      {/* Top row: title + duration badge */}
      <View className="flex-row items-start mb-2">
        <Text
          className="font-semibold text-sm text-[#111827] dark:text-white flex-1 mr-2"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={2}
        >
          {episode.title}
        </Text>
        {duration ? (
          <View className="border border-[#d1d5db] dark:border-[#505050] px-2 py-0.5 rounded">
            <Text
              className="text-xs text-[#6b7280] dark:text-[#9ca3af]"
              style={{ fontFamily: "DMSans" }}
            >
              {duration}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Bottom row: date + status area */}
      <View className="flex-row items-center justify-between">
        <Text
          className="text-xs text-[#9ca3af] dark:text-[#6b7280]"
          style={{ fontFamily: "DMSans" }}
        >
          {formatDate(episode.publishedAt)}
        </Text>

        <View className="flex-row items-center">
          {episode.status === "pending_approval" && (
            <>
              <TouchableOpacity
                onPress={onQueue}
                className="bg-black dark:bg-white px-3 py-1 border-2 border-black dark:border-white"
                accessibilityRole="button"
                accessibilityLabel="Queue episode"
              >
                <Text
                  className="text-xs font-bold text-white dark:text-black"
                  style={{ fontFamily: "DMSans" }}
                >
                  Queue
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onSkip}
                className="border-2 border-black dark:border-[#505050] px-3 py-1 ml-2"
                accessibilityRole="button"
                accessibilityLabel="Skip episode"
              >
                <Text
                  className="text-xs text-[#111827] dark:text-white"
                  style={{ fontFamily: "DMSans" }}
                >
                  Skip
                </Text>
              </TouchableOpacity>
            </>
          )}

          {(episode.status === "queued" || episode.status === "processing") && (
            <Text
              className="text-xs text-[#6b7280] dark:text-[#9ca3af] italic"
              style={{ fontFamily: "DMSans" }}
            >
              Processing...
            </Text>
          )}

          {episode.status === "done" && (
            <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
          )}

          {episode.status === "skipped" && (
            <Text className="text-xs text-[#9ca3af]" style={{ fontFamily: "DMSans" }}>
              Skipped
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
