import { useEffect, useRef, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import type { Project, ProgressEntry } from "@cliphy/shared";
import { addProgress, getProjects, moveProgress } from "../../lib/coachApi";
import { refreshCoach } from "../../lib/coachStore";
import { uploadCoachImage } from "../../lib/sendToChat";
import {
  Body,
  LINE,
  Page,
  QuickButton,
  Row,
  SectionLabel,
  useCoachTheme,
} from "../../components/coach/ui";

type Stage = "taking" | "saving" | "done" | "failed" | "denied";

/**
 * A photo of work in progress. Opens the camera straight away, files the
 * photo, and says where it went. When the bot was sure, this is the only
 * place that is shown, with a way to move it; when it was not, it asks here
 * as well as in chat.
 */
export default function CameraScreen() {
  const router = useRouter();
  const t = useCoachTheme();
  const [stage, setStage] = useState<Stage>("taking");
  const [entry, setEntry] = useState<ProgressEntry | null>(null);
  const [filed, setFiled] = useState<{ id: string; name: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [moving, setMoving] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setStage("denied");
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({ quality: 1 });
      if (shot.canceled || !shot.assets?.[0]) {
        router.back();
        return;
      }
      setStage("saving");
      try {
        const { storagePath } = await uploadCoachImage(shot.assets[0].uri);
        const [saved, list] = await Promise.all([addProgress(storagePath), getProjects()]);
        setEntry(saved.entry);
        setFiled(saved.project);
        setProjects(list.projects.filter((p) => p.active));
        setStage("done");
        // When it was not sure, the bot also said so in chat.
        void refreshCoach();
      } catch {
        setStage("failed");
      }
    })();
  }, [router]);

  const move = async (project: Project) => {
    if (!entry || moving) return;
    setMoving(true);
    try {
      const { moved } = await moveProgress(entry.id, project.id);
      if (moved) setFiled({ id: project.id, name: project.name });
    } finally {
      setMoving(false);
    }
  };

  const others = projects.filter((p) => p.id !== filed?.id);

  return (
    <Page title="Progress" sub={filed ? `Filed under ${filed.name}` : undefined}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
        <View style={{ marginTop: 16 }}>
          {stage === "taking" ? <Body muted>Opening the camera.</Body> : null}
          {stage === "saving" ? <Body muted>Saving.</Body> : null}
          {stage === "failed" ? <Body muted>Couldn't save the photo. Try again.</Body> : null}
          {stage === "denied" ? (
            <Body muted>Turn on camera access for Cliphy in Settings.</Body>
          ) : null}
        </View>

        {stage === "done" && entry ? (
          <>
            {entry.url ? (
              <Image
                source={{ uri: entry.url }}
                accessibilityLabel="Progress photo"
                style={{
                  width: "100%",
                  aspectRatio: 3 / 4,
                  borderRadius: 8,
                  borderWidth: LINE,
                  borderColor: t.line,
                  backgroundColor: t.hairline,
                }}
              />
            ) : null}

            {others.length > 0 ? (
              <>
                <SectionLabel>{filed ? "Move to" : "Which project?"}</SectionLabel>
                {others.map((p) => (
                  <Row key={p.id} title={p.name} dim={moving} onPress={() => move(p)} />
                ))}
              </>
            ) : null}

            <View style={{ flexDirection: "row", marginTop: 22 }}>
              <QuickButton label="Done" primary onPress={() => router.back()} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}
