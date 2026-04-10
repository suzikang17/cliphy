import { View, Text } from "react-native";
import { Logo } from "../../components/Logo";

export default function QueueScreen() {
  return (
    <View className="flex-1 bg-white dark:bg-[#1e1e1e]">
      <View className="flex-row items-center px-4 py-3 pt-14 border-b border-[#e5e7eb] dark:border-[#2a2a2a]">
        <Logo size={28} />
        <Text
          className="text-lg font-bold ml-2 text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
        >
          Cliphy
        </Text>
      </View>
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
          Your videos will show up here
        </Text>
      </View>
    </View>
  );
}
