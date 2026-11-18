import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import type { CoachRequest, CoachTask, Person, Project } from "@cliphy/shared";
import {
  errorText,
  newSince,
  projectBoard,
  taskDue,
  workBoard,
  type ProjectCard,
  type WorkCard,
} from "../../lib/coach";
import {
  createProject,
  getPeople,
  getProjects,
  getReady,
  getTasks,
  updateProject,
} from "../../lib/coachApi";
import { startSeeing } from "../../lib/seen";
import { ProjectDetail } from "../../components/coach/ProjectDetail";
import { WidgetLink } from "../../components/coach/Widget";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../components/coach/ui";

type ViewKind = "detail" | "board" | "table";
const VIEWS: [ViewKind, string][] = [
  ["detail", "Detail"],
  ["board", "Board"],
  ["table", "Table"],
];
const VIEW_KEY = "cliphy:coach:projects-view";
/** Below this much room the list and the detail cannot sit side by side. */
const SIDE_BY_SIDE = 900;

/**
 * Projects, three ways, with a switcher that remembers the last one used:
 * Detail (a list beside the chosen project's whole page), Board (every
 * project's work in three columns) and Table (one dense row per project).
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const t = useCoachTheme();
  const wide = useWindowDimensions().width >= SIDE_BY_SIDE + 220;
  const [view, setView] = useState<ViewKind>("detail");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tasks, setTasks] = useState<CoachTask[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [ready, setReady] = useState<{ requests: CoachRequest[]; tasks: CoachTask[] }>({
    requests: [],
    tasks: [],
  });
  const [fresh, setFresh] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then((saved) => {
        if (VIEWS.some(([key]) => key === saved)) setView(saved as ViewKind);
      })
      .catch(() => {});
  }, []);
  const choose = (next: ViewKind) => {
    setView(next);
    AsyncStorage.setItem(VIEW_KEY, next).catch(() => {});
  };

  const load = useCallback(async () => {
    try {
      const [{ projects: all }, taskList, peopleList, readyList] = await Promise.all([
        getProjects(),
        // The projects still show if the rest can't be read.
        getTasks().catch(() => null),
        getPeople().catch(() => null),
        getReady().catch(() => null),
      ]);
      setProjects(all);
      setTasks(taskList?.tasks ?? []);
      setPeople(peopleList?.people ?? []);
      setReady(readyList ?? { requests: [], tasks: [] });
      setFailed(null);
      const seen = await startSeeing(all.map((p) => p.id));
      setFresh(
        Object.fromEntries(
          all.map((p) => [
            p.id,
            newSince(
              (taskList?.tasks ?? []).filter((task) => task.projectId === p.id),
              seen[p.id],
            ).length,
          ]),
        ),
      );
    } catch (err) {
      setFailed(errorText(err));
    }
  }, []);

  // Read again on return: tasks get done and projects get added elsewhere.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = useMemo(() => (projects ?? []).filter((p) => p.active), [projects]);
  const archived = (projects ?? []).filter((p) => !p.active);
  const groups = useMemo(() => projectBoard(active, tasks, people), [active, tasks, people]);
  const cards = groups.flatMap((g) => g.projects);
  const readyIn = (projectId: string) =>
    ready.requests.filter((r) => r.projectId === projectId).length +
    ready.tasks.filter((x) => x.projectId === projectId).length;
  const clientOf = (projectId: string) =>
    groups.find((g) => g.projects.some((p) => p.id === projectId)) ?? null;
  // The busiest project is shown until one is picked.
  const shown = active.some((p) => p.id === chosen) ? chosen : (cards[0]?.id ?? null);
  const today = new Date().toLocaleDateString("en-CA");
  const open = (id: string) => router.push(`/coach/project/${id}` as never);

  const add = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { project } = await createProject(title);
      setName("");
      setAdding(false);
      await load();
      if (wide && view === "detail") setChosen(project.id);
      else open(project.id);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const small = { fontFamily: FONT, fontSize: 12, color: t.muted } as const;
  const count = (n: number, strong?: boolean) => (
    <Text
      style={{
        width: 64,
        textAlign: "right",
        fontFamily: FONT,
        fontSize: 14,
        fontWeight: "700",
        color: n > 0 ? (strong ? t.accent : t.text) : t.muted,
      }}
    >
      {n > 0 ? n : "–"}
    </Text>
  );
  const pill = (n: number) =>
    n > 0 ? (
      <View
        style={{
          backgroundColor: t.fill,
          borderRadius: 9,
          paddingHorizontal: 7,
          paddingVertical: 1,
        }}
      >
        <Text style={{ fontFamily: FONT, fontSize: 11, fontWeight: "700", color: "#fff" }}>
          {`${n} new`}
        </Text>
      </View>
    ) : null;

  // ── Detail: a list beside the chosen project ────────────────────────────

  const listRow = (project: ProjectCard) => {
    const on = wide && project.id === shown;
    return (
      <Pressable
        key={project.id}
        onPress={() => (wide ? setChosen(project.id) : open(project.id))}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={project.name}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 9,
          marginBottom: 2,
          borderRadius: 8,
          borderWidth: LINE,
          borderColor: on ? t.line : "transparent",
          backgroundColor: on ? t.card : "transparent",
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: FONT,
            fontSize: 15,
            fontWeight: on ? "700" : "500",
            color: project.todo + project.waiting > 0 || on ? t.text : t.muted,
          }}
        >
          {project.name}
        </Text>
        {pill(fresh[project.id] ?? 0)}
        {project.todo > 0 ? (
          <Text style={{ fontFamily: FONT, fontSize: 13, fontWeight: "700", color: t.accent }}>
            {project.todo}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const list = (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {groups.map((group) => (
        <View key={group.clientId ?? "none"} style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 10 }}>
            <View style={{ flex: 1 }}>
              <SectionLabel>{group.client ?? "No client"}</SectionLabel>
            </View>
            {group.clientId ? (
              <WidgetLink
                label="Texts"
                onPress={() => router.push(`/coach/thread/${group.clientId}` as never)}
              />
            ) : null}
          </View>
          <View style={{ marginTop: 6 }}>{group.projects.map(listRow)}</View>
        </View>
      ))}
      {archived.length > 0 ? (
        <View style={{ paddingHorizontal: 10, marginTop: 10 }}>
          <WidgetLink
            label={showArchived ? "Hide archived" : `${archived.length} archived`}
            onPress={() => setShowArchived((on) => !on)}
          />
          {showArchived
            ? archived.map((p) => (
                <Row
                  key={p.id}
                  title={p.name}
                  right="Restore"
                  dim
                  onPress={() => void updateProject(p.id, { active: true }).then(load, () => {})}
                />
              ))
            : null}
        </View>
      ) : null}
    </ScrollView>
  );

  const detailView = wide ? (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: 270, borderRightWidth: LINE, borderRightColor: t.line }}>{list}</View>
      <View style={{ flex: 1 }}>
        {shown ? (
          <ProjectDetail
            key={shown}
            id={shown}
            embedded
            onChanged={() => {
              setChosen(null);
              void load();
            }}
          />
        ) : null}
      </View>
    </View>
  ) : (
    list
  );

  // ── Board: all work in three columns ─────────────────────────────────────

  const board = workBoard({ tasks, ready, projects: active, projectId: filter });
  const filtered = active.find((p) => p.id === filter) ?? null;
  const column = (title: string, items: WorkCard[], empty: string, footer?: React.ReactNode) => (
    <View
      style={{
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 280,
        maxWidth: "100%",
        borderWidth: LINE,
        borderColor: t.line,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 12,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ ...small, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 }}
      >
        {`${title.toUpperCase()} · ${items.length}`}
      </Text>
      {items.length === 0 ? <Text style={{ ...small, marginTop: 10 }}>{empty}</Text> : null}
      {items.map((item) => {
        const due = taskDue(item.dueDate, today);
        return (
          <Pressable
            key={item.key}
            onPress={() => router.push(item.path as never)}
            accessibilityRole="button"
            style={{
              marginTop: 8,
              borderWidth: LINE,
              borderColor: t.hairline,
              borderRadius: 8,
              backgroundColor: t.card,
              paddingHorizontal: 10,
              paddingVertical: 8,
              opacity: item.blocked ? 0.6 : 1,
            }}
          >
            <Text style={{ fontFamily: FONT, fontSize: 14, fontWeight: "500", color: t.text }}>
              {item.title}
            </Text>
            <View style={{ flexDirection: "row", marginTop: 3 }}>
              <Text style={{ ...small, flex: 1 }}>{item.project ?? "No project"}</Text>
              {item.blocked || due ? (
                <Text style={{ ...small, fontWeight: "700", color: due?.late ? t.due : t.muted }}>
                  {item.blocked ? "Blocked" : due?.text}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      {footer}
    </View>
  );

  const boardView = (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <QuickButton label="All" chosen={filter === null} onPress={() => setFilter(null)} />
        {active.map((p) => (
          <QuickButton
            key={p.id}
            label={p.name}
            chosen={filter === p.id}
            onPress={() => setFilter(p.id)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        {column("To do", board.todo, "Nothing to do.")}
        {column("Waiting on them", board.waiting, "Nothing waiting.")}
        {column(
          "Ready to report",
          board.ready,
          "Nothing finished and unreported.",
          filtered && board.ready.length > 0 && clientOf(filtered.id)?.clientId ? (
            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <QuickButton
                label={`Batch ${board.ready.length} ready`}
                primary
                onPress={() =>
                  router.push(
                    `/coach/batch/new?personId=${clientOf(filtered.id)?.clientId}&projectId=${filtered.id}` as never,
                  )
                }
              />
            </View>
          ) : board.ready.length > 0 ? (
            <Text style={{ ...small, marginTop: 10 }}>Pick a project above to batch these.</Text>
          ) : null,
        )}
      </View>
    </ScrollView>
  );

  // ── Table: one row per project ───────────────────────────────────────────

  const tableRow = (project: ProjectCard) => (
    <Pressable
      key={project.id}
      onPress={() => open(project.id)}
      accessibilityRole="button"
      accessibilityLabel={project.name}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: t.hairline,
      }}
    >
      <View style={{ flex: 2, minWidth: 0, paddingRight: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: "700",
              color: t.text,
            }}
          >
            {project.name}
          </Text>
          {pill(fresh[project.id] ?? 0)}
        </View>
        <Text numberOfLines={1} style={small}>
          {clientOf(project.id)?.client ?? "No client"}
        </Text>
      </View>
      {wide ? (
        <Text
          numberOfLines={1}
          style={{ flex: 3, minWidth: 0, paddingRight: 12, ...small, fontSize: 14 }}
        >
          {project.next[0]?.title ?? "–"}
        </Text>
      ) : null}
      {count(project.todo, true)}
      {count(project.waiting)}
      {count(readyIn(project.id))}
    </Pressable>
  );
  const busyCards = cards.filter((p) => p.todo + p.waiting + readyIn(p.id) > 0);
  const quietCards = cards.filter((p) => !busyCards.includes(p));
  const heading = (label: string, width?: number, flex?: number) => (
    <Text
      style={{
        ...small,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        ...(width ? { width, textAlign: "right" as const } : { flex, paddingRight: 12 }),
      }}
    >
      {label}
    </Text>
  );
  const tableView = (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}>
      <View
        style={{
          flexDirection: "row",
          paddingTop: 16,
          paddingBottom: 8,
          borderBottomWidth: LINE,
          borderBottomColor: t.line,
        }}
      >
        {heading("PROJECT", undefined, 2)}
        {wide ? heading("NEXT", undefined, 3) : null}
        {heading("TO DO", 64)}
        {heading("WAITING", 64)}
        {heading("READY", 64)}
      </View>
      {busyCards.map(tableRow)}
      {busyCards.length === 0 && projects ? (
        <Text style={{ ...small, marginTop: 14 }}>Nothing open in any project.</Text>
      ) : null}
      {quietCards.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <WidgetLink
            label={showQuiet ? "Hide quiet projects" : `Quiet (${quietCards.length})`}
            onPress={() => setShowQuiet((on) => !on)}
          />
          {showQuiet ? quietCards.map(tableRow) : null}
        </View>
      ) : null}
    </ScrollView>
  );

  return (
    <Page
      root
      title="Projects"
      sub={
        projects
          ? `${active.length} active${archived.length ? ` · ${archived.length} archived` : ""}`
          : undefined
      }
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.hairline,
        }}
      >
        {VIEWS.map(([key, label]) => (
          <QuickButton key={key} label={label} chosen={view === key} onPress={() => choose(key)} />
        ))}
        <View style={{ flex: 1 }} />
        {adding ? (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void add()}
              autoFocus
              placeholder="Project name"
              placeholderTextColor={t.muted}
              returnKeyType="done"
              accessibilityLabel="New project name"
              style={{
                minWidth: 180,
                fontFamily: FONT,
                fontSize: 14,
                color: t.text,
                borderWidth: LINE,
                borderColor: t.line,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            />
            <QuickButton label="Add" primary disabled={busy || !name.trim()} onPress={add} />
            <QuickButton label="Cancel" onPress={() => setAdding(false)} />
          </>
        ) : (
          <QuickButton label="New project" onPress={() => setAdding(true)} />
        )}
      </View>

      {failed || note ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Body muted>{failed ?? note}</Body>
        </View>
      ) : null}
      {projects && active.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Body muted>No projects yet.</Body>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        {view === "detail" ? detailView : view === "board" ? boardView : tableView}
      </View>
    </Page>
  );
}
