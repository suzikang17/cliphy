import { useCallback, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { projectRows, type ProjectRow, errorText } from "../../lib/coach";
import { createProject, getPeople, getProjects, getUpNext } from "../../lib/coachApi";
import {
  ACCENT,
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../components/coach/ui";

/** Every project, the ones with open work first. Tap one for its tasks, batches and trail. */
export default function ProjectsScreen() {
  const router = useRouter();
  const t = useCoachTheme();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Read again on return: tasks get done and projects get added elsewhere.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([
        getProjects(),
        // The list still shows if the counts or names can't be read.
        getUpNext().catch(() => null),
        getPeople().catch(() => null),
      ])
        .then(([{ projects }, up, people]) => {
          if (!live) return;
          setRows(projectRows(projects, up?.byProject ?? [], people?.people ?? []));
          setFailed(null);
        })
        .catch((err) => live && setFailed(errorText(err)));
      return () => {
        live = false;
      };
    }, []),
  );

  const open = (id: string) => router.push(`/coach/project/${id}` as never);

  const add = async () => {
    const title = name.trim();
    if (!title || adding) return;
    setAdding(true);
    setNote(null);
    try {
      const { project } = await createProject(title);
      setName("");
      open(project.id);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setAdding(false);
    }
  };

  const active = rows?.filter((r) => r.active) ?? [];
  const inactive = rows?.filter((r) => !r.active) ?? [];
  const list = (items: ProjectRow[]) =>
    items.map((r) => (
      <Row
        key={r.id}
        title={r.name}
        detail={r.detail}
        right={r.open > 0 ? String(r.open) : undefined}
        rightColor={ACCENT}
        dim={!r.active}
        onPress={() => open(r.id)}
      />
    ));

  return (
    <Page root title="Projects" sub={rows ? `${active.length} active` : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
      >
        {failed ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>{failed}</Body>
          </View>
        ) : null}

        {rows && rows.length === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>No projects yet. Add one below.</Body>
          </View>
        ) : null}

        {list(active)}

        {inactive.length > 0 ? (
          <>
            <SectionLabel>Not active</SectionLabel>
            {list(inactive)}
          </>
        ) : null}

        {rows ? (
          <>
            <SectionLabel>Texts</SectionLabel>
            <Row
              title="Everyone's threads"
              detail="Tick messages off or batch them"
              onPress={() => router.push("/coach/threads" as never)}
            />
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
              <QuickButton label="Add" disabled={adding || !name.trim()} onPress={add} />
            </View>
            {note ? (
              <View style={{ marginTop: 8 }}>
                <Body muted>{note}</Body>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
