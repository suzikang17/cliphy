import { useCallback, useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type {
  CoachBatch,
  CoachRequest,
  CoachTask,
  InboundMessage,
  ProgressEntry,
  Project,
} from "@cliphy/shared";
import {
  batchLine,
  dateChoices,
  errorText,
  newSince,
  projectTiles,
  shortDay,
  standing,
  taskDue,
} from "../../lib/coach";
import {
  createTask,
  getReady,
  updateTask,
  mergeProject,
  getBatches,
  getPeople,
  getPersonMessages,
  getProjectHistory,
  getProjects,
  getTasks,
  updateProject,
  type HistoryEntry,
} from "../../lib/coachApi";
import { markSeen } from "../../lib/seen";
import { MessageRow } from "./MessageRow";
import { WidgetLink } from "./Widget";
import { Body, FONT, LINE, Page, QuickButton, Row, useCoachTheme } from "./ui";

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
export function ProjectDetail({
  id,
  embedded,
  onChanged,
}: {
  id: string;
  /** Shown inside another screen: its own heading, no back arrow. */
  embedded?: boolean;
  /** The project was merged away or archived. */
  onChanged?: () => void;
}) {
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
  const [allHistory, setAllHistory] = useState(false);
  // Acting on tasks in place, and the tucked-away parts of the page.
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ task: CoachTask; word: string } | null>(null);
  const [actNote, setActNote] = useState<string | null>(null);
  const [openMore, setOpenMore] = useState<string | null>(null);
  // Tidying up: fold this project into another, or archive it.
  const [others, setOthers] = useState<Project[]>([]);
  const [merging, setMerging] = useState(false);
  const [tidyNote, setTidyNote] = useState<string | null>(null);
  const tidy = async (fn: () => Promise<unknown>) => {
    setTidyNote(null);
    try {
      await fn();
      if (onChanged) onChanged();
      else router.back();
    } catch (err) {
      setTidyNote(errorText(err));
    }
  };
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
      // Stays here: the new task joins the list, ready for the next one to be typed.
      setTasks((old) => [...old, task]);
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
        setOthers(p.projects.filter((x) => x.active && x.id !== id));
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
      getReady(id)
        .then((r) => live && setReady(r.requests.length + r.tasks.length))
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

  const sub = [clientName, stateLine].filter(Boolean).join(" · ") || undefined;
  // Acting on a task where it is listed: finish it, move its date, or drop it.
  const refreshReady = () =>
    getReady(id)
      .then((r) => setReady(r.requests.length + r.tasks.length))
      .catch(() => {});
  const finish = async (task: CoachTask, state: "done" | "dropped") => {
    setActNote(null);
    setOpenTask(null);
    setTasks((old) => old.filter((x) => x.id !== task.id));
    setUndo({ task, word: state === "done" ? "Done" : "Dropped" });
    try {
      await updateTask(task.id, { state });
      void refreshReady();
    } catch (err) {
      setTasks((old) => [...old, task]);
      setUndo(null);
      setActNote(errorText(err));
    }
  };
  const putBack = async () => {
    if (!undo) return;
    const { task } = undo;
    setUndo(null);
    setTasks((old) => [...old, task]);
    try {
      await updateTask(task.id, { state: "open" });
      void refreshReady();
    } catch (err) {
      setTasks((old) => old.filter((x) => x.id !== task.id));
      setActNote(errorText(err));
    }
  };
  const moveDate = async (task: CoachTask, dueDate: string | null) => {
    setActNote(null);
    setOpenTask(null);
    setTasks((old) => old.map((x) => (x.id === task.id ? { ...x, dueDate } : x)));
    try {
      await updateTask(task.id, { dueDate });
    } catch (err) {
      setTasks((old) => old.map((x) => (x.id === task.id ? task : x)));
      setActNote(errorText(err));
    }
  };

  const heading = (label: string, action?: React.ReactNode) => (
    <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 30, marginBottom: 6 }}>
      <Text
        accessibilityRole="header"
        style={{ flex: 1, fontFamily: FONT, fontSize: 18, fontWeight: "700", color: t.text }}
      >
        {label}
      </Text>
      {action}
    </View>
  );
  /** A line that opens a tucked-away part of the page. */
  const more = (
    key: string,
    label: string,
    detail: string | undefined,
    content: React.ReactNode,
  ) => (
    <View key={key} style={{ borderTopWidth: 1, borderTopColor: t.hairline }}>
      <Pressable
        onPress={() => setOpenMore(openMore === key ? null : key)}
        accessibilityRole="button"
        accessibilityState={{ expanded: openMore === key }}
        style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13 }}
      >
        <Text style={{ flex: 1, fontFamily: FONT, fontSize: 15, fontWeight: "500", color: t.text }}>
          {label}
        </Text>
        {detail ? (
          <Text style={{ ...noteStyle, marginTop: 0, marginRight: 10 }}>{detail}</Text>
        ) : null}
        <Text style={{ fontFamily: FONT, fontSize: 15, color: t.muted }}>
          {openMore === key ? "–" : "+"}
        </Text>
      </Pressable>
      {openMore === key ? <View style={{ paddingBottom: 16 }}>{content}</View> : null}
    </View>
  );

  const body = (
    <ScrollView keyboardShouldPersistTaps="handled">
      {/* One column, no boxes: sections under headings, with room to read. */}
      <View
        style={{
          width: "100%",
          maxWidth: 760,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 60,
        }}
      >
        {failed ? <Body muted>{failed}</Body> : null}

        {!failed ? (
          <>
            <Text style={{ fontFamily: FONT, fontSize: 15, color: t.muted }}>
              {standing(tiles)}
            </Text>

            {heading("To do")}
            {todo.length === 0 ? <Text style={noteStyle}>Nothing open.</Text> : null}
            {todo.map((task) => {
              const due = taskDue(task.dueDate, today);
              const waiting = task.state === "waiting";
              const word = waiting
                ? "Waiting"
                : task.blocked
                  ? "Blocked"
                  : (due?.text ?? "No date");
              return (
                <View
                  key={task.id}
                  style={{
                    borderBottomWidth: 1,
                    borderBottomColor: t.hairline,
                    paddingVertical: 10,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Pressable
                      onPress={() => void finish(task, "done")}
                      disabled={task.blocked}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: false, disabled: task.blocked }}
                      accessibilityLabel={`Done: ${task.title}`}
                      hitSlop={8}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        borderWidth: LINE,
                        borderColor: task.blocked ? t.hairline : t.line,
                      }}
                    />
                    <Pressable
                      onPress={() => router.push(`/coach/task/${task.id}` as never)}
                      accessibilityRole="link"
                      style={{ flex: 1 }}
                    >
                      <Text
                        style={{
                          fontFamily: FONT,
                          fontSize: 16,
                          lineHeight: 22,
                          color: task.blocked ? t.muted : t.text,
                        }}
                      >
                        {task.title}
                      </Text>
                      {isNew.has(task.id) ? (
                        <Text
                          style={{ ...noteStyle, marginTop: 1, color: t.accent, fontWeight: "700" }}
                        >
                          New
                        </Text>
                      ) : null}
                    </Pressable>
                    <Text
                      onPress={() => setOpenTask(openTask === task.id ? null : task.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${word}. Change`}
                      style={{
                        fontFamily: FONT,
                        fontSize: 13,
                        fontWeight: "700",
                        color: due?.late && !waiting ? t.due : t.muted,
                        textDecorationLine: "underline",
                      }}
                    >
                      {word}
                    </Text>
                  </View>
                  {openTask === task.id ? (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 8,
                        marginTop: 10,
                        marginLeft: 36,
                      }}
                    >
                      {dateChoices(today).map((choice) => (
                        <QuickButton
                          key={choice.label}
                          label={choice.label}
                          chosen={task.dueDate === choice.date}
                          onPress={() => void moveDate(task, choice.date)}
                        />
                      ))}
                      <QuickButton label="Drop" onPress={() => void finish(task, "dropped")} />
                    </View>
                  ) : null}
                </View>
              );
            })}
            {undo ? (
              <Text style={{ ...noteStyle, marginTop: 10 }}>
                {`${undo.word}: ${undo.task.title}. `}
                <Text
                  onPress={() => void putBack()}
                  accessibilityRole="button"
                  style={{ fontWeight: "700", color: t.text, textDecorationLine: "underline" }}
                >
                  Undo
                </Text>
              </Text>
            ) : null}
            {actNote ? <Text style={{ ...noteStyle, marginTop: 10 }}>{actNote}</Text> : null}
            <TextInput
              value={taskTitle}
              onChangeText={setTaskTitle}
              onSubmitEditing={() => void addTask()}
              placeholder="Add a task"
              placeholderTextColor={t.muted}
              returnKeyType="done"
              blurOnSubmit={false}
              accessibilityLabel="New task"
              style={{ ...input, marginTop: 14 }}
            />
            {taskNote ? <Text style={noteStyle}>{taskNote}</Text> : null}

            {heading(
              "Report",
              clientId ? <WidgetLink label="New batch" onPress={newBatch} /> : undefined,
            )}
            {ready > 0 && clientId ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 }}
              >
                <QuickButton label={`Batch ${ready} ready`} primary onPress={newBatch} />
                <Text style={{ ...noteStyle, marginTop: 0 }}>Finished, not yet reported.</Text>
              </View>
            ) : null}
            {batches.slice(0, SHOWN).map((b) => (
              <Row
                key={b.id}
                title={shortDay(b.createdAt)}
                detail={`${b.itemCount} ${b.itemCount === 1 ? "item" : "items"}`}
                right={batchLine(b)}
                onPress={() => router.push(`/coach/batch/${b.id}` as never)}
              />
            ))}
            {batches.length === 0 && ready === 0 ? (
              <Text style={noteStyle}>Nothing finished to report yet.</Text>
            ) : null}

            {clientId ? (
              <>
                {heading(
                  clientName ? `Latest from ${clientName}` : "Latest texts",
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <WidgetLink
                      label="Find requests"
                      onPress={() =>
                        router.push(`/coach/digest/${clientId}?projectId=${id}` as never)
                      }
                    />
                    <WidgetLink
                      label="All texts"
                      onPress={() =>
                        router.push(`/coach/thread/${clientId}?projectId=${id}` as never)
                      }
                    />
                  </View>,
                )}
                {latest.map((m) => (
                  <MessageRow key={m.id} message={m} />
                ))}
                {latest.length === 0 ? (
                  <Text style={noteStyle}>No messages captured yet.</Text>
                ) : null}
              </>
            ) : null}

            <View style={{ marginTop: 34, borderBottomWidth: 1, borderBottomColor: t.hairline }}>
              {more(
                "asked",
                "Everything asked",
                entries ? String(entries.length) : undefined,
                <>
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
                    <View style={{ marginTop: 10 }}>
                      <WidgetLink
                        label={allHistory ? "Show fewer" : `Show all ${entries?.length}`}
                        onPress={() => setAllHistory((on) => !on)}
                      />
                    </View>
                  ) : null}
                </>,
              )}

              {photos.some((p) => p.url)
                ? more(
                    "pictures",
                    "Pictures",
                    String(photos.filter((p) => p.url).length),
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                            <Text style={{ ...noteStyle, fontSize: 11 }}>{when(p.createdAt)}</Text>
                          </View>
                        ))}
                    </ScrollView>,
                  )
                : null}

              {more(
                "site",
                "Site",
                saved.site
                  ? saved.site.replace(/^https?:\/\//, "").replace(/\/$/, "")
                  : "Not linked",
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
                  {saved.site ? (
                    <View style={{ flexDirection: "row", marginTop: 10 }}>
                      <QuickButton
                        label="Open site"
                        onPress={() => void Linking.openURL(saved.site)}
                      />
                    </View>
                  ) : null}
                </>,
              )}

              {more(
                "tidy",
                "Merge or archive",
                undefined,
                merging ? (
                  <>
                    <Text style={noteStyle}>Move everything in this project into:</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                      {others.map((other) => (
                        <QuickButton
                          key={other.id}
                          label={other.name}
                          onPress={() => tidy(() => mergeProject(id, other.id))}
                        />
                      ))}
                      <QuickButton label="Cancel" onPress={() => setMerging(false)} />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {others.length > 0 ? (
                        <QuickButton label="Merge into…" onPress={() => setMerging(true)} />
                      ) : null}
                      <QuickButton
                        label="Archive"
                        onPress={() => tidy(() => updateProject(id, { active: false }))}
                      />
                    </View>
                    {tidyNote ? <Text style={noteStyle}>{tidyNote}</Text> : null}
                  </>
                ),
              )}
            </View>
          </>
        ) : null}
      </View>
    </ScrollView>
  );

  if (!embedded) {
    return (
      <Page title={name} sub={sub}>
        {body}
      </Page>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 12,
          borderBottomWidth: LINE,
          borderBottomColor: t.line,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ fontFamily: FONT, fontSize: 22, fontWeight: "700", color: t.text }}
        >
          {name}
        </Text>
        {sub ? (
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 2 }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {body}
    </View>
  );
}
