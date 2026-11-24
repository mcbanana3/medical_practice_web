import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";

import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";

import "./styles.css";
import "./visual-refresh.css";

import App from "./App.jsx";
import StaffApp from "./staff/StaffApp.jsx";

function Root() {
  const { pathname } = useLocation();

  return /^\/staff(?:\/|$)/.test(pathname)
    ? <StaffApp />
    : <App />;
}

const container = document.getElementById("root");

const application = (
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
);

const privateStaffRoute =
  /^\/staff(?:\/|$)/.test(window.location.pathname);

if (!privateStaffRoute && container.querySelector("[data-app]")) {
  hydrateRoot(container, application);
} else {
  container.replaceChildren();
  createRoot(container).render(application);
}