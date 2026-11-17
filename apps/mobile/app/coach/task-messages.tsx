import { errorText } from "../../lib/coach";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { InboundMessage, Person } from "@cliphy/shared";
import {
  addTaskMessages,
  getPeople,
  getPersonMessages,
  getProjects,
  getTaskMessages,
  getTasks,
} from "../../lib/coachApi";
import { MessageRow } from "../../components/coach/MessageRow";
import { Body, FONT, Page, QuickButton, useCoachTheme } from "../../components/coach/ui";

/** Pick the texts that belong to a task. */
export default function TaskMessagesScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboundMessage[] | null>(null);
  const [already, setAlready] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Whose messages: the person the task is with, else the project's people, else anyone.
  useEffect(() => {
    Promise.all([getTasks(), getPeople(), getProjects(), getTaskMessages(taskId)])
      .then(([{ tasks }, all, { projects }, linked]) => {
        const task = tasks.find((x) => x.id === taskId);
        const project = projects.find((p) => p.id === task?.projectId);
        const ids = task?.withPersonId ? [task.withPersonId] : (project?.personIds ?? []);
        const offered = all.people.filter((p) => ids.includes(p.id));
        const list = offered.length > 0 ? offered : all.people;
        setPeople(list);
        setPersonId(list[0]?.id ?? null);
        setAlready(new Set(linked.messages.map((m) => m.id)));
        if (list.length === 0) setMessages([]);
      })
      .catch((err) => setNote(errorText(err)));
  }, [taskId]);

  useEffect(() => {
    if (!personId) return;
    setMessages(null);
    getPersonMessages(personId)
      .then((r) => setMessages(r.messages))
      .catch((err) => setNote(errorText(err)));
  }, [personId]);

  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    if (busy || picked.size === 0) return;
    setBusy(true);
    try {
      await addTaskMessages(taskId, [...picked]);
      router.back();
    } catch (err) {
      setNote(errorText(err));
      setBusy(false);
    }
  };

  const shown = (messages ?? []).filter((m) => !already.has(m.id));

  return (
    <Page title="Add messages" sub={people.find((p) => p.id === personId)?.name}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}>
        {people.length > 1 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {people.map((p) => (
              <QuickButton
                key={p.id}
                label={p.name}
                chosen={p.id === personId}
                onPress={() => setPersonId(p.id)}
              />
            ))}
          </View>
        ) : null}

        {messages && shown.length === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>No messages to add.</Body>
          </View>
        ) : null}
        <View style={{ marginTop: 8 }}>
          {shown.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              checked={picked.has(m.id)}
              onPress={() => toggle(m.id)}
            />
          ))}
        </View>

        {note ? (
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 16 }}>
            {note}
          </Text>
        ) : null}
      </ScrollView>

      {shown.length > 0 ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 30,
            backgroundColor: t.bg,
            borderTopWidth: 1,
            borderTopColor: t.hairline,
          }}
        >
          <QuickButton
            label={picked.size > 0 ? `Add ${picked.size}` : "Add"}
            primary
            disabled={busy || picked.size === 0}
            onPress={add}
          />
        </View>
      ) : null}
    </Page>
  );
}
