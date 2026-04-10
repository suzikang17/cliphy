import { View, Text } from "react-native";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24, fontWeight: "bold", color: "#9358c7" }}>Cliphy</Text>
      <Text style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>It works!</Text>
    </View>
  );
}
