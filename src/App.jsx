import { useEffect, useRef } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import About from "./pages/About.jsx";
import Care from "./pages/Care.jsx";
import NewPatients from "./pages/NewPatients.jsx";
import Insurance from "./pages/Insurance.jsx";
import Contact from "./pages/Contact.jsx";
import Reviews from "./pages/Reviews.jsx";
import { ReceiptPreview } from "./pages/Booking.jsx";
import { ManageRequest } from "./pages/Access.jsx";
import Policies from "./pages/Policies.jsx";
import { Emergency, NotFound } from "./pages/Support.jsx";
import AuthPages from "./pages/AuthPages.jsx";
import Portal from "./pages/Portal.jsx";
import BookingEntry from "./pages/PatientBooking.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx";
import { approvedSchema, getSeo, socialMetadata } from "./site.js";

import "./portal.css";
import "./public-pages.css";

function PageEffects() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    const seo = getSeo(pathname);
    document.title = seo.title;
    document.querySelectorAll("[data-site-meta]").forEach((node) => node.remove());

    for (const [name, content] of [
      ["description", seo.description], ["robots", seo.robots]
    ]) {
      const meta = document.createElement("meta");
      meta.name = name;
      meta.content = content;
      meta.dataset.siteMeta = "";
      document.head.appendChild(meta);
    }

    if (seo.canonical) {
      const link = document.createElement("link");
      link.rel = "canonical";
      link.href = seo.canonical;
      link.dataset.siteMeta = "";
      document.head.appendChild(link);
    }

    for (const [name,content] of socialMetadata(seo)) {
      const meta=document.createElement("meta");
      meta.setAttribute(name.startsWith("og:")?"property":"name",name);
      meta.content=content;
      meta.dataset.siteMeta="";
      document.head.appendChild(meta);
    }
    const schema = approvedSchema(pathname);

    if (schema) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.siteMeta = "";
      script.textContent = JSON.stringify(schema).replace(/</g, "\\u003c");
      document.head.appendChild(script);
    }

    if (previous.current !== pathname) {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
    previous.current = pathname;
  }, [pathname]);

  return null;
}

const publicPage = (element) => <Layout>{element}</Layout>;

export default function App() {
  return (
    <AuthProvider>
      <div data-app="">
        <PageEffects />
        <Routes>
          <Route path="/" element={publicPage(<Home />)} />
          <Route path="/about" element={publicPage(<About />)} />
          <Route path="/care" element={publicPage(<Care />)} />
          <Route path="/new-patients" element={publicPage(<NewPatients />)} />
          <Route path="/insurance-fees" element={publicPage(<Insurance />)} />
          <Route path="/contact" element={publicPage(<Contact />)} />
          <Route path="/reviews" element={publicPage(<Reviews />)} />
          <Route path="/emergency" element={publicPage(<Emergency />)} />
          <Route path="/request-an-appointment" element={publicPage(<BookingEntry />)} />
          <Route path="/request-an-appointment/received" element={publicPage(<ReceiptPreview />)} />
          <Route path="/manage-request" element={publicPage(<ManageRequest />)} />

          {["login", "register", "recovery", "verify"].map((mode) => (
            <Route key={mode} path={`/portal/${mode}`}
              element={publicPage(<AuthPages key={mode} mode={mode} />)} />
          ))}

          <Route path="/portal/*" element={<Portal />} />
          <Route path="/portal" element={<Portal />} />

          {[
            "privacy", "privacy-practices", "terms", "accessibility",
            "nondiscrimination", "language-assistance"
          ].map((type) => (
            <Route key={type} path={`/${type}`}
              element={publicPage(<Policies type={type} />)} />
          ))}

          <Route path="*" element={publicPage(<NotFound />)} />
        </Routes>
      </div>
    </AuthProvider>
  );
}