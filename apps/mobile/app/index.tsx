import { View, Text } from "react-native";
import { neon } from "@cliphy/shared";

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-[#1e1e1e]">
      <Text className="text-2xl font-bold" style={{ color: neon[600] }}>
        Cliphy
      </Text>
      <Text className="text-sm text-gray-500 mt-1">NativeWind is working</Text>
    </View>
  );
}
