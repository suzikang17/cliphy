import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { CoachHealth, CoachRule, Person, PersonRole } from "@cliphy/shared";
import {
  agoLabel,
  formatPairCode,
  helperRunning,
  pairCodeComplete,
  setupSteps,
  type SetupStep,
} from "../../lib/coach";
import {
  addPerson,
  claimPairCode,
  createRunnerKey,
  deleteRule,
  getCoachSettings,
  getHealth,
  getPeople,
  getRules,
  sendTestPush,
  updateCoachSettings,
  updatePerson,
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
  reminders: "Notifications",
  person: "First person",
  messages: "Messages",
  try: "Try it",
};
/** Short weekday labels, Sunday first, matching the server's day numbers. */
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("17:00");
  const [workSet, setWorkSet] = useState(false);
  const [workNote, setWorkNote] = useState<string | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairNote, setPairNote] = useState<string | null>(null);
  // The website task runner's key: made here, shown once.
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerKey, setRunnerKey] = useState<string | null>(null);
  const [runnerNote, setRunnerNote] = useState<string | null>(null);
  const [makingKey, setMakingKey] = useState(false);

  const makeRunnerKey = async () => {
    if (makingKey) return;
    setMakingKey(true);
    setRunnerNote(null);
    try {
      setRunnerKey((await createRunnerKey()).key);
    } catch (err) {
      setRunnerNote(err instanceof Error && err.message ? err.message : "Could not make a key");
    } finally {
      setMakingKey(false);
    }
  };
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, p, r, st] = await Promise.all([
        getHealth(),
        getPeople(),
        getRules(),
        getCoachSettings(),
      ]);
      const work = st.settings.work;
      setWorkSet(Boolean(work));
      if (work) {
        setWorkDays(work.days);
        setWorkStart(work.start);
        setWorkEnd(work.end);
      }
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
      // Keep "Working" honest while the page is open: the Mac checks in every 20 seconds.
      const timer = setInterval(() => {
        getHealth()
          .then(setHealth)
          .catch(() => {});
      }, 15_000);
      return () => clearInterval(timer);
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

  // The Mac helper shows a code; typing it here connects that Mac to this account.
  const connectMac = async () => {
    if (pairing || !pairCodeComplete(pairCode)) return;
    setPairing(true);
    setPairNote(null);
    try {
      await claimPairCode(pairCode);
      setPairCode("");
      setPairNote("Connected. The Mac starts in a moment.");
      setTimeout(() => void load(), 5000);
    } catch (err) {
      setPairNote(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setPairing(false);
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

  // Whose thread the Mac passes on, and how far back it reads the first time.
  const capture = async (
    person: Person,
    choice: { captureThread: false } | { historyWindow: "new" | "all" } | { historyDays: number },
  ) => {
    if (saving) return;
    setSaving(true);
    try {
      if ("captureThread" in choice) await updatePerson(person.id, { captureThread: false });
      else if ("historyDays" in choice) {
        await updatePerson(person.id, {
          captureThread: true,
          historyWindow: "window",
          historyDays: choice.historyDays,
        });
      } else
        await updatePerson(person.id, { captureThread: true, historyWindow: choice.historyWindow });
      setOpenPerson(null);
      await load();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const saveNumber = async (person: Person) => {
    if (saving || !number.trim()) return;
    setSaving(true);
    try {
      await updatePerson(person.id, { handles: [number.trim()] });
      setNumber("");
      await load();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  // Working hours: when the bot may check in. None set means no check-ins.
  const saveWork = async (clear: boolean) => {
    if (saving) return;
    setSaving(true);
    setWorkNote(null);
    try {
      await updateCoachSettings({
        work: clear ? null : { days: workDays, start: workStart.trim(), end: workEnd.trim() },
      });
      setWorkSet(!clear);
      setWorkNote(clear ? "Check-ins are off." : "Saved.");
    } catch {
      setWorkNote("Use times like 09:00 and 17:00, with the start before the end.");
    } finally {
      setSaving(false);
    }
  };
  const toggleDay = (day: number) =>
    setWorkDays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    );

  const forget = async (rule: CoachRule) => {
    setRules((rs) => rs.filter((r) => r.id !== rule.id));
    await deleteRule(rule.id).catch(() => void load());
  };

  const tried = coach.messages.some((m) => m.kind === "request");
  const steps = health ? setupSteps(health, people, tried) : [];
  const remindersOk = health ? !steps.includes("reminders") : false;
  const captured = people.filter((p) => p.captureThread);
  const macOn = helperRunning(health?.helperSeenAt, new Date());

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
                  Your Mac can pass me a person's texts and attachments. Open Cliphy Helper on the
                  Mac, then tap Mac messages below and enter its code.
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
          title="Notifications"
          detail={
            health?.lastDeliveredAt
              ? `Last arrived ${new Date(health.lastDeliveredAt).toLocaleString()}`
              : health && !health.timezoneSet
                ? "Timezone not set yet"
                : "Not tested yet"
          }
          right={remindersOk ? "Enabled" : testing ? "Testing" : "Test"}
          rightColor={remindersOk ? t.ok : t.due}
          onPress={remindersOk ? undefined : testReminders}
        />
        <Row
          title="Mac messages"
          detail={
            captured.length === 0
              ? "No threads chosen yet"
              : macOn
                ? captured.map((p) => p.name).join(", ")
                : agoLabel(health?.helperSeenAt, new Date())
                  ? `Mac last seen ${agoLabel(health?.helperSeenAt, new Date())}`
                  : "The Mac helper has not connected"
          }
          right={macOn ? "Working" : "Connect"}
          rightColor={macOn ? t.ok : t.due}
          onPress={() => setPairOpen((open) => !open)}
        />
        {pairOpen ? (
          <View style={{ marginBottom: 8 }}>
            <Body>Open Cliphy Helper on the Mac and enter the code it shows.</Body>
            <TextInput
              value={pairCode}
              onChangeText={(v) => setPairCode(formatPairCode(v))}
              placeholder="XXXX-XXXX"
              placeholderTextColor={t.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              accessibilityLabel="Code from the Mac"
              style={input}
            />
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <QuickButton
                label={pairing ? "Connecting" : "Connect"}
                primary
                disabled={pairing || !pairCodeComplete(pairCode)}
                onPress={connectMac}
              />
            </View>
            {pairNote ? <Body>{pairNote}</Body> : null}
          </View>
        ) : null}
        <Row title="Share sheet" detail="Share to Cliphy, then Send to Chat" />
        <Row
          title="Runner key"
          detail="For the machine that makes website changes"
          right={runnerOpen ? "Close" : "Open"}
          onPress={() => setRunnerOpen((open) => !open)}
        />
        {runnerOpen ? (
          <View style={{ marginBottom: 8 }}>
            {runnerKey ? (
              <>
                <Text selectable style={{ ...input, fontSize: 13 }}>
                  {runnerKey}
                </Text>
                <Body muted>Shown once. Put it in the runner's config.</Body>
              </>
            ) : (
              <Body>
                A key that can only pick up and report on website changes. It cannot read your
                messages.
              </Body>
            )}
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              {runnerKey ? (
                <QuickButton
                  label="Copy"
                  primary
                  onPress={() => {
                    void Clipboard.setStringAsync(runnerKey);
                    setRunnerNote("Copied.");
                  }}
                />
              ) : (
                <QuickButton
                  label={makingKey ? "Making" : "Make key"}
                  primary
                  disabled={makingKey}
                  onPress={makeRunnerKey}
                />
              )}
            </View>
            {runnerNote ? <Body muted>{runnerNote}</Body> : null}
          </View>
        ) : null}

        <SectionLabel>People</SectionLabel>
        {people.map((p) => (
          <View key={p.id}>
            <Row
              title={p.name}
              detail={
                p.role === "both"
                  ? "Client and collaborator"
                  : p.role === "client"
                    ? "Client"
                    : "Collaborator"
              }
              right={p.captureThread ? "Capturing" : "Capture"}
              rightColor={p.captureThread ? t.ok : t.muted}
              onPress={() => setOpenPerson(openPerson === p.id ? null : p.id)}
            />
            {openPerson === p.id ? (
              <View style={{ paddingVertical: 10, gap: 10 }}>
                {p.handles.length === 0 ? (
                  <>
                    <Body muted>Add their phone number to capture their texts.</Body>
                    <TextInput
                      value={number}
                      onChangeText={setNumber}
                      placeholder="Phone number"
                      placeholderTextColor={t.muted}
                      keyboardType="phone-pad"
                      accessibilityLabel={`Phone number for ${p.name}`}
                      style={input}
                    />
                    <View style={{ flexDirection: "row" }}>
                      <QuickButton
                        label="Save"
                        primary
                        disabled={saving || !number.trim()}
                        onPress={() => saveNumber(p)}
                      />
                    </View>
                  </>
                ) : p.captureThread ? (
                  <View style={{ flexDirection: "row" }}>
                    <QuickButton
                      label="Stop"
                      disabled={saving}
                      onPress={() => capture(p, { captureThread: false })}
                    />
                  </View>
                ) : (
                  <>
                    <Body muted>How far back should the Mac read?</Body>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      <QuickButton
                        label="New only"
                        disabled={saving}
                        onPress={() => capture(p, { historyWindow: "new" })}
                      />
                      <QuickButton
                        label="3 months"
                        disabled={saving}
                        onPress={() => capture(p, { historyDays: 90 })}
                      />
                      <QuickButton
                        label="Everything"
                        disabled={saving}
                        onPress={() => capture(p, { historyWindow: "all" })}
                      />
                    </View>
                  </>
                )}
              </View>
            ) : null}
          </View>
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

        <SectionLabel>Working hours</SectionLabel>
        <View style={{ marginTop: 8 }}>
          <Body muted>
            {workSet
              ? "I check in during these hours."
              : "Set these and I'll check in while you work."}
          </Body>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {DAY_LABELS.map((label, day) => (
            <QuickButton
              key={label}
              label={label}
              chosen={workDays.includes(day)}
              onPress={() => toggleDay(day)}
            />
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={workStart}
            onChangeText={setWorkStart}
            placeholder="09:00"
            placeholderTextColor={t.muted}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Start of working day"
            style={{ ...input, flex: 1 }}
          />
          <TextInput
            value={workEnd}
            onChangeText={setWorkEnd}
            placeholder="17:00"
            placeholderTextColor={t.muted}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="End of working day"
            style={{ ...input, flex: 1 }}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <QuickButton
            label="Save"
            primary
            disabled={saving || workDays.length === 0}
            onPress={() => saveWork(false)}
          />
          {workSet ? (
            <QuickButton label="Turn off" disabled={saving} onPress={() => saveWork(true)} />
          ) : null}
        </View>
        {workNote ? (
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 8 }}>
            {workNote}
          </Text>
        ) : null}

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
