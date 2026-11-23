import { useRef, useState } from "react";
import Button from "../components/Button.jsx";
import { post } from "./client.js";
import { useAuth } from "./AuthProvider.jsx";

let googleScript;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();

  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        googleScript = null;
        script.remove();
        reject(new Error("Google sign-in could not load."));
      };
      document.head.appendChild(script);
    });
  }

  return googleScript;
}

export default function GoogleIdentity({
  purpose = "signin", currentPassword = "", onComplete
}) {
  const auth = useAuth();
  const target = useRef(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!auth.googleClientId) return null;

  async function begin() {
    setBusy(true);
    setMessage("");

    try {
      const start = await post("/api/auth/google/start", { purpose });
      await loadGoogleIdentity();

      target.current.replaceChildren();

      window.google.accounts.id.initialize({
        client_id: start.clientId,
        nonce: start.nonce,
        auto_select: false,
        callback: async ({ credential }) => {
          try {
            await post("/api/auth/google/complete", {
              credential,
              ...(purpose === "link" ? { currentPassword } : {})
            });
            await auth.refresh();
            setMessage("Google identity action completed.");
            onComplete?.();
          } catch (error) {
            setMessage(error.message);
          }
        }
      });

      window.google.accounts.id.renderButton(target.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: 240
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-block">
      <h3>
        {purpose === "link"
          ? "Link Google"
          : purpose === "reauth"
            ? "Confirm your linked Google identity"
            : "Optional Google sign-in"}
      </h3>
      <p className="help">
        This connects to Google. An existing password account is not
        automatically merged by email.
      </p>
      <Button type="button" variant="outline" disabled={busy} onClick={begin}>
        {busy ? "Preparing Google sign-in…" : "Load Google sign-in"}
      </Button>
      <div ref={target} className="google-identity-target" />
      <p role="status">{message}</p>
    </section>
  );
}