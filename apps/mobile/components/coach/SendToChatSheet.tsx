import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import type { Person } from "@cliphy/shared";
import { getPeople } from "../../lib/coachApi";
import { refreshCoach } from "../../lib/coachStore";
import { sendShareToChat } from "../../lib/sendToChat";
import { setPendingShare, usePendingShare, type PendingShare } from "../../lib/shareStore";
import { Body, FONT, LINE, Row, SectionLabel, useCoachTheme } from "./ui";

/**
 * After something is shared into the app: send it to the bot as a request
 * from one of the user's people, or save it to the Library as before.
 */
export function SendToChatSheet({ onLibrary }: { onLibrary: (share: PendingShare) => void }) {
  const t = useCoachTheme();
  const share = usePendingShare();
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!share) return;
    getPeople()
      .then((r) => setPeople(r.people))
      .catch(() => setPeople([]));
  }, [share]);

  if (!share) return null;

  const close = () => {
    if (!busy) setPendingShare(null);
  };

  const toChat = async (person: Person) => {
    if (busy) return;
    setBusy(true);
    try {
      await sendShareToChat(person.id, share);
      setPendingShare(null);
      void refreshCoach();
    } catch {
      // Nothing is lost: the sheet stays open so it can be tried again or saved to Library.
      Alert.alert("Couldn't send it", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toLibrary = () => {
    if (busy) return;
    setPendingShare(null);
    onLibrary(share);
  };

  const count = share.imageUris.length;
  const what = count > 0 ? `${count} ${count === 1 ? "image" : "images"}` : "Text";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
        onPress={close}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: t.bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderTopWidth: LINE,
            borderColor: t.line,
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: 36,
          }}
        >
          <Text style={{ fontFamily: FONT, fontSize: 18, fontWeight: "700", color: t.text }}>
            {busy ? "Sending" : what}
          </Text>

          <SectionLabel>Send to Chat, from</SectionLabel>
          {people.length === 0 ? (
            <View style={{ marginTop: 8 }}>
              <Body muted>Add a person in Setup first.</Body>
            </View>
          ) : (
            people.map((p) => (
              <Row key={p.id} title={p.name} onPress={() => toChat(p)} dim={busy} />
            ))
          )}

          <SectionLabel>Or</SectionLabel>
          <Row title="Save to Library" onPress={toLibrary} dim={busy} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
