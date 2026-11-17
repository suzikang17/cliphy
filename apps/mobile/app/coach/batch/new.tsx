import { errorText } from "../../../lib/coach";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { BatchCandidates } from "@cliphy/shared";
import { createBatch, getBatchCandidates } from "../../../lib/coachApi";
import { MessageRow, Tick } from "../../../components/coach/MessageRow";
import {
  Body,
  FONT,
  Page,
  QuickButton,
  SectionLabel,
  useCoachTheme,
} from "../../../components/coach/ui";

/** Pick the finished work that goes into a batch. */
export default function NewBatchScreen() {
  const { personId, projectId } = useLocalSearchParams<{ personId: string; projectId?: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [found, setFound] = useState<BatchCandidates | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBatchCandidates(personId, projectId)
      .then(setFound)
      .catch((err) => setNote(errorText(err)));
  }, [personId, projectId]);

  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const make = async () => {
    if (busy || !found || picked.size === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const ids = (list: { id: string }[]) => list.map((x) => x.id).filter((id) => picked.has(id));
      const { batch } = await createBatch({
        personId,
        projectId: projectId || undefined,
        requestIds: ids(found.requests),
        taskIds: ids(found.tasks),
        messageIds: ids(found.messages),
      });
      router.replace(`/coach/batch/${batch.id}` as never);
    } catch (err) {
      setNote(errorText(err));
      setBusy(false);
    }
  };

  const line = (id: string, title: string) => (
    <Pressable
      key={id}
      onPress={() => toggle(id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked.has(id) }}
      accessibilityLabel={title}
      style={{
        flexDirection: "row",
        gap: 12,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: t.hairline,
      }}
    >
      <Tick checked={picked.has(id)} />
      <Text style={{ flex: 1, fontFamily: FONT, fontSize: 15, lineHeight: 21, color: t.text }}>
        {title}
      </Text>
    </Pressable>
  );

  const empty = found && found.requests.length + found.tasks.length + found.messages.length === 0;

  return (
    <Page title="New batch" sub="Pick what's finished">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}>
        {empty ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>Nothing left to report.</Body>
          </View>
        ) : null}

        {found?.requests.length ? <SectionLabel>Requests</SectionLabel> : null}
        {found?.requests.map((r) => line(r.id, r.understood))}

        {found?.tasks.length ? <SectionLabel>Tasks you added</SectionLabel> : null}
        {found?.tasks.map((task) => line(task.id, task.title))}

        {found?.messages.length ? <SectionLabel>Other messages</SectionLabel> : null}
        {found?.messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            checked={picked.has(m.id)}
            onPress={() => toggle(m.id)}
          />
        ))}

        {note ? (
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 16 }}>
            {note}
          </Text>
        ) : null}
      </ScrollView>

      {found && !empty ? (
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
            label={picked.size > 0 ? `Batch ${picked.size}` : "Batch"}
            primary
            disabled={busy || picked.size === 0}
            onPress={make}
          />
        </View>
      ) : null}
    </Page>
  );
}
