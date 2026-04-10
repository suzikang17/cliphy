import { Stack } from "expo-router";
import { getTheme } from "../../lib/theme";

export default function AuthLayout() {
  const theme = getTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.surface },
      }}
    />
  );
}
