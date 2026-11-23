import express from "express";
import { config } from "./config.mjs";
import { createApp } from "./app.mjs";
import { patientRouter } from "./auth/routes.mjs";

export function createApplication(dependencies = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.proxyHops);

  app.use(patientRouter(dependencies));
  app.use(createApp(dependencies));

  return app;
}