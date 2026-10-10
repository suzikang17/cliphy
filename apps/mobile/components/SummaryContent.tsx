import { View, Text, Pressable, Linking } from "react-native";
import type { Summary } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import { updateClipTags, dismissSuggestedTag, TagLimitError } from "../lib/api";
import { showQueueError } from "../lib/queueError";
import { SuggestedTags } from "./SuggestedTags";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text
        className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wide mb-2"
        style={{ fontFamily: "DMSans" }}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

type TagPatch = Partial<Pick<Summary, "tags" | "suggestedTags">>;

export function SummaryContent({
  summary,
  onTagsChange,
}: {
  summary: Summary;
  /** Called with optimistic and server-confirmed tag state. Omit to hide suggestions. */
  onTagsChange?: (patch: TagPatch) => void;
}) {
  const json = summary.summaryJson;
  const rawContent = summary.content?.trim();
  // Tweet/web/image clips carry their captured text in `content`; show it
  // directly so the detail screen is useful even before (or without) an AI summary.
  const showRaw =
    !!rawContent &&
    (summary.sourceType === "tweet" ||
      summary.sourceType === "web" ||
      summary.sourceType === "image");
  const hasTags = !!summary.tags && summary.tags.length > 0;
  const suggested = onTagsChange ? (summary.suggestedTags ?? []) : [];

  if (!json && !showRaw && !hasTags && suggested.length === 0) return null;

  function acceptSuggestion(tag: string) {
    if (!onTagsChange) return;
    const snapshot: TagPatch = { tags: summary.tags, suggestedTags: summary.suggestedTags };
    const nextTags = [...new Set([...(summary.tags ?? []), tag])];
    onTagsChange({ tags: nextTags, suggestedTags: suggested.filter((t) => t !== tag) });
    updateClipTags(summary.id, nextTags)
      .then((res) => onTagsChange({ tags: res.tags, suggestedTags: res.suggestedTags }))
      .catch((err) => {
        onTagsChange(snapshot);
        showQueueError(err instanceof TagLimitError ? err : new Error("Couldn't add tag"));
      });
  }

  function dismissSuggestion(tag: string) {
    if (!onTagsChange) return;
    const snapshot: TagPatch = { suggestedTags: summary.suggestedTags };
    onTagsChange({ suggestedTags: suggested.filter((t) => t !== tag) });
    dismissSuggestedTag(summary.id, tag)
      .then((res) => onTagsChange({ suggestedTags: res.suggestedTags }))
      .catch(() => {
        onTagsChange(snapshot);
        showQueueError(new Error("Couldn't dismiss suggestion"));
      });
  }

  return (
    <View className="gap-1">
      {showRaw && (
        <Section title={summary.sourceType === "tweet" ? "Tweet" : "Content"}>
          <Text
            className="text-base text-[#1f2937] dark:text-[#f0f0f0] leading-6"
            style={{ fontFamily: "DMSans" }}
          >
            {rawContent}
          </Text>
        </Section>
      )}

      {/* TL;DR */}
      {json?.summary && (
        <Section title="Summary">
          <Text
            className="text-base text-[#1f2937] dark:text-[#f0f0f0] leading-6"
            style={{ fontFamily: "DMSans" }}
          >
            {json.summary}
          </Text>
        </Section>
      )}

      {/* Key Points */}
      {json?.keyPoints && json.keyPoints.length > 0 && (
        <Section title="Highlights">
          <View className="gap-2.5">
            {json.keyPoints.map((point, i) => (
              <View key={i} className="flex-row gap-2">
                <Text
                  className="text-base font-bold"
                  style={{ fontFamily: "DMSans", color: neon[600] }}
                >
                  {"\u2022"}
                </Text>
                <Text
                  className="text-base text-[#1f2937] dark:text-[#f0f0f0] leading-6 flex-1"
                  style={{ fontFamily: "DMSans" }}
                >
                  {point}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Context Section */}
      {json?.contextSection && (
        <Section title={`${json.contextSection.icon} ${json.contextSection.title}`}>
          <View className="gap-2">
            {json.contextSection.items?.map((item, i) => (
              <Text
                key={i}
                className="text-base text-[#1f2937] dark:text-[#f0f0f0] leading-6"
                style={{ fontFamily: "DMSans" }}
              >
                {item}
              </Text>
            ))}
          </View>
        </Section>
      )}

      {/* Timestamps */}
      {json?.timestamps && json.timestamps.length > 0 && (
        <Section title="Timestamps">
          <View className="gap-2">
            {json.timestamps.map((ts, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  const match = ts.match(/^(\d+):(\d+)/);
                  if (match && summary.videoUrl) {
                    const seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
                    Linking.openURL(`${summary.videoUrl}&t=${seconds}`);
                  }
                }}
                style={{ minHeight: 44, justifyContent: "center" }}
                accessibilityRole="link"
                accessibilityLabel={`Jump to ${ts}`}
              >
                <Text className="text-sm" style={{ fontFamily: "DMSans", color: neon[600] }}>
                  {ts}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>
      )}

      {/* Tags + AI suggestions */}
      {(hasTags || suggested.length > 0) && (
        <Section title="Tags">
          <View className="flex-row flex-wrap gap-1.5">
            {(summary.tags ?? []).map((tag) => (
              <View key={tag} className="bg-[#ede0f8] dark:bg-[#221028] px-2.5 py-1 rounded-lg">
                <Text
                  className="text-xs font-medium"
                  style={{ fontFamily: "DMSans", color: neon[600] }}
                >
                  {tag}
                </Text>
              </View>
            ))}
          </View>
          {suggested.length > 0 && (
            <View className={hasTags ? "mt-2" : undefined}>
              <SuggestedTags
                tags={suggested}
                onAccept={acceptSuggestion}
                onDismiss={dismissSuggestion}
              />
            </View>
          )}
        </Section>
      )}
    </View>
  );
}
