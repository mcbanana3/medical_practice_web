import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import App from "./App.jsx";

export {
  pages,
  site,
  getSeo,
  sitemapPages,
  approvedSchema,
  escapeHtml,
  validSiteUrl
} from "./site.js";

export function render(path) {
  return renderToString(
    <StaticRouter location={path}>
      <App />
    </StaticRouter>
  );
}