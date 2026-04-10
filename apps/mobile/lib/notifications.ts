import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getAccessToken } from "./auth";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  // Register with our server
  const accessToken = await getAccessToken();
  if (accessToken) {
    await fetch(`${API_URL}/api/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
      }),
    });
  }

  return token;
}

export async function unregisterPushToken(token: string) {
  const accessToken = await getAccessToken();
  if (!accessToken) return;

  await fetch(`${API_URL}/api/devices`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token }),
  });
}
