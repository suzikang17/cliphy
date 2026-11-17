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
  historyLine,
  mcpCommand,
  setupSteps,
  type SetupStep,
  errorText,
} from "../../lib/coach";

// Where an outside tool reaches the API. On the website that is the site itself.
const API_URL =
  process.env.EXPO_PUBLIC_API_URL || (DESKTOP && !MAC_WINDOW ? window.location.origin : "");
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
import { createApiKey } from "../../lib/api";
import { DESKTOP, MAC_WINDOW } from "../../lib/desktop";
import { WorkHours, type WorkHoursValue } from "../../components/coach/WorkHours";
import { Widget, WidgetGrid, WidgetLink } from "../../components/coach/Widget";
import { reportTimezone, syncLocalReminders } from "../../lib/coachNotifications";

import { useCoach } from "../../lib/coachStore";
import { registerForPushNotifications } from "../../lib/notifications";
import { Body, FONT, LINE, Page, QuickButton, Row, useCoachTheme } from "../../components/coach/ui";

const STEP_TITLE: Record<SetupStep, string> = {
  reminders: "Notifications",
  person: "First person",
  messages: "Messages",
  try: "Try it",
};
/** Short weekday labels, Sunday first, matching the server's day numbers. */
const ROLES: { role: PersonRole; label: string }[] = [
  { role: "client", label: "Client" },
  { role: "collaborator", label: "Collaborator" },
  { role: "both", label: "Both" },
];

/**
 * Settings: what is left to set up, the people, how requests get in, working
 * hours, outside tools, and what the bot has learned. Each group is its own
 * widget; on a wide window they sit side by side.
 */
export default function SetupScreen() {
  const t = useCoachTheme();
  const coach = useCoach();
  const [health, setHealth] = useState<CoachHealth | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<CoachRule[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
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
  const [addOpen, setAddOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairNote, setPairNote] = useState<string | null>(null);
  // The website task runner's key: made here, shown once.
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerKey, setRunnerKey] = useState<string | null>(null);
  const [runnerNote, setRunnerNote] = useState<string | null>(null);
  const [makingKey, setMakingKey] = useState(false);

  // A key for Claude Code (MCP), shown once inside the command that uses it.
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantKey, setAssistantKey] = useState<string | null>(null);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);
  const [makingAssistantKey, setMakingAssistantKey] = useState(false);
  const makeAssistantKey = async () => {
    if (makingAssistantKey) return;
    setMakingAssistantKey(true);
    setAssistantNote(null);
    try {
      setAssistantKey((await createApiKey("Claude Code")).key);
    } catch (err) {
      setAssistantNote(errorText(err));
    } finally {
      setMakingAssistantKey(false);
    }
  };

  const makeRunnerKey = async () => {
    if (makingKey) return;
    setMakingKey(true);
    setRunnerNote(null);
    try {
      setRunnerKey((await createRunnerKey()).key);
    } catch (err) {
      setRunnerNote(errorText(err));
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
      setFailed(null);
    } catch (err) {
      setFailed(errorText(err));
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
    } catch (err) {
      setTesting(false);
      setFailed(errorText(err));
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
      setPairNote(errorText(err));
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
      setAddOpen(false);
      await load();
    } catch (err) {
      setFailed(errorText(err));
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
    } catch (err) {
      setFailed(errorText(err));
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
    } catch (err) {
      setFailed(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  // Working hours: when the bot may check in. Off means no check-ins.
  // Each change shows at once and is saved a moment later, so a run of taps
  // on a stepper is one save.
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeWork = (next: WorkHoursValue) => {
    setWorkSet(next.on);
    setWorkDays(next.days);
    setWorkStart(next.start);
    setWorkEnd(next.end);
    setWorkNote(null);
    if (workTimer.current) clearTimeout(workTimer.current);
    workTimer.current = setTimeout(() => {
      updateCoachSettings({
        work: next.on ? { days: next.days, start: next.start, end: next.end } : null,
      })
        .then(() => setWorkNote("Saved."))
        .catch((err) => setWorkNote(errorText(err)));
    }, 600);
  };
  useEffect(
    () => () => {
      if (workTimer.current) clearTimeout(workTimer.current);
    },
    [],
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

  const note = { fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 8 } as const;
  const keyBlock = (opts: {
    shown: string | null;
    about: string;
    after: string;
    making: boolean;
    make: () => void;
    said: string | null;
    copied: () => void;
  }) => (
    <View style={{ marginBottom: 8 }}>
      {opts.shown ? (
        <>
          <Text selectable style={{ ...input, fontSize: 13 }}>
            {opts.shown}
          </Text>
          <Text style={note}>{opts.after}</Text>
        </>
      ) : (
        <Text style={note}>{opts.about}</Text>
      )}
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        {opts.shown ? (
          <QuickButton
            label="Copy"
            primary
            onPress={() => {
              void Clipboard.setStringAsync(opts.shown as string);
              opts.copied();
            }}
          />
        ) : (
          <QuickButton
            label={opts.making ? "Making" : "Make key"}
            primary
            disabled={opts.making}
            onPress={opts.make}
          />
        )}
      </View>
      {opts.said ? <Text style={note}>{opts.said}</Text> : null}
    </View>
  );

  return (
    <Page
      title="Settings"
      sub={health ? (steps.length === 0 ? "All working" : `${steps.length} to finish`) : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 60,
          gap: 12,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {failed ? <Body muted>{failed}</Body> : null}

        <WidgetGrid>
          {steps.length > 0 ? (
            <Widget title={`Next: ${STEP_TITLE[steps[0]]}`} wide>
              <View style={{ marginTop: 6 }}>
                {steps[0] === "reminders" ? (
                  DESKTOP ? (
                    <Body>Open Cliphy on your phone and allow notifications there.</Body>
                  ) : (
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
                  )
                ) : null}
                {steps[0] === "person" ? (
                  <Body>Who do you work with? Add them under People.</Body>
                ) : null}
                {steps[0] === "messages" ? (
                  <Body>
                    Your Mac can pass me a person's texts and pictures. Open Cliphy Helper on the
                    Mac, then enter its code under Getting requests in.
                  </Body>
                ) : null}
                {steps[0] === "try" ? (
                  <Body>Share one real request to Cliphy and choose Send to Chat.</Body>
                ) : null}
              </View>
            </Widget>
          ) : null}

          <Widget
            title="People"
            count={people.length}
            action={
              <WidgetLink
                label={addOpen ? "Cancel" : "Add"}
                onPress={() => setAddOpen((o) => !o)}
              />
            }
          >
            {addOpen ? (
              <View style={{ marginBottom: 10 }}>
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
                  <QuickButton
                    label="Add"
                    primary
                    disabled={!name.trim() || saving}
                    onPress={savePerson}
                  />
                </View>
              </View>
            ) : null}
            {people.length === 0 && !addOpen ? (
              <Text style={note}>Nobody yet. Add the clients and collaborators you work with.</Text>
            ) : null}
            {people.map((p) => (
              <View key={p.id}>
                <Row
                  title={p.name}
                  detail={
                    (p.role === "both"
                      ? "Client and collaborator"
                      : p.role === "client"
                        ? "Client"
                        : "Collaborator") + (p.captureThread ? ` · ${historyLine(p)}` : "")
                  }
                  right={p.captureThread ? "Capturing" : "Not captured"}
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
                    ) : (
                      <>
                        <Body muted>
                          {p.captureThread
                            ? "How far back the Mac reads their texts:"
                            : "Capture their texts from the Mac, reading back:"}
                        </Body>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <QuickButton
                            label="New only"
                            chosen={p.captureThread && p.historyWindow === "new"}
                            disabled={saving}
                            onPress={() => capture(p, { historyWindow: "new" })}
                          />
                          <QuickButton
                            label="3 months"
                            chosen={p.captureThread && p.historyWindow === "window"}
                            disabled={saving}
                            onPress={() => capture(p, { historyDays: 90 })}
                          />
                          <QuickButton
                            label="Everything"
                            chosen={p.captureThread && p.historyWindow === "all"}
                            disabled={saving}
                            onPress={() => capture(p, { historyWindow: "all" })}
                          />
                          {p.captureThread ? (
                            <QuickButton
                              label="Stop"
                              disabled={saving}
                              onPress={() => capture(p, { captureThread: false })}
                            />
                          ) : null}
                        </View>
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            ))}
          </Widget>

          <Widget title="Getting requests in">
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
              right={macOn ? "Working" : pairOpen ? "Close" : "Connect"}
              rightColor={macOn ? t.ok : t.due}
              onPress={() => setPairOpen((open) => !open)}
            />
            {pairOpen ? (
              <View style={{ marginBottom: 8 }}>
                <Text style={note}>Open Cliphy Helper on the Mac and enter the code it shows.</Text>
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
                {pairNote ? <Text style={note}>{pairNote}</Text> : null}
              </View>
            ) : null}
            <Row title="Share sheet" detail="On the phone: share to Cliphy, then Send to Chat" />
            <Row
              title="Notifications"
              detail={
                health?.lastDeliveredAt
                  ? `Last arrived ${new Date(health.lastDeliveredAt).toLocaleString()}`
                  : health && !health.timezoneSet
                    ? "Timezone not set yet"
                    : "Not tested yet"
              }
              right={
                remindersOk ? "Working" : DESKTOP ? "On the phone" : testing ? "Testing" : "Test"
              }
              rightColor={remindersOk ? t.ok : t.due}
              onPress={remindersOk || DESKTOP ? undefined : testReminders}
            />
          </Widget>

          <Widget title="Working hours">
            <WorkHours
              value={{ on: workSet, days: workDays, start: workStart, end: workEnd }}
              onChange={changeWork}
            />
            {workNote ? <Text style={note}>{workNote}</Text> : null}
          </Widget>

          {/* Keys can only be made by a signed-in person, which the Mac window is not. */}
          {MAC_WINDOW ? null : (
            <Widget title="Connected tools">
              <Row
                title="Claude Code"
                detail="Let it see what's open and mark work done"
                right={assistantOpen ? "Close" : "Connect"}
                onPress={() => setAssistantOpen((open) => !open)}
              />
              {assistantOpen
                ? keyBlock({
                    shown: assistantKey ? mcpCommand(assistantKey, API_URL) : null,
                    about:
                      "A key for Claude Code on your own computer. With it, Claude can read your projects, tasks and clients' messages, add tasks and mark them done.",
                    after: "Shown once. Paste it into a terminal on your computer.",
                    making: makingAssistantKey,
                    make: makeAssistantKey,
                    said: assistantNote,
                    copied: () => setAssistantNote("Copied."),
                  })
                : null}
              <Row
                title="Website runner"
                detail="The machine that makes website changes for you"
                right={runnerOpen ? "Close" : "Connect"}
                onPress={() => setRunnerOpen((open) => !open)}
              />
              {runnerOpen
                ? keyBlock({
                    shown: runnerKey,
                    about:
                      "A key that can only pick up and report on website changes. It cannot read your messages.",
                    after: "Shown once. Put it in the runner's config.",
                    making: makingKey,
                    make: makeRunnerKey,
                    said: runnerNote,
                    copied: () => setRunnerNote("Copied."),
                  })
                : null}
            </Widget>
          )}

          <Widget title="Learned" count={rules.length} wide>
            {rules.length === 0 ? <Text style={note}>Nothing yet.</Text> : null}
            {rules.map((r) => (
              <Row
                key={r.id}
                title={r.sentence}
                right="Forget"
                rightColor={t.due}
                onPress={() => forget(r)}
              />
            ))}
            <Text style={note}>If it isn't listed here, I haven't learned it.</Text>
          </Widget>
        </WidgetGrid>
      </ScrollView>
    </Page>
  );
}
