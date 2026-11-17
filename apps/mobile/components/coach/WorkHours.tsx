import { Pressable, Text, View } from "react-native";
import { shiftHours, timeLabel, workLine } from "../../lib/coach";
import { FONT, LINE, QuickButton, useCoachTheme } from "./ui";

export interface WorkHoursValue {
  on: boolean;
  /** 0 = Sunday. */
  days: number[];
  start: string;
  end: string;
}

/** Monday first, as a working week reads. */
const DAYS: [number, string, string][] = [
  [1, "M", "Monday"],
  [2, "T", "Tuesday"],
  [3, "W", "Wednesday"],
  [4, "T", "Thursday"],
  [5, "F", "Friday"],
  [6, "S", "Saturday"],
  [0, "S", "Sunday"],
];
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const same = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * When the bot may check in. A switch, two presets, a row of days and two
 * times nudged by half hours. Every change is reported at once: there is no
 * Save, and nothing to type.
 */
export function WorkHours({
  value,
  onChange,
}: {
  value: WorkHoursValue;
  onChange: (next: WorkHoursValue) => void;
}) {
  const t = useCoachTheme();
  const set = (patch: Partial<WorkHoursValue>) => onChange({ ...value, ...patch });
  const toggleDay = (day: number) => {
    const days = value.days.includes(day)
      ? value.days.filter((d) => d !== day)
      : [...value.days, day];
    // A week with no days is "off", which the switch says more plainly.
    if (days.length > 0) set({ days });
  };

  const nudge = (which: "start" | "end", label: string, by: number, sign: string, word: string) => (
    <Pressable
      onPress={() => set(shiftHours(value, which, by))}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${word}`}
      hitSlop={6}
      style={{ paddingHorizontal: 14, paddingVertical: 8 }}
    >
      <Text style={{ fontFamily: FONT, fontSize: 18, fontWeight: "700", color: t.text }}>
        {sign}
      </Text>
    </Pressable>
  );

  const stepper = (which: "start" | "end", label: string) => (
    <View style={{ flex: 1, minWidth: 150 }}>
      <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginBottom: 4 }}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: LINE,
          borderColor: t.line,
          borderRadius: 10,
        }}
      >
        {nudge(which, label, -30, "−", "earlier")}
        <Text
          accessibilityLabel={`${label} ${timeLabel(value[which])}`}
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: FONT,
            fontSize: 15,
            fontWeight: "700",
            color: t.text,
          }}
        >
          {timeLabel(value[which])}
        </Text>
        {nudge(which, label, 30, "+", "later")}
      </View>
    </View>
  );

  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        onPress={() => set({ on: !value.on })}
        accessibilityRole="switch"
        accessibilityState={{ checked: value.on }}
        accessibilityLabel="Check in while I work"
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT, fontSize: 15, fontWeight: "500", color: t.text }}>
            Check in while I work
          </Text>
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 1 }}>
            {value.on ? workLine(value.days, value.start, value.end) : "Off. I won't check in."}
          </Text>
        </View>
        <View
          style={{
            width: 44,
            height: 26,
            borderRadius: 13,
            borderWidth: LINE,
            borderColor: t.line,
            backgroundColor: value.on ? t.fill : "transparent",
            padding: 2,
            alignItems: value.on ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={{
              width: 19,
              height: 19,
              borderRadius: 10,
              backgroundColor: value.on ? "#fff" : t.line,
            }}
          />
        </View>
      </Pressable>

      {value.on ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <QuickButton
              label="Weekdays"
              chosen={same(value.days, WEEKDAYS)}
              onPress={() => set({ days: WEEKDAYS })}
            />
            <QuickButton
              label="Every day"
              chosen={same(value.days, EVERY_DAY)}
              onPress={() => set({ days: EVERY_DAY })}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
            {DAYS.map(([day, letter, name]) => {
              const on = value.days.includes(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => toggleDay(day)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={name}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    borderWidth: LINE,
                    borderColor: t.line,
                    backgroundColor: on ? t.fill : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: FONT,
                      fontSize: 13,
                      fontWeight: "700",
                      color: on ? "#fff" : t.text,
                    }}
                  >
                    {letter}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
            {stepper("start", "From")}
            {stepper("end", "Until")}
          </View>
        </>
      ) : null}
    </View>
  );
}
