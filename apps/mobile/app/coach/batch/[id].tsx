import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { BatchItem, BatchItemState, CoachBatch, Person } from "@cliphy/shared";
import { batchLine, smsUrl } from "../../../lib/coach";
import {
  deleteBatch,
  getBatch,
  getPeople,
  markBatchSent,
  saveBatchSummary,
  updateBatchItem,
  writeBatchSummary,
} from "../../../lib/coachApi";
import { MessageRow, Tick } from "../../../components/coach/MessageRow";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  SectionLabel,
  useCoachTheme,
} from "../../../components/coach/ui";

/** A batch: check each thing against what was asked, then write and send the summary. */
export default function BatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [batch, setBatch] = useState<CoachBatch | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [found, { people }] = await Promise.all([getBatch(id), getPeople()]);
      setBatch(found.batch);
      setItems(found.items);
      setDraft(found.batch.summary ?? "");
      setPerson(people.find((p) => p.id === found.batch.personId) ?? null);
    } catch {
      setNote("Couldn't load this.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sent = batch?.status === "sent";
  const unchecked = items.filter((i) => i.state === "unchecked").length;

  /** Change one item here first, then on the server. Two quick ticks must both stick. */
  const change = (item: BatchItem, values: { state?: BatchItemState; note?: string | null }) => {
    if (sent) return;
    setItems((old) => old.map((i) => (i.id === item.id ? { ...i, ...values } : i)));
    updateBatchItem(id, item.id, values).catch(() => setNote("Couldn't save that."));
  };

  const act = async (fn: () => Promise<{ batch: CoachBatch }>, failed: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { batch: next } = await fn();
      setBatch(next);
      setDraft(next.summary ?? "");
    } catch (err) {
      setNote(err instanceof Error && err.message ? err.message : failed);
    } finally {
      setBusy(false);
    }
  };

  /** Keep an edit to the summary when the box is left. */
  const keep = async () => {
    const text = draft.trim();
    if (!batch || sent || !text || text === batch.summary) return;
    try {
      const { batch: next } = await saveBatchSummary(id, text);
      setBatch(next);
    } catch {
      setNote("Couldn't save your edit.");
    }
  };

  const send = async () => {
    await keep();
    const text = draft.trim();
    const url = smsUrl(person?.handles[0], text, Platform.OS === "ios" ? "ios" : "android");
    if (!url) {
      await Clipboard.setStringAsync(text);
      setNote("Copied. Send it, then tap Sent.");
      return;
    }
    try {
      await Linking.openURL(url);
      // Messages opening is not the message being sent. The Mac marks it sent
      // when it sees it go; otherwise she taps Sent.
      setNote("Sent it? Tap Sent.");
    } catch {
      await Clipboard.setStringAsync(text);
      setNote("Couldn't open Messages. Copied instead.");
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteBatch(id);
      router.back();
    } catch {
      setNote("That didn't work. Try again.");
      setBusy(false);
    }
  };

  const small = { fontFamily: FONT, fontSize: 12, color: t.muted } as const;
  const box = {
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 21,
    color: t.text,
    borderWidth: LINE,
    borderColor: t.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  } as const;

  return (
    <Page
      title="Batch"
      sub={
        batch
          ? `${person?.name ? `${person.name} · ` : ""}${batchLine({ ...batch, uncheckedCount: unchecked })}`
          : undefined
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
      >
        {!batch && note ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>{note}</Body>
          </View>
        ) : null}

        {batch ? <SectionLabel>Check</SectionLabel> : null}
        {items.map((item) => {
          const done = item.state === "done";
          const carried = item.state === "not_done";
          return (
            <View
              key={item.id}
              style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.hairline }}
            >
              <Pressable
                onPress={() => change(item, { state: done ? "unchecked" : "done" })}
                disabled={sent}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={item.label}
                style={{ flexDirection: "row", gap: 12 }}
              >
                <Tick checked={done} crossed={carried} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: FONT,
                    fontSize: 15,
                    lineHeight: 21,
                    fontWeight: "500",
                    color: carried ? t.muted : t.text,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>

              <View style={{ marginLeft: 34 }}>
                {/* A message picked on its own is already the label. */}
                {item.messageId
                  ? (item.messages ?? [])
                      .filter((m) => m.attachments.length > 0)
                      .map((m) => <MessageRow key={m.id} message={{ ...m, text: "" }} compact />)
                  : (item.messages ?? []).map((m) => <MessageRow key={m.id} message={m} compact />)}

                {carried ? (
                  <TextInput
                    defaultValue={item.note ?? ""}
                    editable={!sent}
                    onEndEditing={(e) => change(item, { note: e.nativeEvent.text })}
                    placeholder="Why not?"
                    placeholderTextColor={t.muted}
                    accessibilityLabel="Why it is not done"
                    style={{ ...box, fontSize: 14 }}
                  />
                ) : null}
                {!sent ? (
                  <Text
                    onPress={() => change(item, { state: carried ? "unchecked" : "not_done" })}
                    accessibilityRole="button"
                    style={{ ...small, marginTop: 6, textDecorationLine: "underline" }}
                  >
                    {carried ? "Undo" : "Not done"}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}

        {batch ? (
          <>
            <SectionLabel>Summary</SectionLabel>
            {batch.summary ? (
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onBlur={() => void keep()}
                editable={!sent}
                multiline
                accessibilityLabel="Summary for the client"
                style={{ ...box, minHeight: 120, textAlignVertical: "top" }}
              />
            ) : (
              <View style={{ marginTop: 8 }}>
                <Body muted>
                  {unchecked > 0
                    ? "Check everything first. Then I'll write it."
                    : busy
                      ? "Writing."
                      : "Everything is checked."}
                </Body>
              </View>
            )}

            {note ? <Text style={{ ...small, marginTop: 12 }}>{note}</Text> : null}

            {!sent ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                {batch.summary ? (
                  <>
                    <QuickButton label="Send" primary disabled={busy} onPress={send} />
                    <QuickButton
                      label="Sent"
                      disabled={busy}
                      onPress={() => act(() => markBatchSent(id), "That didn't work. Try again.")}
                    />
                  </>
                ) : null}
                <QuickButton
                  label={batch.summary ? "Rewrite" : "Write summary"}
                  primary={!batch.summary}
                  disabled={busy || unchecked > 0}
                  onPress={() =>
                    act(() => writeBatchSummary(id), "Couldn't write the summary. Try again.")
                  }
                />
                <QuickButton label="Remove" disabled={busy} onPress={remove} />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
