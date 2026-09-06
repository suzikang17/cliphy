import { View, Text, Pressable, Modal, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { brutalShadow } from "../lib/theme";
import { uploadAndClipImage } from "../lib/uploadImage";

export function CaptureSheet({
  visible,
  onClose,
  onCaptured,
}: {
  visible: boolean;
  onClose: () => void;
  onCaptured: () => void;
}) {
  async function handle(pick: () => Promise<ImagePicker.ImagePickerResult>) {
    onClose();
    const result = await pick();
    if (result.canceled || !result.assets?.[0]) return;
    try {
      await uploadAndClipImage(result.assets[0].uri);
      onCaptured();
    } catch (err) {
      Alert.alert("Couldn't save image", err instanceof Error ? err.message : "Try again");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onClose}>
        <View
          className="bg-white dark:bg-[#282828] border-2 border-black dark:border-[#505050] rounded-t-2xl p-4 gap-3"
          style={brutalShadow()}
        >
          <SheetButton
            label="Choose from library"
            onPress={() =>
              handle(() =>
                ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  quality: 1,
                }),
              )
            }
          />
          <SheetButton
            label="Take a photo"
            onPress={async () => {
              const perm = await ImagePicker.requestCameraPermissionsAsync();
              if (!perm.granted) {
                Alert.alert("Camera access needed", "Enable camera access in Settings.");
                return;
              }
              handle(() => ImagePicker.launchCameraAsync({ quality: 1 }));
            }}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

function SheetButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        className="text-base font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
