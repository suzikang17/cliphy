import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { CoachTask, Person } from "@cliphy/shared";
import { smsUrl } from "../../../lib/coach";
import { getPeople, getTasks, markTaskSent, updateTask } from "../../../lib/coachApi";
import { refreshCoach, refreshStrip } from "../../../lib/coachStore";
import {
  ACCENT,
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  SectionLabel,
  useCoachTheme,
} from "../../../components/coach/ui";

const KIND_LABEL = { do: "To do", tell: "To tell", ask: "To ask", get: "To get" } as const;

/** A task with its kit: everything needed to do it, and the one button that does. */
export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [task, setTask] = useState<CoachTask | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ tasks }, { people }] = await Promise.all([getTasks(), getPeople()]);
      const found = tasks.find((x) => x.id === id) ?? null;
      setTask(found);
      setMissing(!found);
      setPerson(people.find((p) => p.id === found?.withPersonId) ?? null);
    } catch {
      setNote("Couldn't load this.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const finish = () => {
    void refreshCoach();
    void refreshStrip();
    router.back();
  };

  const run = async (fn: () => Promise<unknown>, thenLeave = true) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (thenLeave) finish();
      else await load();
    } catch {
      setNote("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!task) return;
    const draft = task.kit.draft ?? "";
    const url = smsUrl(person?.handles[0], draft, Platform.OS === "ios" ? "ios" : "android");
    if (!url) {
      // No number to text: hand over the words, and leave the task open until
      // the user says it went out.
      await Clipboard.setStringAsync(draft);
      setNote("Copied. Send it, then tap Sent.");
      return;
    }
    try {
      await Linking.openURL(url);
      await run(() => markTaskSent(task.id));
    } catch {
      await Clipboard.setStringAsync(draft);
      setNote("Couldn't open Messages. Copied instead.");
    }
  };

  const toggle = (index: number) => {
    if (!task) return;
    const checklist = task.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c));
    setTask({ ...task, checklist });
    void run(() => updateTask(task.id, { checklist }), false);
  };

  const kit = task?.kit ?? {};
  const waiting = task?.state === "waiting";

  return (
    <Page title={task ? KIND_LABEL[task.kind] : "Task"} sub={person?.name}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
        {missing ? <Body muted>This one is finished.</Body> : null}

        {task ? (
          <>
            <Text
              style={{
                fontFamily: FONT,
                fontSize: 20,
                fontWeight: "700",
                color: t.text,
                marginTop: 16,
              }}
            >
              {task.title}
            </Text>
            {task.dueDate ? (
              <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 2 }}>
                Due {task.dueDate}
                {task.dueTime ? ` ${task.dueTime}` : ""}
              </Text>
            ) : null}
            {task.blocked ? (
              <Text
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: "700",
                  color: t.due,
                  marginTop: 6,
                }}
              >
                Waiting on an earlier step
              </Text>
            ) : null}
            {waiting ? (
              <Text
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: "700",
                  color: t.muted,
                  marginTop: 6,
                }}
              >
                {person ? `Waiting on ${person.name}` : "Waiting on a reply"}
              </Text>
            ) : null}

            {kit.target ? (
              <>
                <SectionLabel>Where</SectionLabel>
                <View style={{ marginTop: 8 }}>
                  <Body>{kit.target}</Body>
                </View>
              </>
            ) : null}

            {kit.materials?.length ? (
              <>
                <SectionLabel>You'll need</SectionLabel>
                {kit.materials.map((m) => (
                  <View key={m} style={{ marginTop: 8 }}>
                    <Body>{m}</Body>
                  </View>
                ))}
              </>
            ) : null}

            {kit.draft ? (
              <>
                <SectionLabel>Draft</SectionLabel>
                <View
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderWidth: LINE,
                    borderColor: t.line,
                    borderRadius: 10,
                  }}
                >
                  <Body>{kit.draft}</Body>
                </View>
              </>
            ) : null}

            {kit.doneWhen ? (
              <>
                <SectionLabel>Done when</SectionLabel>
                <View style={{ marginTop: 8 }}>
                  <Body>{kit.doneWhen}</Body>
                </View>
              </>
            ) : null}

            {task.kind === "get" && task.place ? (
              <>
                <SectionLabel>Place</SectionLabel>
                <View style={{ marginTop: 8 }}>
                  <Body>{task.place}</Body>
                </View>
              </>
            ) : null}

            {task.checklist.length > 0 ? (
              <>
                <SectionLabel>List</SectionLabel>
                {task.checklist.map((c, i) => (
                  <Pressable
                    key={`${c.text}-${i}`}
                    onPress={() => toggle(i)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: c.done }}
                    accessibilityLabel={c.text}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingVertical: 11,
                      borderBottomWidth: 1,
                      borderBottomColor: t.hairline,
                    }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        borderWidth: LINE,
                        borderColor: t.line,
                        backgroundColor: c.done ? ACCENT : "transparent",
                      }}
                    />
                    <Text
                      style={{
                        fontFamily: FONT,
                        fontSize: 15,
                        color: c.done ? t.muted : t.text,
                        textDecorationLine: c.done ? "line-through" : "none",
                      }}
                    >
                      {c.text}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {note ? (
              <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 16 }}>
                {note}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
              {task.kind === "do" ? (
                <QuickButton
                  label="Done"
                  primary
                  disabled={busy || task.blocked}
                  onPress={() => run(() => updateTask(task.id, { state: "done" }))}
                />
              ) : null}
              {(task.kind === "tell" || task.kind === "ask") && !waiting ? (
                <>
                  <QuickButton
                    label="Send"
                    primary
                    disabled={busy || task.blocked}
                    onPress={send}
                  />
                  <QuickButton
                    label="Sent"
                    disabled={busy || task.blocked}
                    onPress={() => run(() => markTaskSent(task.id))}
                  />
                </>
              ) : null}
              {waiting ? (
                <QuickButton
                  label="Close"
                  primary
                  disabled={busy}
                  onPress={() => run(() => updateTask(task.id, { state: "done" }))}
                />
              ) : null}
              {task.kind === "get" ? (
                <QuickButton
                  label="Got it"
                  primary
                  disabled={busy || task.blocked}
                  onPress={() => run(() => updateTask(task.id, { state: "done" }))}
                />
              ) : null}
              <QuickButton
                label="Drop"
                disabled={busy}
                onPress={() => run(() => updateTask(task.id, { state: "dropped" }))}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
