import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Button from "../components/Button.jsx";
import Notice from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import Recaptcha from "../components/Recaptcha.jsx";

import GoogleIdentity from "../auth/GoogleIdentity.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { post } from "../auth/client.js";

const PASSWORD_MINIMUM = 8;
const PASSWORD_MAXIMUM = 128;

export default function AuthPages({ mode }) {
  const auth = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState({});
  const [emailToken, setEmailToken] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const captchaRef = useRef(null);
  const errorRef = useRef(null);
  const submittingRef = useRef(false);

  // A ref survives Strict Mode's effect setup/cleanup/setup cycle.
  // Do not overwrite its captured value after removing the URL fragment.
  const capturedLink = useRef({
    mode: null,
    token: ""
  });

  useEffect(() => {
    if (capturedLink.current.mode !== mode) {
      const parameters = new URLSearchParams(
        window.location.hash.replace(/^#/, "")
      );

      const candidate = parameters.get("token") || "";

      capturedLink.current = {
        mode,
        token: /^[a-f0-9]{64}$/.test(candidate)
          ? candidate
          : ""
      };
    }

    setEmailToken(capturedLink.current.token);

    // Remove the secret from the visible URL, but retain it in page memory.
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search
      );
    }
  }, [mode]);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  const isReset = mode === "recovery" && Boolean(emailToken);
  const requiresEmailToken = mode === "verify" || isReset;

  const titles = {
    login: "Welcome back.",
    register: "Create your patient account.",
    recovery: isReset
      ? "Choose a new password."
      : "A secure way back in.",
    verify: "Verify your email."
  };

  const fields = mode === "verify"
    ? []
    : isReset
      ? [
          {
            name: "newPassword",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            newPassword: true
          }
        ]
      : mode === "recovery"
        ? [
            {
              name: "email",
              label: "Email",
              type: "email",
              autoComplete: "email"
            }
          ]
        : [
            ...(mode === "register"
              ? [
                  {
                    name: "displayName",
                    label: "Display name",
                    type: "text",
                    autoComplete: "name",
                    optional: true
                  }
                ]
              : []),
            {
              name: "email",
              label: "Email",
              type: "email",
              autoComplete: "email"
            },
            {
              name: "password",
              label: "Password",
              type: "password",
              autoComplete:
                mode === "register"
                  ? "new-password"
                  : "current-password",
              newPassword: mode === "register"
            }
          ];

  const sessionReady = !auth.loading && !auth.error;
  const linkReady = !requiresEmailToken || Boolean(emailToken);

  const canSubmit =
    !busy &&
    sessionReady &&
    linkReady &&
    Boolean(captchaToken);

  let readinessMessage = "";

  if (busy) {
    readinessMessage = "Please wait. Your request is being processed.";
  } else if (auth.loading) {
    readinessMessage = "Connecting securely to account services…";
  } else if (auth.error) {
    readinessMessage =
      "Reconnect to account services using the retry button.";
  } else if (mode === "verify" && !emailToken) {
    readinessMessage =
      "Open the complete verification link from your latest email.";
  } else if (!captchaToken) {
    readinessMessage = "Complete the security check to continue.";
  } else {
    readinessMessage =
      mode === "verify"
        ? "Security check complete. You can verify your email."
        : "Security check complete. You can continue.";
  }

  function updateField(name, value) {
    setValues((current) => ({
      ...current,
      [name]: value
    }));

    setError("");
    setMessage("");
  }

  function validate() {
    if (!sessionReady) {
      return "Account services are not connected. Use the retry button.";
    }

    if (requiresEmailToken && !emailToken) {
      return "Open a valid link from your latest email.";
    }

    if (!captchaToken) {
      return "Complete the security check.";
    }

    if (mode !== "verify" && !isReset) {
      const email = (values.email || "").trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return "Enter a valid email address.";
      }
    }

    if (mode === "login" && !values.password) {
      return "Enter your password.";
    }

    if (mode === "register" || isReset) {
      const password = isReset
        ? values.newPassword || ""
        : values.password || "";

      if (
        password.length < PASSWORD_MINIMUM ||
        password.length > PASSWORD_MAXIMUM
      ) {
        return "Use a password containing 8–128 characters.";
      }
    }

    return "";
  }

  async function submit(event) {
    event.preventDefault();

    if (submittingRef.current) return;

    setError("");
    setMessage("");

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    submittingRef.current = true;
    setBusy(true);

    try {
      let endpoint;
      let body;

      if (mode === "verify") {
        // Compatible with the original verification endpoint supplied
        // before the repair script.
        endpoint = "/api/auth/verify-email";

        body = {
          token: capturedLink.current.token,
          captchaToken
        };
      } else if (isReset) {
        endpoint = "/api/auth/reset-password";

        body = {
          token: capturedLink.current.token,
          newPassword: values.newPassword,
          captchaToken
        };
      } else if (mode === "register") {
        endpoint = "/api/auth/register";

        body = {
          email: (values.email || "").trim(),
          password: values.password,
          displayName: (values.displayName || "").trim(),
          captchaToken
        };
      } else if (mode === "recovery") {
        endpoint = "/api/auth/recovery";

        body = {
          email: (values.email || "").trim(),
          captchaToken
        };
      } else {
        endpoint = "/api/auth/login";

        body = {
          email: (values.email || "").trim(),
          password: values.password,
          captchaToken
        };
      }

      const result = await post(endpoint, body);

      if (mode === "login") {
        const refreshed = await auth.refresh();

        if (!refreshed?.patient) {
          throw new Error(
            "Sign-in could not be verified. Please try again."
          );
        }

        const returnTo = new URLSearchParams(
          window.location.search
        ).get("returnTo");

        navigate(
          returnTo === "/request-an-appointment"
            ? returnTo
            : "/portal",
          { replace: true }
        );

        return;
      }

      setMessage(result.message || "Account action completed.");

      if (isReset) {
        await auth.refresh();
      }
    } catch (failure) {
      setError(
        failure.message ||
        "The operation could not be completed. Please try again."
      );

      if (
        failure.code === "SESSION_CHECK_FAILED" ||
        failure.code === "SESSION_REQUIRED"
      ) {
        await auth.refresh();
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);

      // reCAPTCHA tokens are single-use.
      setCaptchaToken("");
      captchaRef.current?.reset();
    }
  }

  const buttonLabel = busy
    ? "Please wait…"
    : mode === "login"
      ? "Sign in"
      : mode === "register"
        ? "Create account"
        : mode === "verify"
          ? "Verify email"
          : isReset
            ? "Update password"
            : "Request recovery instructions";

  return (
    <>
      <PageIntro
        eyebrow="Patient account"
        title={titles[mode]}
      >
        <p>
          Secure access to your own account and linked appointment
          information.
        </p>
      </PageIntro>

      <section className="section">
        <div className="container access-grid">
          <div className="access-card">
            {auth.error && (
              <div className="portal-block">
                <Notice title="Account connection unavailable">
                  {auth.error}
                </Notice>

                <div className="button-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={auth.refresh}
                  >
                    Retry account connection
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div
                className="error-summary"
                tabIndex="-1"
                ref={errorRef}
                role="alert"
              >
                <h3>Please check</h3>
                <p>{error}</p>

                {fields.map((field) => (
                  <a
                    key={field.name}
                    href={"#auth-" + field.name}
                    onClick={(event) => {
                      event.preventDefault();

                      document
                        .getElementById("auth-" + field.name)
                        ?.focus();
                    }}
                  >
                    Review {field.label.toLowerCase()}
                  </a>
                ))}

                <a href="#booking-captcha">
                  Review the security check
                </a>
              </div>
            )}

            <form noValidate onSubmit={submit}>
              {fields.map((field) => (
                <div className="field" key={field.name}>
                  <label htmlFor={"auth-" + field.name}>
                    {field.label}
                    {field.optional ? " (optional)" : " (required)"}
                  </label>

                  <input
                    id={"auth-" + field.name}
                    name={field.name}
                    type={field.type}
                    autoComplete={field.autoComplete}
                    required={!field.optional}
                    minLength={
                      field.newPassword
                        ? PASSWORD_MINIMUM
                        : undefined
                    }
                    maxLength={
                      field.type === "password"
                        ? PASSWORD_MAXIMUM
                        : field.name === "email"
                          ? 254
                          : 100
                    }
                    value={values[field.name] || ""}
                    onChange={(event) =>
                      updateField(field.name, event.target.value)
                    }
                    aria-describedby={
                      field.newPassword
                        ? "password-requirements"
                        : undefined
                    }
                  />
                </div>
              ))}

              {(mode === "register" || isReset) && (
                <p
                  id="password-requirements"
                  className="help"
                >
                  Use 8–128 characters. Password managers and paste
                  are supported.
                </p>
              )}

              {mode === "verify" && (
                <div className="portal-block">
                  <h2>Complete email verification</h2>

                  {emailToken ? (
                    <p>
                      Your verification link is loaded. Complete the
                      security check, then select Verify email.
                    </p>
                  ) : (
                    <p>
                      No valid verification link is loaded. Open the
                      complete link from your latest verification email.
                      Opening this page directly is not enough.
                    </p>
                  )}
                </div>
              )}

              <Recaptcha
                ref={captchaRef}
                onToken={(value) => {
                  setCaptchaToken(value || "");
                  setError("");
                }}
              />

              <p
                id="auth-readiness"
                className="help"
                role="status"
                aria-live="polite"
              >
                {readinessMessage}
              </p>

              <div className="button-row">
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  aria-describedby="auth-readiness"
                >
                  {buttonLabel}
                </Button>
              </div>

              <div
                role="status"
                aria-live="polite"
                className="outcome"
              >
                {message && (
                  <Notice title="Account update">
                    {message}

                    {(mode === "verify" || isReset) && (
                      <p>
                        <Link to="/portal/login">
                          Continue to sign in
                        </Link>
                      </p>
                    )}
                  </Notice>
                )}
              </div>
            </form>

            <div className="inline-links">
              <Link to="/portal/login">Sign in</Link>
              <Link to="/portal/register">Register</Link>
              <Link to="/portal/recovery">Account recovery</Link>
              <Link to="/privacy">Privacy information</Link>
            </div>

            {mode === "login" && (
              <GoogleIdentity
                onComplete={() =>
                  navigate("/portal", { replace: true })
                }
              />
            )}
          </div>

          <aside>
            <p className="eyebrow">Account access</p>
            <h2>Your account. Your information.</h2>

            <p className="section-copy">
              One account represents one patient. Email verification
              does not automatically link guest requests or another
              person’s records.
            </p>

            {auth.supportContact && (
              <p className="section-copy">
                {auth.supportContact}
              </p>
            )}
          </aside>
        </div>
      </section>
    </>
  );
}