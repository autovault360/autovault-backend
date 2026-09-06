import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env, assertRequiredEnv } from "./config/env.js";
import { connectDb } from "./lib/prisma.js";
import { errorHandler } from "./common/error-handler.js";
import { logger } from "./common/logger.js";
import { initSocket } from "./lib/socket.js";
import { authV1Routes, authLegacyRoutes } from "./modules/auth/auth.routes.js";
import dealershipRoutes from "./modules/dealerships/dealership.routes.js";
import {
  registrationRouter,
  checkoutRouter,
  webhookRouter,
} from "./modules/onboarding/onboarding.routes.js";
import {
  platformV1Routes,
  ownerLegacyRoutes,
} from "./modules/platform/owner.routes.js";
import {
  usersRouter,
  invitationsRouter,
  introRouter,
} from "./modules/users/users.routes.js";
import {
  vehiclesRouter,
  flooringPlansRouter,
  flooringRouter,
} from "./modules/vehicles/vehicles.routes.js";
import {
  customersRouter,
  leadsRouter,
} from "./modules/customers/customers.routes.js";
import vehicleDealRoutes, {
  soldVehiclesRouter,
} from "./modules/deals/deals.routes.js";
import jacketsRoutes from "./modules/jackets/jackets.routes.js";
import expensesRoutes from "./modules/expenses/expenses.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import {
  salesRepsRouter,
  staffRouter,
  commissionsRouter,
  payrollRunsRouter,
} from "./modules/payroll/payroll.routes.js";
import taxRoutes from "./modules/tax/tax.routes.js";
import dashboardRoutes, {
  auditLogsRouter,
} from "./modules/dashboard/dashboard.routes.js";
import searchRoutes from "./modules/search/search.routes.js";
import notificationsRoutes from "./modules/notifications/notifications.routes.js";
import cpaRoutes from "./modules/cpa/cpa.routes.js";
import wholesaleRoutes from "./modules/wholesale/wholesale.routes.js";
import calendarRoutes from "./modules/calendar/calendar.routes.js";
import dashboardNotesRoutes from "./modules/dashboard-notes/dashboard-notes.routes.js";
import messagesRoutes from "./modules/messages/messages.routes.js";
import filesRoutes from "./modules/files/files.routes.js";
import jennaRoutes from "./modules/jenna/jenna.routes.js";
import billingRoutes from "./modules/billing/billing.routes.js";
import { contactRouter } from "./modules/contact/contact.routes.js";
import { supportRouter } from "./modules/support/support.routes.js";
import { runTaxReminders } from "./jobs/tax-reminders.js";
import { runBillingReminders } from "./jobs/billing-reminders.js";
import { runMessageJobs } from "./jobs/messages.js";

assertRequiredEnv();

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://www.autovault360.com",
  "https://autovault360.com",
]);
try {
  const frontendOrigin = new URL(env.FRONTEND_URL).origin;
  allowedOrigins.add(frontendOrigin);
} catch {
  // ignored
}

function isDevLanOrigin(origin) {
  if (env.NODE_ENV === "production") return false;
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

app.use(
  "/api/webhooks",
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  webhookRouter,
);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      if (isDevLanOrigin(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.NODE_ENV === "production" ? 250 : 3000,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/", (_req, res) => {
  res.json({
    message: "AutoVault backend running",
    version: "2.0.0",
    timestamp: Date.now(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "2.0.0" });
});

app.get("/api/v1/jobs/tax-reminders", async (_req, res, next) => {
  try {
    const key = _req.headers["x-cron-key"] || _req.query.key;
    if (key !== env.OWNER_API_KEY) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const result = await runTaxReminders();
    return res.json({ ok: true, result });
  } catch (err) {
    return next(err);
  }
});

app.get("/api/v1/jobs/billing-reminders", async (_req, res, next) => {
  try {
    const key = _req.headers["x-cron-key"] || _req.query.key;
    if (key !== env.OWNER_API_KEY) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const result = await runBillingReminders();
    return res.json({ ok: true, result });
  } catch (err) {
    return next(err);
  }
});

app.get("/api/v1/jobs/messages", async (_req, res, next) => {
  try {
    const key = _req.headers["x-cron-key"] || _req.query.key;
    if (key !== env.OWNER_API_KEY) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const result = await runMessageJobs();
    return res.json({ ok: true, result });
  } catch (err) {
    return next(err);
  }
});

app.use("/api/v1/auth", authV1Routes);
app.use("/api/v1/dealerships", dealershipRoutes);
app.use("/api/v1/users", introRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/invitations", invitationsRouter);
app.use("/api/v1/vehicles", vehiclesRouter);
app.use("/api/v1/vehicles", vehicleDealRoutes);
app.use("/api/v1/sold-vehicles", soldVehiclesRouter);
app.use("/api/v1/deal-jackets", jacketsRoutes);
app.use("/api/v1/expenses", expensesRoutes);
app.use("/api/v1/reports", reportsRoutes);
app.use("/api/v1/sales-reps", salesRepsRouter);
app.use("/api/v1/staff", staffRouter);
app.use("/api/v1/commissions", commissionsRouter);
app.use("/api/v1/payroll-runs", payrollRunsRouter);
app.use("/api/v1/tax", taxRoutes);
app.use("/api/v1/flooring-plans", flooringPlansRouter);
app.use("/api/v1/flooring", flooringRouter);
app.use("/api/v1/customers", customersRouter);
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/audit-logs", auditLogsRouter);
app.use("/api/v1/notifications", notificationsRoutes);
app.use("/api/v1/cpa", cpaRoutes);
app.use("/api/v1/wholesale", wholesaleRoutes);
app.use("/api/v1/calendar", calendarRoutes);
app.use("/api/v1/dashboard/notes", dashboardNotesRoutes);
app.use("/api/v1/messages", messagesRoutes);
app.use("/api/v1/files", filesRoutes);
app.use("/api/v1/jenna", jennaRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/registrations", registrationRouter);
app.use("/api/v1/checkout", checkoutRouter);
app.use("/api/v1/contact", contactRouter);
app.use("/api/v1/support", supportRouter);
app.use("/api/v1/platform", platformV1Routes);

app.use("/api/registrations", registrationRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/contact", contactRouter);
app.use("/api/owner", ownerLegacyRoutes);
app.use("/api/auth", authLegacyRoutes);

app.use(errorHandler);

export async function startServer() {
  await connectDb();
  const httpServer = http.createServer(app);
  initSocket(httpServer);
  const port = env.PORT || 3000;
  httpServer.listen(port, "0.0.0.0", () => {
    // console so PM2 out logs always show something even if pino is quiet
    console.log(`[server] running on port ${port}`);
    logger.info(`[server] running on port ${port}`);
  });
}

// Always listen unless explicitly skipped (tests). Do NOT gate on argv vs import.meta.url —
// PM2/nodemon path forms differ and skipping listen makes Node exit 0 → restart loop.
const skipListen =
  process.env.SKIP_SERVER_LISTEN === "1" ||
  process.env.VITEST === "true" ||
  process.env.NODE_ENV === "test";

if (!skipListen) {
  console.log("[server] starting...");
  startServer().catch((error) => {
    console.error("[server] failed to start:", error);
    process.exit(1);
  });
}

export default app;
