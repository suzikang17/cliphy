import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Project } from "@cliphy/shared";
import {
  errorText,
  projectBoard,
  taskDue,
  type ClientGroup,
  type ProjectCard,
} from "../../lib/coach";
import {
  createProject,
  getPeople,
  getProjects,
  getTasks,
  mergeProject,
  updateProject,
} from "../../lib/coachApi";
import { WidgetGrid, WidgetLink } from "../../components/coach/Widget";
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

/**
 * Every project as a card under its client: what is to do, what waits on
 * them, and the next few tasks. A card can be folded into another project or
 * archived from here.
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const t = useCoachTheme();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [board, setBoard] = useState<ClientGroup[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The card whose "merge into" choices are showing. */
  const [merging, setMerging] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ projects: all }, tasks, people] = await Promise.all([
        getProjects(),
        // The cards still show if tasks or names can't be read.
        getTasks().catch(() => null),
        getPeople().catch(() => null),
      ]);
      setProjects(all);
      setBoard(projectBoard(all, tasks?.tasks ?? [], people?.people ?? []));
      setFailed(null);
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

  const open = (id: string) => router.push(`/coach/project/${id}` as never);
  const today = new Date().toLocaleDateString("en-CA");
  const active = (projects ?? []).filter((p) => p.active);
  const archived = (projects ?? []).filter((p) => !p.active);

  /** Run a change to the list, then read it again. */
  const change = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setMerging(null);
      await load();
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { project } = await createProject(title);
      setName("");
      open(project.id);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const small = { fontFamily: FONT, fontSize: 12, color: t.muted } as const;

  const card = (project: ProjectCard) => {
    const others = active.filter((p) => p.id !== project.id);
    const quiet = project.todo + project.waiting === 0;
    return (
      <View
        key={project.id}
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 300,
          maxWidth: "100%",
          borderWidth: LINE,
          borderColor: t.line,
          borderRadius: 10,
          backgroundColor: quiet ? "transparent" : t.card,
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 10,
        }}
      >
        <Pressable
          onPress={() => open(project.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${project.name}`}
        >
          <Text style={{ fontFamily: FONT, fontSize: 17, fontWeight: "700", color: t.text }}>
            {project.name}
          </Text>
          {project.state ? <Text style={{ ...small, marginTop: 2 }}>{project.state}</Text> : null}
          <View style={{ flexDirection: "row", gap: 14, marginTop: 8 }}>
            {(
              [
                [project.todo, "to do"],
                [project.waiting, "waiting on them"],
              ] as const
            ).map(([count, label]) => (
              <Text key={label} style={small}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: count > 0 ? (label === "to do" ? t.accent : t.text) : t.muted,
                  }}
                >
                  {count}
                </Text>
                {` ${label}`}
              </Text>
            ))}
          </View>
        </Pressable>

        <View style={{ marginTop: 6 }}>
          {project.next.map((task) => {
            const due = taskDue(task.dueDate, today);
            return (
              <Row
                key={task.id}
                title={task.title}
                right={due?.text}
                rightColor={due?.late ? t.due : undefined}
                onPress={() => router.push(`/coach/task/${task.id}` as never)}
              />
            );
          })}
          {project.todo > project.next.length ? (
            <Text style={{ ...small, marginTop: 8 }}>
              {`${project.todo - project.next.length} more`}
            </Text>
          ) : null}
          {quiet ? <Text style={{ ...small, marginTop: 4 }}>Nothing open.</Text> : null}
        </View>

        {merging === project.id ? (
          <View style={{ marginTop: 10 }}>
            <Text style={small}>Move everything in this project into:</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {others.map((other) => (
                <QuickButton
                  key={other.id}
                  label={other.name}
                  disabled={busy}
                  onPress={() => change(() => mergeProject(project.id, other.id))}
                />
              ))}
              <QuickButton label="Cancel" disabled={busy} onPress={() => setMerging(null)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
            <WidgetLink label="Open" onPress={() => open(project.id)} />
            {others.length > 0 ? (
              <WidgetLink label="Merge into…" onPress={() => setMerging(project.id)} />
            ) : null}
            <WidgetLink
              label="Archive"
              onPress={() => change(() => updateProject(project.id, { active: false }))}
            />
          </View>
        )}
      </View>
    );
  };

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
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
      >
        {failed ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>{failed}</Body>
          </View>
        ) : null}
        {note ? (
          <View style={{ marginTop: 12 }}>
            <Body muted>{note}</Body>
          </View>
        ) : null}

        {projects && active.length === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>No projects yet. Add one below.</Body>
          </View>
        ) : null}

        {board.map((group) => (
          <View key={group.clientId ?? "none"}>
            <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
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
            <View style={{ marginTop: 8 }}>
              <WidgetGrid>{group.projects.map(card)}</WidgetGrid>
            </View>
          </View>
        ))}

        {archived.length > 0 ? (
          <>
            <View style={{ marginTop: 22 }}>
              <WidgetLink
                label={showArchived ? "Hide archived" : `Show ${archived.length} archived`}
                onPress={() => setShowArchived((on) => !on)}
              />
            </View>
            {showArchived
              ? archived.map((p) => (
                  <Row
                    key={p.id}
                    title={p.name}
                    right="Restore"
                    dim
                    onPress={() => change(() => updateProject(p.id, { active: true }))}
                  />
                ))
              : null}
          </>
        ) : null}

        {projects ? (
          <>
            <SectionLabel>Add a project</SectionLabel>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
              <TextInput
                value={name}
                onChangeText={setName}
                onSubmitEditing={() => void add()}
                placeholder="Name"
                placeholderTextColor={t.muted}
                returnKeyType="done"
                accessibilityLabel="New project name"
                style={{
                  flex: 1,
                  fontFamily: FONT,
                  fontSize: 15,
                  color: t.text,
                  borderWidth: LINE,
                  borderColor: t.line,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              />
              <QuickButton label="Add" disabled={busy || !name.trim()} onPress={add} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
