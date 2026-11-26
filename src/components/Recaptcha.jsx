import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState, useId
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

      const timer = window.setTimeout(() => {
        script.remove();
        scriptPromise = null;
        reject(new Error("Security service timed out"));
      }, 15000);
      script.onload = () => {
        if (!window.grecaptcha?.ready) {
          window.clearTimeout(timer);
          script.remove();
          scriptPromise = null;
          reject(new Error("Security service unavailable"));
          return;
        }
        window.grecaptcha.ready(() => {
          window.clearTimeout(timer);
          resolve(window.grecaptcha);
        });
      };

      script.onerror = () => {
        window.clearTimeout(timer);
        script.remove();
        scriptPromise = null;
        reject(new Error("Security service unavailable"));
      };

      document.head.appendChild(script);
    });
  }

  return scriptPromise;
}

const Recaptcha = forwardRef(function Recaptcha({ onToken, id, minimal = false }, ref) {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const host = useRef(null);
  const widget = useRef(null);
  const mounted = useRef(false);
  const tokenHandler = useRef(onToken);
  const uniqueId = useId();
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  tokenHandler.current = onToken;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function reset() {
    tokenHandler.current("");

    if (widget.current !== null && window.grecaptcha) {
      window.grecaptcha.reset(widget.current);
    }
  }

  useImperativeHandle(ref, () => ({ reset }));

  useEffect(() => {
    if (!siteKey || !started) return undefined;

    let active = true;
    setLoading(true);

    loadGoogle().then((google) => {
      if (!active || !host.current) return;

      if (widget.current === null) {
        widget.current = google.render(host.current, {
          sitekey: siteKey,
          size: "compact",
          callback: (token) => { if (mounted.current) tokenHandler.current(token); },
          "expired-callback": () => { if (mounted.current) tokenHandler.current(""); },
          "error-callback": () => {
            if (!mounted.current) return;
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
  }, [attempt, siteKey, started]);

  return (
    <section
      id={id || `security-${uniqueId}`}
      className={`captcha-panel${minimal ? " captcha-panel--minimal" : ""}`}
      tabIndex="-1"
      aria-label="Security verification"
    >
      <h3 className={minimal ? "sr-only" : undefined}>Security check</h3>
      {!minimal && <p className="help">
        Google verification loads only after you choose “I’m not a robot”. Then complete
        Google’s checkbox or challenge. Google’s privacy policy and terms apply.
      </p>}

      <div className="inline-links">
        {minimal && <span>Protected by Google reCAPTCHA.</span>}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          {minimal ? "Privacy" : "Google Privacy Policy — new tab"}
        </a>
        <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">
          {minimal ? "Terms" : "Google Terms — new tab"}
        </a>
      </div>

      {!siteKey ? (
        <p className="field-error">The security check has not been configured.</p>
      ) : (
        <>
          {!started && <div className="captcha-start"><button type="button" className="captcha-start-button" aria-controls={`captcha-widget-${uniqueId}`} onClick={() => { setStarted(true); setError(""); }}><span className="captcha-start-square" aria-hidden="true" />I’m not a robot</button><p className="help">Click to load Google’s verification, then complete its checkbox or challenge.</p></div>}
          <div id={`captcha-widget-${uniqueId}`} ref={host} className="captcha-widget" hidden={!started} aria-busy={loading} />

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