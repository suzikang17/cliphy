import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Summary } from "@cliphy/shared";
import { errorText } from "../lib/coach";
import { saveNote } from "../lib/voiceApi";
import { FONT, LINE, QuickButton, useCoachTheme } from "./coach/ui";

/** Write a note. It is saved to the Library and tagged like anything else there. */
export function NoteSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (note: Summary) => void;
}) {
  const t = useCoachTheme();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setProblem(null);
  }, [visible]);

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      const { note } = await saveNote(text);
      setText("");
      onSaved(note);
      onClose();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderWidth: LINE,
              borderColor: t.line,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 30,
            }}
          >
            <Text style={{ fontFamily: FONT, fontSize: 18, fontWeight: "700", color: t.text }}>
              Note
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              autoFocus
              multiline
              placeholder="Write it down"
              placeholderTextColor={t.muted}
              accessibilityLabel="Note"
              style={{
                minHeight: 130,
                maxHeight: 280,
                marginTop: 12,
                fontFamily: FONT,
                fontSize: 16,
                lineHeight: 22,
                color: t.text,
                borderWidth: LINE,
                borderColor: t.line,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                textAlignVertical: "top",
              }}
            />
            {problem ? (
              <Text style={{ fontFamily: FONT, fontSize: 13, color: t.due, marginTop: 8 }}>
                {problem}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <QuickButton
                label={saving ? "Saving" : "Save"}
                primary
                disabled={saving || !text.trim()}
                onPress={save}
              />
              <QuickButton label="Cancel" disabled={saving} onPress={onClose} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
