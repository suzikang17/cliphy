import { errorText } from "../../lib/coach";
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
  /** The photo just taken, kept so a failed save can be tried again. */
  const [photo, setPhoto] = useState<string | null>(null);
  /** The system's own words for why the photo was not saved. */
  const [problem, setProblem] = useState("Error");

  // Upload and file a photo that has been taken. Kept apart from taking it,
  // so a failure can be retried with the same photo instead of a new one.
  const save = async (uri: string) => {
    setStage("saving");
    try {
      const { storagePath } = await uploadCoachImage(uri);
      const saved = await addProgress(storagePath);
      setEntry(saved.entry);
      setFiled(saved.project);
      setStage("done");
      // When it was not sure, the bot also said so in chat.
      void refreshCoach();
    } catch (err) {
      setProblem(errorText(err));
      setStage("failed");
      return;
    }
    // The photo is saved whatever happens here: the project list is only for moving it.
    getProjects()
      .then((list) => setProjects(list.projects.filter((p) => p.active)))
      .catch(() => {});
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
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
        setPhoto(shot.assets[0].uri);
        await save(shot.assets[0].uri);
      } catch (err) {
        setProblem(errorText(err));
        setStage("failed");
      }
    })();
    // Runs once: the camera opens when the screen does.
  }, []);

  const move = async (project: Project) => {
    if (!entry || moving) return;
    setMoving(true);
    try {
      const { moved } = await moveProgress(entry.id, project.id);
      if (moved) setFiled({ id: project.id, name: project.name });
    } catch {
      // Left where it was; the list is still there to try again.
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
          {stage === "failed" ? (
            <>
              <Body muted>{problem}</Body>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {photo ? <QuickButton label="Retry" primary onPress={() => save(photo)} /> : null}
                <QuickButton label="Close" onPress={() => router.back()} />
              </View>
            </>
          ) : null}
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
