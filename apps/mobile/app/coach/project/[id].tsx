import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CoachRequest, ProgressEntry } from "@cliphy/shared";
import { getProjectHistory, getProjects, type HistoryEntry } from "../../../lib/coachApi";
import { Body, FONT, LINE, Page, useCoachTheme } from "../../../components/coach/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The trail of the work: each request, newest first, with what it replaced kept underneath. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [name, setName] = useState("Project");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [photos, setPhotos] = useState<ProgressEntry[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([getProjectHistory(id), getProjects()])
      .then(([h, p]) => {
        setEntries(h.entries);
        setPhotos(h.progress ?? []);
        setName(p.projects.find((x) => x.id === id)?.name ?? "Project");
      })
      .catch(() => setFailed(true));
  }, [id]);

  const open = (r: CoachRequest) => router.push(`/coach/request/${r.id}` as never);

  return (
    <Page title={name} sub={entries ? `${entries.length} in history` : undefined}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
        {failed ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>Couldn't load this.</Body>
          </View>
        ) : null}
        {photos.some((p) => p.url) ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }}>
            {photos
              .filter((p) => p.url)
              .map((p) => (
                <View key={p.id} style={{ marginRight: 8 }}>
                  <Image
                    source={{ uri: p.url as string }}
                    accessibilityLabel={`Progress photo, ${when(p.createdAt)}`}
                    style={{
                      width: 110,
                      height: 146,
                      borderRadius: 6,
                      borderWidth: LINE,
                      borderColor: t.line,
                      backgroundColor: t.hairline,
                    }}
                  />
                  <Text style={{ fontFamily: FONT, fontSize: 11, color: t.muted, marginTop: 3 }}>
                    {when(p.createdAt)}
                  </Text>
                </View>
              ))}
          </ScrollView>
        ) : null}
        {entries?.length === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>Nothing confirmed yet.</Body>
          </View>
        ) : null}

        {entries?.map((entry) => (
          <View
            key={entry.request.id}
            style={{
              marginTop: 18,
              paddingLeft: 14,
              borderLeftWidth: LINE,
              borderLeftColor: t.line,
            }}
          >
            <Text style={{ fontFamily: FONT, fontSize: 11, fontWeight: "700", color: t.muted }}>
              {when(entry.request.createdAt)}
            </Text>
            <Text
              onPress={() => open(entry.request)}
              accessibilityRole="link"
              style={{
                fontFamily: FONT,
                fontSize: 15,
                lineHeight: 21,
                color: t.text,
                marginTop: 3,
              }}
            >
              {entry.request.understood}
            </Text>

            {entry.replaced.map((old) => (
              <View key={old.id} style={{ marginTop: 10, marginLeft: 12, opacity: 0.6 }}>
                <Text style={{ fontFamily: FONT, fontSize: 11, fontWeight: "700", color: t.muted }}>
                  {when(old.createdAt)} · Replaced
                </Text>
                <Text
                  onPress={() => open(old)}
                  accessibilityRole="link"
                  style={{
                    fontFamily: FONT,
                    fontSize: 14,
                    lineHeight: 20,
                    color: t.text,
                    marginTop: 2,
                    textDecorationLine: "line-through",
                  }}
                >
                  {old.understood}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </Page>
  );
}
