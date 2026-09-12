import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NestFactory } from "@nestjs/core";
import { Module, Controller, All, Req, Res } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { doubleCsrf } from "csrf-csrf";
import { randomUUID, randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { config, db, ApiError } from "./db.js";
import { cookieName, cookieOptions } from "./auth.js";
import { handle } from "./application.js";
import { openApi } from "./openapi.js";
@Controller("api/v1")
class ApiController {
  @All("{*path}")
  async route(@Req() req: Request, @Res() res: Response) {
    const id = String(res.locals.requestId);
    try {
      const data = await handle(req, res, id);
      res.json({ data });
    } catch (e) {
      respondError(e, res, id);
    }
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
function respondError(e: unknown, res: Response, id: string) {
  if (e instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "راجع الحقول المطلوبة",
        fieldErrors: e.flatten().fieldErrors,
        requestId: id,
      },
    });
    return;
  }
  if (e instanceof ApiError) {
    res.status(e.status).json({
      error: {
        code: e.code,
        message: e.message,
        details: e.details,
        requestId: id,
      },
    });
    return;
  }
  const x = e as { code?: string; meta?: { code?: string }; status?: number };
  const unique = x.code === "P2002" || x.meta?.code === "23505";
  const unavailable = ["P1001", "P1002", "P2024"].includes(x.code || "");
  res.status(unique ? 409 : unavailable ? 503 : 500).json({
    error: {
      code: unique
        ? "DUPLICATE_RECORD"
        : unavailable
          ? "SERVICE_UNAVAILABLE"
          : "INTERNAL_ERROR",
      message: unique
        ? "الكود أو اسم المستخدم مستخدم بالفعل"
        : "تعذر تنفيذ العملية. أعد المحاولة",
      requestId: id,
    },
  });
  console.error(
    JSON.stringify({
      level: "error",
      requestId: id,
      code: x.code || "INTERNAL_ERROR",
    }),
  );
}
export async function start() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: true,
  });
  app.useBodyParser("json", { limit: "256kb" });
  const server = app.getHttpAdapter().getInstance();
  server.set(
    "trust proxy",
    config.TRUST_PROXY === "loopback" ? "loopback" : false,
  );
  server.disable("x-powered-by");
  app.use(helmet());
  app.use(cookieParser());
  const origins = config.ALLOWED_ORIGINS.split(",").map((x) => x.trim());
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    res.setHeader("Cache-Control", "no-store");
    const started = Date.now();
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          requestId: res.locals.requestId,
          method: req.method,
          route: req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id"),
          status: res.statusCode,
          duration: Date.now() - started,
        }),
      ),
    );
    next();
  });
  const csrf = doubleCsrf({
    getSecret: () => config.CSRF_SECRET,
    getSessionIdentifier: (req) =>
      req.cookies[cookieName] || req.cookies["csrf-bootstrap"] || "",
    cookieName: config.COOKIE_SECURE === "true" ? "__Host-csrf" : "sales-csrf",
    cookieOptions,
    getCsrfTokenFromRequest: (req) => req.get("X-CSRF-Token"),
  });
  server.get("/api/v1/auth/csrf", (req: Request, res: Response) => {
    if (!req.cookies[cookieName] && !req.cookies["csrf-bootstrap"]) {
      const nonce = randomBytes(32).toString("base64url");
      res.cookie("csrf-bootstrap", nonce, cookieOptions);
      req.cookies["csrf-bootstrap"] = nonce;
    }
    res.json({
      data: { token: csrf.generateCsrfToken(req, res, { overwrite: true }) },
    });
  });
  server.get("/api/v1/openapi.json", (_req: Request, res: Response) =>
    res.json(openApi),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (
      !origins.includes(req.get("Origin") || "") ||
      !req.is("application/json")
    )
      return respondError(
        new ApiError(
          403,
          "CSRF_INVALID",
          "مصدر الطلب أو نوع البيانات غير مسموح",
        ),
        res,
        res.locals.requestId,
      );
    csrf.doubleCsrfProtection(req, res, (err?: unknown) =>
      err
        ? respondError(
            new ApiError(
              403,
              "CSRF_INVALID",
              "انتهى رمز حماية الطلب. حدّث الصفحة",
            ),
            res,
            res.locals.requestId,
          )
        : next(),
    );
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, "127.0.0.1");
  const stop = async () => {
    await app.close();
    await db.$disconnect();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return app;
}
if (!process.env.API_NO_START)
  start().catch(() => {
    console.error(
      "API startup failed; check environment and database readiness.",
    );
    process.exitCode = 1;
  });
