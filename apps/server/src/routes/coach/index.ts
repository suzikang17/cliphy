import { Hono } from "hono";
import type { AppEnv } from "../../env.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCoach } from "../../middleware/require-coach.js";
import { chatRoutes } from "./chat.js";
import { intakeRoutes } from "./intake.js";
import { peopleRoutes } from "./people.js";
import { progressRoutes } from "./progress.js";
import { projectRoutes } from "./projects.js";
import { reminderRoutes } from "./reminders.js";
import { requestRoutes } from "./requests.js";
import { focusRoutes, healthRoutes, settingsRoutes } from "./settings.js";
import { ruleRoutes } from "./rules.js";
import { taskRoutes } from "./tasks.js";
import { upNextRoutes } from "./upnext.js";

/** Creative coach API. Every route needs auth and the per-account switch. */
export const coachRoutes = new Hono<AppEnv>();

coachRoutes.use("*", authMiddleware);
coachRoutes.use("*", requireCoach);

coachRoutes.route("/people", peopleRoutes);
coachRoutes.route("/projects", projectRoutes);
coachRoutes.route("/intake", intakeRoutes);
coachRoutes.route("/requests", requestRoutes);
coachRoutes.route("/tasks", taskRoutes);
coachRoutes.route("/reminders", reminderRoutes);
coachRoutes.route("/settings", settingsRoutes);
coachRoutes.route("/health", healthRoutes);
coachRoutes.route("/focus", focusRoutes);
coachRoutes.route("/chat", chatRoutes);
coachRoutes.route("/upnext", upNextRoutes);
coachRoutes.route("/rules", ruleRoutes);
coachRoutes.route("/progress", progressRoutes);
