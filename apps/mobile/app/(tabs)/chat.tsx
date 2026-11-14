import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { CoachChatMessage } from "@cliphy/shared";
import { linkPath } from "../../lib/coachNav";
import { refreshCoach, refreshStrip, say, tap, useCoach } from "../../lib/coachStore";
import {
  ACCENT,
  BotCard,
  Body,
  FONT,
  LINE,
  QuickButton,
  useCoachTheme,
} from "../../components/coach/ui";

const POLL_MS = 4000;

export default function ChatScreen() {
  const t = useCoachTheme();
  const router = useRouter();
  const coach = useCoach();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<CoachChatMessage>>(null);
  const input = useRef<TextInput>(null);

  // Poll only while this screen is in front.
  useFocusEffect(
    useCallback(() => {
      // A full reload on arriving: older cards may have changed, and attachment
      // links expire. The timer then only asks for what is newer.
      void refreshCoach({ full: true });
      void refreshStrip();
      const timer = setInterval(() => void refreshCoach(), POLL_MS);
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") {
          void refreshCoach();
          void refreshStrip();
        }
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, []),
  );

  // An account without the coach never sees this screen.
  useEffect(() => {
    if (coach.status === "off") router.replace("/(tabs)");
  }, [coach.status, router]);

  const go = (path: string) => router.push(path as never);

  const onButton = async (m: CoachChatMessage, index: number) => {
    const action = m.buttons[index].action;
    await tap(m.id, index);
    if (action.type === "open") go(linkPath(action.link));
    // "Fix it" asks what was wrong; the answer is typed.
    if (action.type === "fix_request") input.current?.focus();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    const ok = await say(text);
    // Not sent (no network): put the words back so nothing typed is lost.
    // Anything typed meanwhile is kept after it.
    if (!ok) setDraft((typed) => (typed ? `${text}\n${typed}` : text));
    setSending(false);
  };

  if (coach.status !== "on") {
    return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  const strip = coach.strip;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 12,
          borderBottomWidth: LINE,
          borderBottomColor: t.line,
        }}
      >
        <Text style={{ fontFamily: FONT, fontSize: 22, fontWeight: "700", color: t.text }}>
          Chat
        </Text>
        <Pressable
          onPress={() => go("/coach/setup")}
          accessibilityRole="button"
          accessibilityLabel="Setup"
          hitSlop={10}
        >
          <Text style={{ fontFamily: FONT, fontSize: 13, fontWeight: "700", color: ACCENT }}>
            Setup
          </Text>
        </Pressable>
      </View>

      {strip ? (
        <Pressable
          onPress={() => go("/coach/upnext")}
          accessibilityRole="button"
          accessibilityLabel="Up next"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: LINE,
            borderBottomColor: t.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT, fontSize: 14, fontWeight: "700", color: t.text }}>
              {strip.thisWeek === 0 ? "Nothing this week" : `${strip.thisWeek} this week`}
            </Text>
            {strip.next ? (
              <Text numberOfLines={1} style={{ fontFamily: FONT, fontSize: 12, color: t.muted }}>
                {strip.next}
              </Text>
            ) : null}
          </View>
          <Text style={{ fontFamily: FONT, fontSize: 14, fontWeight: "700", color: t.text }}>
            All ›
          </Text>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <FlatList
          ref={list}
          data={coach.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) =>
            item.role === "user" ? (
              <UserBubble text={item.text} />
            ) : (
              <BotMessage message={item} onButton={onButton} onOpen={go} />
            )
          }
          ListEmptyComponent={
            <View style={{ paddingTop: 60, alignItems: "center", gap: 14 }}>
              <Body muted>Nothing here yet.</Body>
              <QuickButton label="Set up" primary onPress={() => go("/coach/setup")} />
            </View>
          }
          ListFooterComponent={<Status activity={coach.activity} offline={coach.offline} />}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 30,
            borderTopWidth: 1,
            borderTopColor: t.hairline,
            backgroundColor: t.bg,
          }}
        >
          <TextInput
            ref={input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={t.muted}
            multiline
            accessibilityLabel="Message"
            style={{
              flex: 1,
              maxHeight: 110,
              fontFamily: FONT,
              fontSize: 15,
              color: t.text,
              borderWidth: LINE,
              borderColor: t.line,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
            }}
          />
          <QuickButton label="Send" primary onPress={send} disabled={!draft.trim() || sending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UserBubble({ text }: { text: string }) {
  const t = useCoachTheme();
  return (
    <View
      style={{
        alignSelf: "flex-end",
        maxWidth: "78%",
        backgroundColor: t.dark ? "#f3f4f6" : "#111827",
        borderRadius: 10,
        paddingHorizontal: 13,
        paddingVertical: 8,
        marginBottom: 10,
      }}
    >
      <Text
        style={{
          fontFamily: FONT,
          fontSize: 15,
          lineHeight: 21,
          color: t.dark ? "#111827" : "#fff",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function BotMessage({
  message,
  onButton,
  onOpen,
}: {
  message: CoachChatMessage;
  onButton: (m: CoachChatMessage, index: number) => void;
  onOpen: (path: string) => void;
}) {
  const t = useCoachTheme();
  const tapped = message.chosen !== null;
  const images = message.attachments.filter((a) => a.url);

  return (
    <BotCard>
      <Body>{message.text}</Body>

      {images.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          {images.map((a) => (
            <Image
              key={a.storagePath}
              source={{ uri: a.url }}
              accessibilityLabel="Attachment"
              style={{
                width: 72,
                height: 92,
                borderRadius: 6,
                borderWidth: LINE,
                borderColor: t.line,
                backgroundColor: t.hairline,
              }}
            />
          ))}
        </View>
      ) : null}

      {message.buttons.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {message.buttons.map((b, i) => (
            <QuickButton
              key={`${i}-${b.label}`}
              label={b.label}
              chosen={message.chosen === i}
              disabled={tapped}
              onPress={() => onButton(message, i)}
            />
          ))}
        </View>
      ) : null}

      {message.link && message.link.type !== "upnext" && message.link.type !== "setup" ? (
        <Pressable
          onPress={() => onOpen(linkPath(message.link!))}
          accessibilityRole="link"
          hitSlop={8}
          style={{ marginTop: 10, alignSelf: "flex-start" }}
        >
          <Text style={{ fontFamily: FONT, fontSize: 13, fontWeight: "700", color: ACCENT }}>
            Open ›
          </Text>
        </Pressable>
      ) : null}
    </BotCard>
  );
}

/**
 * The quiet line under the thread: what the bot is doing right now, or that
 * the phone is offline. Nothing at all when idle and connected.
 */
function Status({ activity, offline }: { activity: string[]; offline: boolean }) {
  const t = useCoachTheme();
  const pulse = useRef(new Animated.Value(0.3)).current;
  const busy = activity.length > 0;

  useEffect(() => {
    if (!busy) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  if (!busy && !offline) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        paddingLeft: 2,
      }}
    >
      {busy ? (
        <Animated.View
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ACCENT, opacity: pulse }}
        />
      ) : null}
      <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted }}>
        {busy ? activity.join(" · ") : "Offline. Showing what was loaded."}
      </Text>
    </View>
  );
}
