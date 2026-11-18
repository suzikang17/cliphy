import { useCallback, useEffect, useState } from "react";
import { Image, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type {
  CoachBatch,
  CoachRequest,
  CoachTask,
  InboundMessage,
  ProgressEntry,
} from "@cliphy/shared";
import {
  batchLine,
  errorText,
  newSince,
  projectTiles,
  shortDay,
  taskDue,
} from "../../../lib/coach";
import {
  createTask,
  getBatchCandidates,
  getBatches,
  getPeople,
  getPersonMessages,
  getProjectHistory,
  getProjects,
  getTasks,
  updateProject,
  type HistoryEntry,
} from "../../../lib/coachApi";
import { markSeen } from "../../../lib/seen";
import { MessageRow } from "../../../components/coach/MessageRow";
import { Tile, Widget, WidgetGrid, WidgetLink } from "../../../components/coach/Widget";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  Row,
  useCoachTheme,
} from "../../../components/coach/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** How many rows a widget shows before "N more". */
const SHOWN = 6;

/**
 * One project as a board of small widgets: where it stands in numbers, what is
 * to do, batches, the client's latest words, the site, pictures, and the trail
 * of everything asked.
 */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [name, setName] = useState("Project");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [photos, setPhotos] = useState<ProgressEntry[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
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

  // What is still to do here, who the client is and what they last said.
  const [tasks, setTasks] = useState<CoachTask[]>([]);
  const [clientName, setClientName] = useState<string | null>(null);
  const [stateLine, setStateLine] = useState("");
  const [recent, setRecent] = useState<InboundMessage[]>([]);
  const [ready, setReady] = useState(0);
  const [editingSite, setEditingSite] = useState(false);
  const [allHistory, setAllHistory] = useState(false);
  // When this project was last opened before now: tasks added since are "New".
  const [seenBefore, setSeenBefore] = useState<string | undefined>(undefined);
  useEffect(() => {
    void markSeen(id).then(setSeenBefore);
  }, [id]);

  // Read again on return: a batch may have been made, checked or sent.
  useFocusEffect(
    useCallback(() => {
      getBatches(id)
        .then((r) => setBatches(r.batches))
        .catch(() => {});
      getTasks(id)
        .then((r) => setTasks(r.tasks))
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
    } catch (err) {
      setTaskNote(errorText(err));
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
        setStateLine(project?.stateLine ?? "");
      })
      .catch((err) => setFailed(errorText(err)));
  }, [id]);

  // The client's side: their name, their latest messages, and how much
  // finished work has not been reported to them yet.
  useFocusEffect(
    useCallback(() => {
      if (!clientId) return;
      let live = true;
      getPeople()
        .then((r) => live && setClientName(r.people.find((p) => p.id === clientId)?.name ?? null))
        .catch(() => {});
      getPersonMessages(clientId)
        .then((r) => live && setRecent(r.messages))
        .catch(() => {});
      getBatchCandidates(clientId, id)
        .then((c) => live && setReady(c.requests.length + c.tasks.length))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [clientId, id]),
  );

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
      setSiteNote((n) => ({ ...n, [field]: errorText(err) }));
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

  const today = new Date().toLocaleDateString("en-CA");
  const lastHeard = recent.find((m) => m.direction === "in")?.sentAt ?? null;
  const tiles = projectTiles({ tasks, ready, lastHeardAt: lastHeard, now: new Date() });
  // Newest first, whichever order they came in.
  const latest = [...recent].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 3);
  const todo = tasks.filter((x) => x.state === "open" || x.state === "waiting");
  const isNew = new Set(newSince(todo, seenBefore).map((x) => x.id));
  const trail = allHistory ? (entries ?? []) : (entries ?? []).slice(0, SHOWN);
  const newBatch = () =>
    router.push(`/coach/batch/new?personId=${clientId}&projectId=${id}` as never);

  return (
    <Page title={name} sub={[clientName, stateLine].filter(Boolean).join(" · ") || undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 48,
          gap: 12,
        }}
      >
        {failed ? <Body muted>{failed}</Body> : null}

        {!failed ? (
          <>
            <WidgetGrid gap={10}>
              {tiles.map((tile) => (
                <Tile
                  key={tile.key}
                  value={tile.value}
                  label={tile.label}
                  strong={tile.key === "ready" && ready > 0}
                />
              ))}
            </WidgetGrid>

            <WidgetGrid>
              <Widget title="To do" count={todo.length}>
                {todo.slice(0, SHOWN).map((task) => {
                  const due = taskDue(task.dueDate, today);
                  return (
                    <Row
                      key={task.id}
                      title={task.title}
                      detail={isNew.has(task.id) ? "New" : undefined}
                      right={
                        task.state === "waiting" ? "Waiting" : task.blocked ? "Blocked" : due?.text
                      }
                      rightColor={due?.late && task.state === "open" ? t.due : undefined}
                      dim={task.blocked}
                      onPress={() => router.push(`/coach/task/${task.id}` as never)}
                    />
                  );
                })}
                {todo.length > SHOWN ? (
                  <Text style={noteStyle}>{`${todo.length - SHOWN} more in Up next`}</Text>
                ) : null}
                {todo.length === 0 ? <Text style={noteStyle}>Nothing open.</Text> : null}
                <TextInput
                  value={taskTitle}
                  onChangeText={setTaskTitle}
                  onSubmitEditing={() => void addTask()}
                  placeholder="Add a task"
                  placeholderTextColor={t.muted}
                  returnKeyType="done"
                  accessibilityLabel="New task"
                  style={input}
                />
                {taskNote ? <Text style={noteStyle}>{taskNote}</Text> : null}
              </Widget>

              <Widget
                title="Batches"
                count={batches.length}
                action={clientId ? <WidgetLink label="New" onPress={newBatch} /> : undefined}
              >
                {batches.slice(0, SHOWN).map((b) => (
                  <Row
                    key={b.id}
                    title={shortDay(b.createdAt)}
                    detail={`${b.itemCount} ${b.itemCount === 1 ? "item" : "items"}`}
                    right={batchLine(b)}
                    onPress={() => router.push(`/coach/batch/${b.id}` as never)}
                  />
                ))}
                {batches.length === 0 ? (
                  <Text style={noteStyle}>
                    {clientId
                      ? "Finished work you check, then report in one message."
                      : "Batches start once a client has asked for something here."}
                  </Text>
                ) : null}
                {clientId && ready > 0 ? (
                  <View style={{ flexDirection: "row", marginTop: 10 }}>
                    <QuickButton label={`Batch ${ready} ready`} primary onPress={newBatch} />
                  </View>
                ) : null}
              </Widget>

              <Widget
                title={clientName ?? "Client"}
                action={
                  clientId ? (
                    <WidgetLink
                      label="All texts"
                      onPress={() =>
                        router.push(`/coach/thread/${clientId}?projectId=${id}` as never)
                      }
                    />
                  ) : undefined
                }
              >
                {latest.map((m) => (
                  <MessageRow key={m.id} message={m} compact />
                ))}
                {latest.length === 0 ? (
                  <Text style={noteStyle}>
                    {clientId ? "No messages captured yet." : "Nobody is on this project yet."}
                  </Text>
                ) : null}
              </Widget>

              <Widget
                title="Site"
                action={
                  <WidgetLink
                    label={editingSite ? "Done" : saved.site || saved.repo ? "Edit" : "Add"}
                    onPress={() => setEditingSite((on) => !on)}
                  />
                }
              >
                {editingSite ? (
                  <>
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
                    <Text style={noteStyle}>{siteNote.site ?? "The live site."}</Text>
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
                      {siteNote.repo ??
                        "Its repo on GitHub. With it, work can be started on the site."}
                    </Text>
                  </>
                ) : (
                  <>
                    {saved.site ? (
                      <Row
                        title={saved.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        right="Open"
                        onPress={() => void Linking.openURL(saved.site)}
                      />
                    ) : null}
                    {saved.repo ? <Row title={saved.repo} detail="GitHub repo" /> : null}
                    {!saved.site && !saved.repo ? (
                      <Text style={noteStyle}>No site linked yet.</Text>
                    ) : null}
                  </>
                )}
              </Widget>

              {photos.some((p) => p.url) ? (
                <Widget title="Pictures" wide>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 8 }}
                  >
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
                          <Text
                            style={{ fontFamily: FONT, fontSize: 11, color: t.muted, marginTop: 3 }}
                          >
                            {when(p.createdAt)}
                          </Text>
                        </View>
                      ))}
                  </ScrollView>
                </Widget>
              ) : null}

              <Widget title="Asked" count={entries?.length} wide>
                {entries?.length === 0 ? <Text style={noteStyle}>Nothing asked yet.</Text> : null}
                {trail.map((entry) => (
                  <View key={entry.request.id}>
                    <Row
                      title={entry.request.understood}
                      detail={when(entry.request.createdAt)}
                      right={
                        entry.request.openQuestion && !entry.request.answer
                          ? "Needs your answer"
                          : entry.request.status === "new"
                            ? "New"
                            : undefined
                      }
                      rightColor={t.due}
                      onPress={() => open(entry.request)}
                    />
                    {entry.replaced.map((old) => (
                      <View key={old.id} style={{ marginLeft: 14 }}>
                        <Row
                          title={old.understood}
                          detail={`${when(old.createdAt)} · Replaced`}
                          dim
                          onPress={() => open(old)}
                        />
                      </View>
                    ))}
                  </View>
                ))}
                {(entries?.length ?? 0) > SHOWN ? (
                  <View style={{ marginTop: 8 }}>
                    <WidgetLink
                      label={allHistory ? "Show fewer" : `Show all ${entries?.length}`}
                      onPress={() => setAllHistory((on) => !on)}
                    />
                  </View>
                ) : null}
              </Widget>
            </WidgetGrid>
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
