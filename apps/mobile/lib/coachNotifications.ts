import * as Notifications from "expo-notifications";
import { mirrorIdsFor, mirrorPlan } from "./coach";
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
//
// A locked phone runs none of this code, so a push that arrives then is only
// noticed when the app is next opened (see reconcilePresented). The server
// does not treat an unreported reminder as undelivered for that reason.

interface ReminderData {
  type?: string;
  reminderId?: string;
  taskId?: string;
  /** True for the phone's own backup copy, as opposed to a push from the server. */
  local?: boolean;
}

const dataOf = (n: Notifications.Notification): ReminderData =>
  (n.request.content.data ?? {}) as ReminderData;

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

/** Remove the phone's backup copies of a reminder, whatever time they were scheduled for. */
async function cancelLocalCopies(reminderId: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ids = mirrorIdsFor(
      reminderId,
      scheduled.map((n) => n.identifier),
    );
    for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Worst case the backup also shows; it is the same reminder.
  }
}

/**
 * Bring the phone's local backups in line with the server's upcoming
 * reminders: add what is missing, remove what is stale, and move any whose
 * time changed. Run on launch, when the app comes to the front, and after
 * anything that changes a task's date.
 */
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

/** A server push for a reminder is here: say so, and drop the backup so it is not shown twice. */
async function pushArrived(reminderId: string): Promise<void> {
  await cancelLocalCopies(reminderId);
  await reportDelivered(reminderId).catch(() => {});
}

/**
 * A notification arrived while the app is running. A local backup firing
 * proves nothing about push, so it is not reported.
 */
export async function onNotificationReceived(n: Notifications.Notification): Promise<void> {
  const data = dataOf(n);
  if (data.local) return;
  if (data.type === "test") {
    // The setup test: any delivery report marks notifications as working.
    await reportDelivered("test").catch(() => {});
    return;
  }
  if (data.type === "reminder" && data.reminderId) await pushArrived(data.reminderId);
}

/**
 * When the app comes to the front: pushes that arrived while it was not
 * running are still on screen. Report them and drop their backups now.
 */
export async function reconcilePresented(): Promise<void> {
  if (getCoachState().status !== "on") return;
  try {
    for (const n of await Notifications.getPresentedNotificationsAsync()) {
      const data = dataOf(n);
      if (data.local) continue;
      if (data.type === "test") await reportDelivered("test").catch(() => {});
      else if (data.type === "reminder" && data.reminderId) await pushArrived(data.reminderId);
    }
  } catch {
    // Nothing to reconcile, or the platform would not say.
  }
}

/**
 * The user tapped a notification. Returns the route to open, if it was ours.
 * Tapping counts as both received and answered.
 */
export async function onNotificationTapped(
  response: Notifications.NotificationResponse,
): Promise<string | null> {
  const data = dataOf(response.notification);
  if (data.type === "weekly_review") return "/coach/upnext";
  // A check-in is a question in the thread: open it there.
  if (data.type === "checkin") return "/chat";
  if (data.type === "test") {
    await reportDelivered("test").catch(() => {});
    return "/coach/setup";
  }
  if (data.type !== "reminder" || !data.reminderId) return null;
  await cancelLocalCopies(data.reminderId);
  if (!data.local) await reportDelivered(data.reminderId).catch(() => {});
  await ackReminder(data.reminderId).catch(() => {});
  return "/chat";
}
