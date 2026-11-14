import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CoachRequest, InboundMessage, Person } from "@cliphy/shared";
import { confirmRequest, fixRequest, getPeople, getRequest } from "../../../lib/coachApi";
import { syncLocalReminders } from "../../../lib/coachNotifications";
import { refreshCoach, refreshStrip } from "../../../lib/coachStore";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../../components/coach/ui";

/** One request, made clear: what was sent, what was understood, the one question, what it replaces. */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useCoachTheme();
  const [request, setRequest] = useState<CoachRequest | null>(null);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [replaces, setReplaces] = useState<CoachRequest | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([getRequest(id), getPeople()]);
      setRequest(r.request);
      setMessages(r.messages);
      setReplaces(r.replaces);
      setPerson(p.people.find((x) => x.id === r.request.personId) ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = () => {
    void refreshCoach({ full: true });
    void refreshStrip();
    // Confirming creates dated tasks, and so reminders to back up.
    void syncLocalReminders();
    router.back();
  };

  const confirm = async (answer?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await confirmRequest(id, answer ? { answer } : {});
      done();
    } catch {
      setActionFailed(true);
      setBusy(false);
    }
  };

  const sendFix = async () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await fixRequest(id, text);
      done();
    } catch {
      setActionFailed(true);
      setBusy(false);
    }
  };

  const images = messages.flatMap((m) => m.attachments).filter((a) => a.url);
  const texts = messages.filter((m) => m.direction === "in" && m.text.trim());
  const isNew = request?.status === "new";

  return (
    <Page title="Request" sub={person ? `From ${person.name}` : undefined}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
        {failed ? <Body muted>Couldn't load this. Go back and try again.</Body> : null}
        {actionFailed ? <Body muted>That didn't work. Try again.</Body> : null}

        {request ? (
          <>
            <SectionLabel>What they sent</SectionLabel>
            {images.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 8 }}
              >
                {images.map((a) => (
                  <Image
                    key={a.storagePath}
                    source={{ uri: a.url }}
                    accessibilityLabel="Attachment"
                    style={{
                      width: 120,
                      height: 160,
                      marginRight: 8,
                      borderRadius: 6,
                      borderWidth: LINE,
                      borderColor: t.line,
                      backgroundColor: t.hairline,
                    }}
                  />
                ))}
              </ScrollView>
            ) : null}
            {texts.map((m) => (
              <View
                key={m.id}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: t.line,
                  paddingLeft: 10,
                  marginTop: 10,
                }}
              >
                <Body>{m.text}</Body>
              </View>
            ))}

            <SectionLabel>What I understood</SectionLabel>
            <View style={{ marginTop: 8 }}>
              <Body>{request.understood}</Body>
            </View>

            {request.openQuestion && isNew ? (
              <>
                <SectionLabel>Not sure</SectionLabel>
                <View style={{ marginTop: 8 }}>
                  <Body>{request.openQuestion.text}</Body>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {request.openQuestion.options.map((option) => (
                    <QuickButton
                      key={option}
                      label={option}
                      disabled={busy}
                      onPress={() => confirm(option)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {request.answer ? (
              <>
                <SectionLabel>You said</SectionLabel>
                <View style={{ marginTop: 8 }}>
                  <Body>{request.answer}</Body>
                </View>
              </>
            ) : null}

            {replaces ? (
              <>
                <SectionLabel>Replaces</SectionLabel>
                <Row title={replaces.understood} detail="Kept in history" dim />
              </>
            ) : null}

            {isNew ? (
              fixing ? (
                <View style={{ marginTop: 22, gap: 10 }}>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    autoFocus
                    multiline
                    placeholder="What did I get wrong?"
                    placeholderTextColor={t.muted}
                    accessibilityLabel="What was wrong"
                    style={{
                      fontFamily: FONT,
                      fontSize: 15,
                      color: t.text,
                      borderWidth: LINE,
                      borderColor: t.line,
                      borderRadius: 10,
                      padding: 12,
                      minHeight: 70,
                    }}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <QuickButton
                      label="Send"
                      primary
                      disabled={busy || !note.trim()}
                      onPress={sendFix}
                    />
                    <QuickButton label="Cancel" disabled={busy} onPress={() => setFixing(false)} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 22 }}>
                  <QuickButton
                    label="Looks right"
                    primary
                    disabled={busy}
                    onPress={() => confirm()}
                  />
                  <QuickButton label="Fix it" disabled={busy} onPress={() => setFixing(true)} />
                </View>
              )
            ) : (
              <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 22 }}>
                {request.status === "replaced" ? "Replaced by a later request." : "Confirmed."}
              </Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
