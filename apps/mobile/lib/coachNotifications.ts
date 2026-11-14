import * as Notifications from "expo-notifications";
import { mirrorId, mirrorPlan } from "./coach";
import {
  ackReminder,
  getCoachSettings,
  getReminders,
  reportDelivered,
  updateCoachSettings,
} from "./coachApi";
import { getCoachState } from "./coachStore";

// The phone's side of reminders: tell the server our timezone, tell it when a
// reminder arrives and when it is answered, and keep a local backup of
// upcoming reminders for when there is no signal.

interface ReminderData {
  type?: string;
  reminderId?: string;
  taskId?: string;
  /** True for the phone's own backup copy, as opposed to a push from the server. */
  local?: boolean;
}

/** The server plans no reminders until it knows the timezone, so report it on every launch. */
export async function reportTimezone(): Promise<void> {
  if (getCoachState().status !== "on") return;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) return;
  try {
    const { settings } = await getCoachSettings();
    if (settings.timezoneSet && settings.timezone === timezone) return;
    await updateCoachSettings({ timezone });
  } catch {
    // Tried again next launch; health shows it as unset meanwhile.
  }
}

/** Bring the phone's local backups in line with the server's upcoming reminders. */
export async function syncLocalReminders(): Promise<void> {
  if (getCoachState().status !== "on") return;
  try {
    const [{ reminders }, scheduled] = await Promise.all([
      getReminders(),
      Notifications.getAllScheduledNotificationsAsync(),
    ]);
    const plan = mirrorPlan(
      reminders,
      scheduled.map((n) => n.identifier),
      new Date(),
    );
    for (const id of plan.cancel) await Notifications.cancelScheduledNotificationAsync(id);
    for (const r of plan.schedule) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: {
          title: r.title,
          body: r.body,
          sound: "default",
          data: { type: "reminder", reminderId: r.reminderId, taskId: r.taskId, local: true },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.date },
      });
    }
  } catch {
    // The server still pushes; the backup is retried on the next sync.
  }
}

/**
 * A notification arrived while the app is running.
 * A server push proves delivery: report it, and drop the local backup so the
 * same reminder is not shown twice. A local backup firing proves nothing
 * about push, so it is not reported.
 */
export async function onNotificationReceived(
  notification: Notifications.Notification,
): Promise<void> {
  const data = (notification.request.content.data ?? {}) as ReminderData;
  if (data.local) return;
  if (data.type === "test") {
    // The setup test: any delivery report marks notifications as working.
    await reportDelivered("test").catch(() => {});
    return;
  }
  if (data.type !== "reminder" || !data.reminderId) return;
  await Notifications.cancelScheduledNotificationAsync(mirrorId(data.reminderId)).catch(() => {});
  await reportDelivered(data.reminderId).catch(() => {});
}

/**
 * The user tapped a notification. Returns the route to open, if it was ours.
 * Tapping counts as both received and answered.
 */
export async function onNotificationTapped(
  response: Notifications.NotificationResponse,
): Promise<string | null> {
  const data = (response.notification.request.content.data ?? {}) as ReminderData;
  if (data.type === "weekly_review") return "/coach/upnext";
  if (data.type === "test") {
    await reportDelivered("test").catch(() => {});
    return "/coach/setup";
  }
  if (data.type !== "reminder" || !data.reminderId) return null;
  await Notifications.cancelScheduledNotificationAsync(mirrorId(data.reminderId)).catch(() => {});
  if (!data.local) await reportDelivered(data.reminderId).catch(() => {});
  await ackReminder(data.reminderId).catch(() => {});
  return "/chat";
}
