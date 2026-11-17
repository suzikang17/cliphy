import { errorText } from "../../lib/coach";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Person } from "@cliphy/shared";
import { getPeople } from "../../lib/coachApi";
import { Body, Page, Row } from "../../components/coach/ui";

const ROLE: Record<string, string> = { client: "Client", collaborator: "Collaborator" };

/** Everyone whose texts are kept: tap one for their whole thread. */
export default function ThreadsScreen() {
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPeople()
        .then((r) => {
          setPeople(r.people);
          setFailed(null);
        })
        .catch((err) => setFailed(errorText(err)));
    }, []),
  );

  return (
    <Page title="Texts" sub={people ? `${people.length} people` : undefined}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
        {failed ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>{failed}</Body>
          </View>
        ) : null}
        {people?.length === 0 ? (
          <View style={{ marginTop: 20 }}>
            <Body muted>Nobody yet. Add people in Setup.</Body>
          </View>
        ) : null}
        {people?.map((p) => (
          <Row
            key={p.id}
            title={p.name}
            detail={ROLE[p.role] ?? p.role}
            right={p.captureThread ? undefined : "Not captured"}
            onPress={() => router.push(`/coach/thread/${p.id}` as never)}
          />
        ))}
      </ScrollView>
    </Page>
  );
}
