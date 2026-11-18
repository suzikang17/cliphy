import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Digest, DigestItem, Project } from "@cliphy/shared";
import { digestCounts, digestKey, digestState, errorText, shortDay } from "../../../lib/coach";
import {
  addTaskMessages,
  createTask,
  getDigest,
  getPeople,
  getProjects,
} from "../../../lib/coachApi";
import { Tick } from "../../../components/coach/MessageRow";
import { Body, FONT, LINE, Page, QuickButton, useCoachTheme } from "../../../components/coach/ui";

const RANGES: [number, string][] = [
  [7, "7 days"],
  [14, "14 days"],
  [30, "30 days"],
];

/**
 * Everything one person asked for over the last days, pulled out of their
 * texts: grouped, each with the detail needed to do it and their own words.
 * Pick the ones that are real and turn them into tasks.
 */
export default function DigestScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId?: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [name, setName] = useState("Requests");
  const [days, setDays] = useState(7);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [target, setTarget] = useState<string | null>(projectId ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Requests turned into tasks here, by key, with the task each became. */
  const [made, setMade] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    getPeople()
      .then((r) => setName(r.people.find((p) => p.id === id)?.name ?? "Requests"))
      .catch(() => {});
    getProjects()
      .then((r) => {
        const theirs = r.projects.filter((p) => p.active && p.personIds.includes(id));
        setProjects(theirs);
        setTarget((chosen) => chosen ?? (theirs.length === 1 ? theirs[0].id : null));
      })
      .catch(() => {});
  }, [id]);

  const read = useCallback(
    async (range: number) => {
      setDays(range);
      setReading(true);
      setFailed(null);
      setNote(null);
      setSelected(new Set());
      setMade({});
      try {
        const found = await getDigest(id, range);
        setDigest(found);
        // Everything still open starts selected: the usual next step is "add them all".
        setSelected(
          new Set(
            found.groups.flatMap((g, gi) =>
              g.items.flatMap((item, ii) =>
                digestState(item) === "open" ? [digestKey(gi, ii)] : [],
              ),
            ),
          ),
        );
      } catch (err) {
        setDigest(null);
        setFailed(errorText(err));
      } finally {
        setReading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void read(7);
  }, [read]);

  const counts = useMemo(() => digestCounts(digest?.groups ?? []), [digest]);
  const toggle = (key: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** One task per selected request, with the texts it came from pulled in. */
  const addTasks = async () => {
    if (!digest || busy || selected.size === 0) return;
    setBusy(true);
    setNote(null);
    const done: Record<string, string> = {};
    try {
      for (const [gi, group] of digest.groups.entries()) {
        for (const [ii, item] of group.items.entries()) {
          const key = digestKey(gi, ii);
          if (!selected.has(key) || made[key]) continue;
          const project = item.projectId ?? target;
          const { task } = await createTask({
            kind: "do",
            title: item.title,
            ...(project ? { projectId: project } : {}),
            ...(item.dueDate ? { dueDate: item.dueDate } : {}),
            ...(item.detail ? { kit: { doneWhen: item.detail } } : {}),
          });
          done[key] = task.id;
          await addTaskMessages(task.id, [...new Set(item.quotes.map((q) => q.messageId))]).catch(
            () => {},
          );
        }
      }
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setMade((old) => ({ ...old, ...done }));
      setSelected((old) => new Set([...old].filter((key) => !done[key])));
      setBusy(false);
    }
  };

  const small = { fontFamily: FONT, fontSize: 12, color: t.muted } as const;

  const row = (item: DigestItem, key: string) => {
    const taskId = made[key] ?? item.taskId;
    const state = taskId ? "task" : digestState(item);
    return (
      <View
        key={key}
        style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.hairline }}
      >
        <View style={{ flexDirection: "row", gap: 12 }}>
          {state === "task" ? (
            <View style={{ width: 22 }} />
          ) : (
            <Pressable
              onPress={() => toggle(key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected.has(key) }}
              accessibilityLabel={item.title}
              hitSlop={8}
            >
              <Tick checked={selected.has(key)} />
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
              <Text
                style={{
                  flex: 1,
                  fontFamily: FONT,
                  fontSize: 16,
                  lineHeight: 22,
                  fontWeight: "700",
                  color: t.text,
                }}
              >
                {item.title}
              </Text>
              {state === "task" ? (
                <Text
                  onPress={() => router.push(`/coach/task/${taskId}` as never)}
                  accessibilityRole="link"
                  style={{ ...small, fontWeight: "700", color: t.accent }}
                >
                  Task ›
                </Text>
              ) : state === "answered" ? (
                <Text style={{ ...small, fontWeight: "700" }}>You said done</Text>
              ) : item.dueDate ? (
                <Text style={{ ...small, fontWeight: "700", color: t.due }}>
                  {`By ${shortDay(`${item.dueDate}T12:00:00`)}`}
                </Text>
              ) : null}
            </View>
            {item.detail ? (
              <Text
                style={{
                  fontFamily: FONT,
                  fontSize: 14,
                  lineHeight: 20,
                  color: t.text,
                  marginTop: 3,
                }}
              >
                {item.detail}
              </Text>
            ) : null}

            {/* Their own words, exactly as sent, with the pictures that came with them. */}
            {item.quotes.map((quote, index) => {
              const pictures = quote.attachments.filter((a) => a.url);
              return (
                <View
                  key={`${quote.messageId}:${index}`}
                  style={{
                    marginTop: 10,
                    paddingLeft: 12,
                    borderLeftWidth: 3,
                    borderLeftColor: t.line,
                  }}
                >
                  {quote.text ? (
                    <Text
                      selectable
                      style={{ fontFamily: FONT, fontSize: 14, lineHeight: 20, color: t.muted }}
                    >
                      {quote.text}
                    </Text>
                  ) : null}
                  {pictures.length > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {pictures.map((a) => (
                        <Image
                          key={a.storagePath}
                          source={{ uri: a.url as string }}
                          accessibilityLabel="Picture she sent"
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: 6,
                            borderWidth: LINE,
                            borderColor: t.line,
                            backgroundColor: t.hairline,
                          }}
                        />
                      ))}
                    </View>
                  ) : null}
                  {quote.sentAt ? (
                    <Text style={{ ...small, fontSize: 11, marginTop: 4 }}>
                      {shortDay(quote.sentAt)}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  return (
    <Page
      title={`${name}: requests`}
      sub={
        digest && !reading
          ? `${counts.found} found in ${digest.messageCount} texts · ${counts.open} need a task`
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
        {RANGES.map(([range, label]) => (
          <QuickButton
            key={range}
            label={label}
            chosen={days === range}
            disabled={reading}
            onPress={() => void read(range)}
          />
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }}>
        {reading ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>{`Reading the last ${days} days.`}</Body>
          </View>
        ) : null}
        {failed ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>{failed}</Body>
          </View>
        ) : null}
        {digest && !reading && counts.found === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>
              {digest.messageCount === 0
                ? `No texts in the last ${days} days.`
                : "Nothing asked in these texts."}
            </Body>
          </View>
        ) : null}

        {!reading
          ? digest?.groups.map((group, gi) => (
              <View key={`${gi}:${group.name}`}>
                <Text
                  accessibilityRole="header"
                  style={{
                    fontFamily: FONT,
                    fontSize: 18,
                    fontWeight: "700",
                    color: t.text,
                    marginTop: 26,
                  }}
                >
                  {group.name}
                </Text>
                {group.items.map((item, ii) => row(item, digestKey(gi, ii)))}
              </View>
            ))
          : null}
      </ScrollView>

      {note ? (
        <Text style={{ ...small, paddingHorizontal: 16, paddingVertical: 6 }}>{note}</Text>
      ) : null}

      {digest && !reading && counts.found > 0 ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderTopWidth: LINE,
            borderTopColor: t.line,
            backgroundColor: t.bg,
            gap: 8,
          }}
        >
          {projects.length > 1 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Text style={small}>Tasks go in</Text>
              {projects.map((p) => (
                <QuickButton
                  key={p.id}
                  label={p.name}
                  chosen={target === p.id}
                  onPress={() => setTarget(target === p.id ? null : p.id)}
                />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{ flex: 1, fontFamily: FONT, fontSize: 13, fontWeight: "700", color: t.text }}
            >
              {`${selected.size} selected`}
            </Text>
            <QuickButton
              label={
                busy ? "Adding" : `Add ${selected.size} ${selected.size === 1 ? "task" : "tasks"}`
              }
              primary
              disabled={busy || selected.size === 0}
              onPress={addTasks}
            />
          </View>
        </View>
      ) : null}
    </Page>
  );
}
