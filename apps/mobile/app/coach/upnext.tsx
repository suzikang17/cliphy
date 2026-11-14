import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { UpNext, UpNextTask } from "@cliphy/shared";
import { dayParts } from "../../lib/coach";
import { getUpNext } from "../../lib/coachApi";
import {
  ACCENT,
  Body,
  FONT,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../components/coach/ui";

/** Everything on the plate: by date, or by project. Opened from the strip in Chat. */
export default function UpNextScreen() {
  const router = useRouter();
  const t = useCoachTheme();
  const [up, setUp] = useState<UpNext | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"date" | "project">("date");

  useFocusEffect(
    useCallback(() => {
      getUpNext()
        .then((u) => {
          setUp(u);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, []),
  );

  const open = (task: UpNextTask) => router.push(`/coach/task/${task.id}` as never);
  const today = new Date().toLocaleDateString("en-CA");

  const day = (date: string) => {
    const { num, dow } = dayParts(date);
    return (
      <View style={{ width: 34 }}>
        <Text
          style={{
            fontFamily: FONT,
            fontSize: 18,
            fontWeight: "700",
            lineHeight: 20,
            color: date === today ? ACCENT : t.text,
          }}
        >
          {num}
        </Text>
        <Text style={{ fontFamily: FONT, fontSize: 11, color: t.muted }}>{dow}</Text>
      </View>
    );
  };

  const rows = (
    tasks: UpNextTask[],
    left?: (task: UpNextTask) => React.ReactNode,
    right?: string,
    rightColor?: string,
  ) =>
    tasks.map((task) => (
      <Row
        key={task.id}
        title={task.title}
        detail={task.detail}
        left={left?.(task)}
        right={task.blocked ? "Waiting" : right}
        rightColor={task.blocked ? t.muted : rightColor}
        onPress={() => open(task)}
      />
    ));

  const sub = up
    ? `${up.strip.thisWeek} this week${up.waiting.length ? ` · ${up.waiting.length} waiting` : ""}`
    : undefined;

  return (
    <Page title="Up next" sub={sub}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <QuickButton label="By date" chosen={view === "date"} onPress={() => setView("date")} />
          <QuickButton
            label="By project"
            chosen={view === "project"}
            onPress={() => setView("project")}
          />
        </View>

        {failed ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>Couldn't load this.</Body>
          </View>
        ) : null}

        {up && view === "date" ? (
          <>
            {up.overdue.length > 0 ? (
              <>
                <SectionLabel>Overdue</SectionLabel>
                {rows(
                  up.overdue,
                  (task) => (task.dueDate ? day(task.dueDate) : null),
                  "Late",
                  t.due,
                )}
              </>
            ) : null}

            {up.thisWeek.length > 0 ? (
              <>
                <SectionLabel>This week</SectionLabel>
                {up.thisWeek.map((d) => rows(d.tasks, () => day(d.date)))}
              </>
            ) : null}

            {up.later.length > 0 ? (
              <>
                <SectionLabel>Later</SectionLabel>
                {rows(up.later, (task) => (task.dueDate ? day(task.dueDate) : null))}
              </>
            ) : null}

            {up.waiting.length > 0 ? (
              <>
                <SectionLabel>Waiting on others</SectionLabel>
                {rows(up.waiting)}
              </>
            ) : null}

            {up.errands.map((e) => (
              <View key={e.place}>
                <SectionLabel>{e.place}</SectionLabel>
                {rows(e.tasks)}
              </View>
            ))}

            {up.backBurner.count > 0 ? (
              <>
                <SectionLabel>{`Back burner · ${up.backBurner.count}`}</SectionLabel>
                <Row
                  title={
                    up.backBurner.titles.join(", ") +
                    (up.backBurner.count > up.backBurner.titles.length
                      ? `, +${up.backBurner.count - up.backBurner.titles.length}`
                      : "")
                  }
                />
              </>
            ) : null}

            {up.strip.thisWeek === 0 &&
            up.later.length === 0 &&
            up.waiting.length === 0 &&
            up.errands.length === 0 &&
            up.backBurner.count === 0 ? (
              <View style={{ marginTop: 20 }}>
                <Body muted>Nothing on your plate.</Body>
              </View>
            ) : null}
          </>
        ) : null}

        {up && view === "project" ? (
          up.byProject.length === 0 ? (
            <View style={{ marginTop: 20 }}>
              <Body muted>No projects yet.</Body>
            </View>
          ) : (
            <>
              <SectionLabel>Projects</SectionLabel>
              {up.byProject.map((p) => (
                <Row
                  key={p.projectId}
                  title={p.name}
                  detail={p.next ?? p.state ?? undefined}
                  right={p.open > 0 ? String(p.open) : undefined}
                  onPress={() => router.push(`/coach/project/${p.projectId}` as never)}
                />
              ))}
            </>
          )
        ) : null}
      </ScrollView>
    </Page>
  );
}
