import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { InboundMessage, Project } from "@cliphy/shared";
import {
  mergeThread,
  messageWent,
  taskTitleFrom,
  threadDays,
  threadFilter,
  type ThreadFilter,
  errorText,
} from "../../../lib/coach";
import {
  addTaskMessages,
  createBatch,
  createTask,
  getPeople,
  getProjects,
  getThread,
  setMessagesHandled,
} from "../../../lib/coachApi";
import { MessageRow } from "../../../components/coach/MessageRow";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  SectionLabel,
  useCoachTheme,
} from "../../../components/coach/ui";

const FILTERS: [ThreadFilter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["done", "Done"],
];

/**
 * Everything one person has sent and been sent, oldest first. Tap messages to
 * select them, then tick them off as dealt with, make a task from them, or
 * put them in a batch.
 */
export default function ThreadScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId?: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [name, setName] = useState("Texts");
  const [messages, setMessages] = useState<InboundMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Making a task from the selection: its title, and which project it joins.
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskProject, setTaskProject] = useState<string | null>(projectId ?? null);
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(false);

  useEffect(() => {
    getPeople()
      .then((r) => setName(r.people.find((p) => p.id === id)?.name ?? "Texts"))
      .catch(() => {});
    getProjects()
      .then((r) => {
        // This person's projects; with exactly one, a new task goes there.
        const theirs = r.projects.filter((p) => p.active && p.personIds.includes(id));
        setProjects(theirs);
        setTaskProject((chosen) => chosen ?? (theirs.length === 1 ? theirs[0].id : null));
      })
      .catch(() => {});
    getThread(id)
      .then((r) => {
        setMessages(r.messages);
        setHasMore(r.hasMore);
      })
      .catch((err) => setNote(errorText(err)));
  }, [id]);

  const shown = useMemo(() => threadFilter(messages ?? [], filter), [messages, filter]);
  const days = useMemo(() => threadDays(shown), [shown]);
  const open = useMemo(() => threadFilter(messages ?? [], "open"), [messages]);
  const picked = useMemo(
    () => (messages ?? []).filter((m) => selected.has(m.id)),
    [messages, selected],
  );
  // With only ticked messages picked, the one useful thing is to untick them.
  const unticking = picked.length > 0 && picked.every((m) => m.handledAt);

  const toggle = (messageId: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (!next.delete(messageId)) next.add(messageId);
      return next;
    });

  const earlier = useCallback(async () => {
    const oldest = messages?.[messages.length - 1];
    if (!oldest || busy) return;
    setBusy(true);
    try {
      const page = await getThread(id, oldest.sentAt);
      setMessages((old) => mergeThread(old ?? [], page.messages));
      setHasMore(page.hasMore);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [busy, id, messages]);

  const tick = async () => {
    if (busy || picked.length === 0) return;
    const handled = !unticking;
    const ids = picked.map((m) => m.id);
    const at = handled ? new Date().toISOString() : null;
    setBusy(true);
    setNote(null);
    // Shown at once; put back if the server says no.
    const before = messages;
    setMessages((old) =>
      (old ?? []).map((m) => (selected.has(m.id) ? { ...m, handledAt: at } : m)),
    );
    setSelected(new Set());
    try {
      await setMessagesHandled(id, ids, handled);
    } catch (err) {
      setMessages(before);
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const batch = async () => {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const { batch: made } = await createBatch({
        personId: id,
        ...(projectId ? { projectId } : {}),
        requestIds: [],
        taskIds: [],
        messageIds: picked.map((m) => m.id),
      });
      setSelected(new Set());
      router.push(`/coach/batch/${made.id}` as never);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** One task for the selected messages, with those messages pulled into it. */
  const makeTask = async () => {
    const title = (taskTitle ?? "").trim();
    if (busy || !title || picked.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const { task } = await createTask({
        kind: "do",
        title,
        ...(taskProject ? { projectId: taskProject } : {}),
      });
      try {
        await addTaskMessages(
          task.id,
          picked.map((m) => m.id),
        );
      } catch {
        // The task exists; its messages can be pulled in from the task itself.
      }
      setSelected(new Set());
      setTaskTitle(null);
      router.push(`/coach/task/${task.id}` as never);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const small = { fontFamily: FONT, fontSize: 12, color: t.muted } as const;

  return (
    <Page
      title={name}
      sub={messages ? `${open.length} open${hasMore ? "" : ` of ${messages.length}`}` : undefined}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.hairline,
        }}
      >
        {FILTERS.map(([key, label]) => (
          <QuickButton
            key={key}
            label={label}
            chosen={filter === key}
            onPress={() => setFilter(key)}
          />
        ))}
        <View style={{ flex: 1 }} />
        {open.length > 0 ? (
          <Text
            onPress={() => setSelected(new Set(open.map((m) => m.id)))}
            accessibilityRole="button"
            style={{ ...small, fontWeight: "700", color: t.text, textDecorationLine: "underline" }}
          >
            Select open
          </Text>
        ) : null}
      </View>

      <ScrollView
        ref={scroll}
        // A thread opens at its newest message, like Messages does.
        onContentSizeChange={() => {
          if (atBottom.current || !messages) return;
          atBottom.current = true;
          scroll.current?.scrollToEnd({ animated: false });
        }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      >
        {hasMore ? (
          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <QuickButton
              label={busy ? "Loading" : "Earlier messages"}
              disabled={busy}
              onPress={earlier}
            />
          </View>
        ) : null}

        {messages && shown.length === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>
              {filter === "open"
                ? "Nothing open. Everything they sent is dealt with."
                : filter === "done"
                  ? "Nothing ticked off yet."
                  : "No messages captured yet."}
            </Body>
          </View>
        ) : null}

        {days.map((day) => (
          <View key={day.day}>
            <SectionLabel>{day.day}</SectionLabel>
            {day.messages.map((message) => {
              const went = messageWent(message);
              return (
                <View
                  key={message.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    opacity: message.handledAt ? 0.5 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <MessageRow
                      message={message}
                      checked={selected.has(message.id)}
                      onPress={() => toggle(message.id)}
                    />
                  </View>
                  {went ? (
                    <Text
                      onPress={went.path ? () => router.push(went.path as never) : undefined}
                      accessibilityRole={went.path ? "link" : undefined}
                      style={{
                        ...small,
                        fontWeight: "700",
                        marginTop: 13,
                        marginLeft: 8,
                        color: went.path ? t.accent : t.muted,
                      }}
                    >
                      {went.path ? `${went.label} ›` : went.label}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {note ? (
        <Text style={{ ...small, paddingHorizontal: 16, paddingVertical: 6 }}>{note}</Text>
      ) : null}

      {picked.length > 0 ? (
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
          {taskTitle !== null ? (
            <>
              <TextInput
                value={taskTitle}
                onChangeText={setTaskTitle}
                onSubmitEditing={() => void makeTask()}
                autoFocus
                placeholder="What needs doing"
                placeholderTextColor={t.muted}
                returnKeyType="done"
                accessibilityLabel="Task title"
                style={{
                  fontFamily: FONT,
                  fontSize: 15,
                  color: t.text,
                  borderWidth: LINE,
                  borderColor: t.line,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                }}
              />
              {projects.length > 1 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {projects.map((p) => (
                    <QuickButton
                      key={p.id}
                      label={p.name}
                      chosen={taskProject === p.id}
                      onPress={() => setTaskProject(taskProject === p.id ? null : p.id)}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: FONT, fontSize: 13, fontWeight: "700", color: t.text }}>
              {picked.length} selected
            </Text>
            <View style={{ flex: 1 }} />
            {taskTitle !== null ? (
              <>
                <QuickButton
                  label={busy ? "Adding" : "Add task"}
                  primary
                  disabled={busy || !taskTitle.trim()}
                  onPress={makeTask}
                />
                <QuickButton label="Back" disabled={busy} onPress={() => setTaskTitle(null)} />
              </>
            ) : (
              <>
                <QuickButton
                  label={unticking ? "Untick" : "Tick off"}
                  primary
                  disabled={busy}
                  onPress={tick}
                />
                <QuickButton
                  label="Task"
                  disabled={busy}
                  onPress={() => setTaskTitle(taskTitleFrom(picked))}
                />
                <QuickButton label="Batch" disabled={busy} onPress={batch} />
                <Pressable
                  onPress={() => setSelected(new Set())}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={{ ...small, textDecorationLine: "underline" }}>Clear</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ) : null}
    </Page>
  );
}
