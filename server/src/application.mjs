import express from "express";
import { config } from "./config.mjs";
import { createApp } from "./app.mjs";
import { patientRouter } from "./auth/routes.mjs";
import { createStaffRouter } from "./staff/index.mjs";
import { createPublicReviewsRouter } from "./reviews.mjs";

export function createApplication(dependencies = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.proxyHops);

  app.use("/api/public/reviews", createPublicReviewsRouter({
    captchaVerifier: dependencies.captchaVerifier
  }));
  app.use("/api/staff", createStaffRouter());
  app.use(patientRouter(dependencies));
  app.use(createApp(dependencies));

  return app;
}