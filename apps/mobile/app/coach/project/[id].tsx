import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { CoachBatch, CoachRequest, ProgressEntry } from "@cliphy/shared";
import { batchLine, shortDay } from "../../../lib/coach";
import {
  createTask,
  getBatches,
  getProjectHistory,
  getProjects,
  updateProject,
  type HistoryEntry,
} from "../../../lib/coachApi";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../../components/coach/ui";

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
  // The website's repo and live site. With a repo, work can be started on the site.
  const [repo, setRepo] = useState("");
  const [site, setSite] = useState("");
  const [saved, setSaved] = useState({ repo: "", site: "" });
  const [siteNote, setSiteNote] = useState<{ repo?: string; site?: string }>({});

  // Batches of finished work, and a task added by hand.
  const [batches, setBatches] = useState<CoachBatch[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNote, setTaskNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Read again on return: a batch may have been made, checked or sent.
  useFocusEffect(
    useCallback(() => {
      getBatches(id)
        .then((r) => setBatches(r.batches))
        .catch(() => {});
    }, [id]),
  );

  const addTask = async () => {
    const title = taskTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setTaskNote(null);
    try {
      const { task } = await createTask({ kind: "do", title, projectId: id });
      setTaskTitle("");
      router.push(`/coach/task/${task.id}` as never);
    } catch {
      setTaskNote("Couldn't add that. Try again.");
    } finally {
      setAdding(false);
    }
  };

  useEffect(() => {
    Promise.all([getProjectHistory(id), getProjects()])
      .then(([h, p]) => {
        setEntries(h.entries);
        setPhotos(h.progress ?? []);
        const project = p.projects.find((x) => x.id === id);
        setName(project?.name ?? "Project");
        // Whoever is on the project, else whoever asked for its latest request.
        setClientId(project?.personIds[0] ?? h.entries[0]?.request.personId ?? null);
        const stored = { repo: project?.repo ?? "", site: project?.siteUrl ?? "" };
        setRepo(stored.repo);
        setSite(stored.site);
        setSaved(stored);
      })
      .catch(() => setFailed(true));
  }, [id]);

  /** Save one field when it is left, if it changed. The server's own words explain a refusal. */
  const save = async (field: "repo" | "site") => {
    const value = (field === "repo" ? repo : site).trim();
    if (value === saved[field]) return;
    try {
      const { project } = await updateProject(
        id,
        field === "repo" ? { repo: value } : { siteUrl: value },
      );
      const stored = field === "repo" ? (project.repo ?? "") : (project.siteUrl ?? "");
      setSaved((s) => ({ ...s, [field]: stored }));
      if (field === "repo") setRepo(stored);
      else setSite(stored);
      setSiteNote((n) => ({ ...n, [field]: "Saved." }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setSiteNote((n) => ({ ...n, [field]: message || "Couldn't save that." }));
    }
  };

  const input = {
    fontFamily: FONT,
    fontSize: 15,
    color: t.text,
    borderWidth: LINE,
    borderColor: t.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 8,
  } as const;
  const noteStyle = { fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 4 } as const;

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
        {!failed ? (
          <>
            <SectionLabel>Website</SectionLabel>
            <TextInput
              value={repo}
              onChangeText={setRepo}
              onBlur={() => void save("repo")}
              placeholder="owner/name"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Website repo"
              style={input}
            />
            <Text style={noteStyle}>
              {siteNote.repo ?? "Website repo on GitHub. With it, work can be started on the site."}
            </Text>
            <TextInput
              value={site}
              onChangeText={setSite}
              onBlur={() => void save("site")}
              placeholder="https://"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Live site"
              style={input}
            />
            <Text style={noteStyle}>{siteNote.site ?? "Live site, for the before picture."}</Text>
            <SectionLabel>Add a task</SectionLabel>
            <TextInput
              value={taskTitle}
              onChangeText={setTaskTitle}
              onSubmitEditing={() => void addTask()}
              placeholder="What needs doing"
              placeholderTextColor={t.muted}
              returnKeyType="done"
              accessibilityLabel="New task"
              style={input}
            />
            <Text style={noteStyle}>{taskNote ?? "Then pull in the texts it came from."}</Text>

            <SectionLabel>Batches</SectionLabel>
            {batches.map((b) => (
              <Row
                key={b.id}
                title={shortDay(b.createdAt)}
                detail={`${b.itemCount} ${b.itemCount === 1 ? "item" : "items"}`}
                right={batchLine(b)}
                onPress={() => router.push(`/coach/batch/${b.id}` as never)}
              />
            ))}
            {clientId ? (
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <QuickButton
                  label="New batch"
                  onPress={() =>
                    router.push(`/coach/batch/new?personId=${clientId}&projectId=${id}` as never)
                  }
                />
              </View>
            ) : (
              <Text style={noteStyle}>
                Batches start once a client has asked for something here.
              </Text>
            )}
            <SectionLabel>History</SectionLabel>
          </>
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
