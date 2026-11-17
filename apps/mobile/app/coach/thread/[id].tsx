import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { InboundMessage } from "@cliphy/shared";
import {
  mergeThread,
  messageMark,
  threadDays,
  threadFilter,
  type ThreadFilter,
} from "../../../lib/coach";
import { createBatch, getPeople, getThread, setMessagesHandled } from "../../../lib/coachApi";
import { MessageRow } from "../../../components/coach/MessageRow";
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

const FILTERS: [ThreadFilter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["done", "Done"],
];

/**
 * Everything one person has sent and been sent, oldest first. Tap messages to
 * select them, then tick them off as dealt with or put them in a batch.
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
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(false);

  useEffect(() => {
    getPeople()
      .then((r) => setName(r.people.find((p) => p.id === id)?.name ?? "Texts"))
      .catch(() => {});
    getThread(id)
      .then((r) => {
        setMessages(r.messages);
        setHasMore(r.hasMore);
      })
      .catch(() => setNote("Couldn't load this."));
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
    } catch {
      setNote("Couldn't load earlier messages.");
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
    } catch {
      setMessages(before);
      setNote("Couldn't save that. Try again.");
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
      setNote(err instanceof Error && err.message ? err.message : "Couldn't make the batch.");
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
              const mark = messageMark(message);
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
                  {mark ? (
                    <Text
                      style={{
                        ...small,
                        fontWeight: "700",
                        marginTop: 13,
                        marginLeft: 8,
                        color: mark === "Done" ? t.muted : ACCENT,
                      }}
                    >
                      {mark}
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
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderTopWidth: LINE,
            borderTopColor: t.line,
            backgroundColor: t.bg,
          }}
        >
          <Text style={{ fontFamily: FONT, fontSize: 13, fontWeight: "700", color: t.text }}>
            {picked.length} selected
          </Text>
          <View style={{ flex: 1 }} />
          <QuickButton
            label={unticking ? "Untick" : "Tick off"}
            primary
            disabled={busy}
            onPress={tick}
          />
          <QuickButton label="Batch" disabled={busy} onPress={batch} />
          <Pressable onPress={() => setSelected(new Set())} accessibilityRole="button" hitSlop={8}>
            <Text style={{ ...small, textDecorationLine: "underline" }}>Clear</Text>
          </Pressable>
        </View>
      ) : null}
    </Page>
  );
}
