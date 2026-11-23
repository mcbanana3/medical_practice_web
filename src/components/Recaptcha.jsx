import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState
} from "react";
import Button from "./Button.jsx";

let scriptPromise;

function loadGoogle() {
  if (window.grecaptcha?.render) {
    return Promise.resolve(window.grecaptcha);
  }

  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.async = true;
      script.defer = true;

      script.onload = () => {
        window.grecaptcha.ready(() => resolve(window.grecaptcha));
      };

      script.onerror = () => {
        script.remove();
        scriptPromise = null;
        reject(new Error("Security service unavailable"));
      };

      document.head.appendChild(script);
    });
  }

  return scriptPromise;
}

const Recaptcha = forwardRef(function Recaptcha({ onToken }, ref) {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const host = useRef(null);
  const widget = useRef(null);
  const tokenHandler = useRef(onToken);
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  tokenHandler.current = onToken;

  function reset() {
    tokenHandler.current("");

    if (widget.current !== null && window.grecaptcha) {
      window.grecaptcha.reset(widget.current);
    }
  }

  useImperativeHandle(ref, () => ({ reset }));

  useEffect(() => {
    if (!enabled || !siteKey) return undefined;

    let active = true;
    setLoading(true);

    loadGoogle().then((google) => {
      if (!active || !host.current) return;

      if (widget.current === null) {
        widget.current = google.render(host.current, {
          sitekey: siteKey,
          size: "compact",
          callback: (token) => tokenHandler.current(token),
          "expired-callback": () => tokenHandler.current(""),
          "error-callback": () => {
            tokenHandler.current("");
            setError("The security check is unavailable. Retry or use verified support.");
          }
        });
      } else {
        google.reset(widget.current);
      }

      setLoading(false);
    }).catch(() => {
      if (active) {
        setLoading(false);
        setError("The security check could not load. Please retry.");
      }
    });

    return () => { active = false; };
  }, [enabled, attempt, siteKey]);

  return (
    <section
      id="booking-captcha"
      className="captcha-panel"
      tabIndex="-1"
      aria-label="Security verification"
    >
      <h3>Security check</h3>
      <p className="help">
        Loading this check connects to Google. Google’s privacy policy and
        terms apply. No appointment or contact fields are passed to this widget.
      </p>

      <div className="inline-links">
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          Google Privacy Policy — new tab
        </a>
        <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">
          Google Terms — new tab
        </a>
      </div>

      {!siteKey ? (
        <p className="field-error">The security check has not been configured.</p>
      ) : (
        <>
          {!enabled && (
            <Button type="button" variant="outline" onClick={() => setEnabled(true)}>
              Load security check
            </Button>
          )}

          <div ref={host} />

          <p role="status">{loading ? "Loading security check…" : ""}</p>

          {error && (
            <div>
              <p className="field-error" role="alert">{error}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError("");
                  reset();
                  setAttempt((value) => value + 1);
                }}
              >
                Retry security check
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
});

export default Recaptcha;