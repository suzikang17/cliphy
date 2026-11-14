import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { CoachHealth, CoachRule, Person, PersonRole } from "@cliphy/shared";
import { setupSteps, type SetupStep } from "../../lib/coach";
import {
  addPerson,
  deleteRule,
  getHealth,
  getPeople,
  getRules,
  sendTestPush,
} from "../../lib/coachApi";
import { reportTimezone, syncLocalReminders } from "../../lib/coachNotifications";
import { useCoach } from "../../lib/coachStore";
import { registerForPushNotifications } from "../../lib/notifications";
import {
  Body,
  FONT,
  LINE,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../components/coach/ui";

const STEP_TITLE: Record<SetupStep, string> = {
  reminders: "Reminders",
  person: "First person",
  messages: "Messages",
  try: "Try it",
};
const ROLES: { role: PersonRole; label: string }[] = [
  { role: "client", label: "Client" },
  { role: "collaborator", label: "Collaborator" },
  { role: "both", label: "Both" },
];

/**
 * Setup and health in one place: the first-run steps, each proven by a real
 * test, then what is connected and when it last worked.
 */
export default function SetupScreen() {
  const t = useCoachTheme();
  const coach = useCoach();
  const [health, setHealth] = useState<CoachHealth | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<CoachRule[]>([]);
  const [failed, setFailed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<PersonRole>("client");
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, p, r] = await Promise.all([getHealth(), getPeople(), getRules()]);
      setHealth(h);
      setPeople(p.people);
      setRules(r.rules.filter((x) => x.active));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(
    () => () => {
      if (poll.current) clearInterval(poll.current);
    },
    [],
  );

  // Allow notifications, send a real test, and wait for the phone to report it.
  const testReminders = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const token = await registerForPushNotifications();
      if (!token) {
        Alert.alert(
          "Notifications are off",
          "Turn them on for Cliphy in Settings, then try again.",
        );
        setTesting(false);
        return;
      }
      await reportTimezone();
      await sendTestPush();
      let tries = 0;
      poll.current = setInterval(async () => {
        tries++;
        const h = await getHealth().catch(() => null);
        if (h) setHealth(h);
        if ((h?.lastDeliveredAt && h.pushOk) || tries >= 10) {
          if (poll.current) clearInterval(poll.current);
          setTesting(false);
          void syncLocalReminders();
        }
      }, 2000);
    } catch {
      setTesting(false);
      setFailed(true);
    }
  };

  const savePerson = async () => {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      const h = handle.trim();
      await addPerson({ name: n, role, handles: h ? [h] : [] });
      setName("");
      setHandle("");
      await load();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const forget = async (rule: CoachRule) => {
    setRules((rs) => rs.filter((r) => r.id !== rule.id));
    await deleteRule(rule.id).catch(() => void load());
  };

  const tried = coach.messages.some((m) => m.kind === "request");
  const steps = health ? setupSteps(health, people, tried) : [];
  const remindersOk = health ? !steps.includes("reminders") : false;
  const captured = people.filter((p) => p.captureThread);

  const input = {
    fontFamily: FONT,
    fontSize: 15,
    color: t.text,
    borderWidth: LINE,
    borderColor: t.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 8,
  } as const;

  return (
    <Page
      title="Setup"
      sub={health ? (steps.length === 0 ? "All working" : `${steps.length} to finish`) : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {failed ? (
          <View style={{ marginTop: 16 }}>
            <Body muted>Couldn't reach the server.</Body>
          </View>
        ) : null}

        {steps.length > 0 ? (
          <>
            <SectionLabel>{`Next: ${STEP_TITLE[steps[0]]}`}</SectionLabel>
            <View style={{ marginTop: 8 }}>
              {steps[0] === "reminders" ? (
                <>
                  <Body>I need to be able to reach you.</Body>
                  <View style={{ flexDirection: "row", marginTop: 10 }}>
                    <QuickButton
                      label={testing ? "Testing" : "Allow"}
                      primary
                      disabled={testing}
                      onPress={testReminders}
                    />
                  </View>
                </>
              ) : null}
              {steps[0] === "person" ? <Body>Who do you work with? Add them below.</Body> : null}
              {steps[0] === "messages" ? (
                <Body>
                  Your Mac can pass me a person's texts and attachments. Run the Cliphy helper on
                  the Mac and choose their thread there.
                </Body>
              ) : null}
              {steps[0] === "try" ? (
                <Body>Share one real request to Cliphy and choose Send to Chat.</Body>
              ) : null}
            </View>
          </>
        ) : null}

        <SectionLabel>Connections</SectionLabel>
        <Row
          title="Reminders"
          detail={
            health?.lastDeliveredAt
              ? `Last arrived ${new Date(health.lastDeliveredAt).toLocaleString()}`
              : health && !health.timezoneSet
                ? "Timezone not set yet"
                : "Not tested yet"
          }
          right={remindersOk ? "Working" : testing ? "Testing" : "Test"}
          rightColor={remindersOk ? t.ok : t.due}
          onPress={remindersOk ? undefined : testReminders}
        />
        <Row
          title="Mac messages"
          detail={captured.length ? captured.map((p) => p.name).join(", ") : "No threads connected"}
          right={captured.length ? "Working" : "Later"}
          rightColor={captured.length ? t.ok : t.muted}
        />
        <Row title="Share sheet" detail="Share to Cliphy, then Send to Chat" />

        <SectionLabel>People</SectionLabel>
        {people.map((p) => (
          <Row
            key={p.id}
            title={p.name}
            detail={
              p.role === "both"
                ? "Client and collaborator"
                : p.role === "client"
                  ? "Client"
                  : "Collaborator"
            }
          />
        ))}
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={t.muted}
          accessibilityLabel="Person's name"
          style={input}
        />
        <TextInput
          value={handle}
          onChangeText={setHandle}
          placeholder="Phone number (optional)"
          placeholderTextColor={t.muted}
          keyboardType="phone-pad"
          accessibilityLabel="Phone number"
          style={input}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {ROLES.map((r) => (
            <QuickButton
              key={r.role}
              label={r.label}
              chosen={role === r.role}
              onPress={() => setRole(r.role)}
            />
          ))}
        </View>
        <View style={{ flexDirection: "row", marginTop: 10 }}>
          <QuickButton label="Add" primary disabled={!name.trim() || saving} onPress={savePerson} />
        </View>

        <SectionLabel>Learned</SectionLabel>
        {rules.length === 0 ? (
          <View style={{ marginTop: 8 }}>
            <Body muted>Nothing yet.</Body>
          </View>
        ) : (
          rules.map((r) => (
            <Row
              key={r.id}
              title={r.sentence}
              right="Forget"
              rightColor={t.due}
              onPress={() => forget(r)}
            />
          ))
        )}
        <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 10 }}>
          If it isn't listed here, I haven't learned it.
        </Text>
      </ScrollView>
    </Page>
  );
}
