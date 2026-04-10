import { View, Text, Pressable, Linking } from "react-native";
import type { Summary } from "@cliphy/shared";
import { neon } from "@cliphy/shared";

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

export function SummaryContent({ summary }: { summary: Summary }) {
  const json = summary.summaryJson;
  if (!json) return null;

  return (
    <View className="gap-1">
      {/* TL;DR */}
      <Section title="Summary">
        <Text
          className="text-base text-[#1f2937] dark:text-[#f0f0f0] leading-6"
          style={{ fontFamily: "DMSans" }}
        >
          {json.summary}
        </Text>
      </Section>

      {/* Key Points */}
      {json.keyPoints && json.keyPoints.length > 0 && (
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
      {json.contextSection && (
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
      {json.timestamps && json.timestamps.length > 0 && (
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

      {/* Tags */}
      {summary.tags && summary.tags.length > 0 && (
        <Section title="Tags">
          <View className="flex-row flex-wrap gap-1.5">
            {summary.tags.map((tag) => (
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
        </Section>
      )}
    </View>
  );
}
