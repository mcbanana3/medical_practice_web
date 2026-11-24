import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const changes = new Map();

async function read(relative) {
    const source = await fs.readFile(
        path.join(root, relative),
        "utf8"
    );
    return source.replace(/\r\n?/g, "\n");
}

function replaceRequired(source, pattern, replacement, label) {
    if (!pattern.test(source)) {
        throw new Error(`Integration stopped: ${label} was not found. No files have been written.`);
    }
    return source.replace(pattern, replacement);
}

try {
    for (const file of [
        "server/src/staff/local-settings.mjs",
        "server/src/staff/passwords.mjs",
        "server/src/staff/local-accounts.mjs",
        "src/staff/LocalAuth.jsx"
    ]) await read(file);

    const client = await read("src/staff/client.js");
    if (!client.includes("export async function publicPost")) {
        throw new Error("Save the replacement src/staff/client.js first.");
    }

    let auth = await read("server/src/staff/auth.mjs");
    if (!auth.includes('from "./local-settings.mjs"')) {
        throw new Error("Save the replacement staff auth.mjs first.");
    }

    // Repeated anonymous reset requests must not repeatedly invalidate
    // a valid reset link or flood one account's mailbox.
    if (!auth.includes("LOCAL_RESET_COOLDOWN")) {
        auth = replaceRequired(
            auth,
            /  const raw = randomSecret\(\), id = newId\(\);/,
            `  // LOCAL_RESET_COOLDOWN
  if (purpose === "reset") {
    const [recent] = await query(
      \`SELECT id FROM staff_local_tokens
       WHERE subject=? AND purpose='reset' AND auth_version=?
         AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
         AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)
       LIMIT 1\`,
      [user.subject, user.auth_version], c
    );
    if (recent) return;
  }
  const raw = randomSecret(), id = newId();`,
            "reset-token generation"
        );
    }
    changes.set("server/src/staff/auth.mjs", auth);

    let index = await read("server/src/staff/index.mjs");
    if (!index.includes("./local-accounts.mjs")) {
        index = 'import { mountLocalAccounts } from "./local-accounts.mjs";\n' + index;
    }
    if (!index.includes("mountLocalAccounts({")) {
        index = replaceRequired(
            index,
            /mountManagement\(\{\s*add,\s*need,\s*scoped,\s*scopeSQL\s*\}\);/,
            "mountLocalAccounts({ add, need, scopeSQL });\n  mountManagement({ add, need, scoped, scopeSQL });",
            "staff management registration"
        );
    }
    changes.set("server/src/staff/index.mjs", index);

    let management = await read("server/src/staff/management.mjs");
    const accessStart = management.indexOf('  add("get", "/access",');
    if (accessStart !== -1) {
        const auditStart = management.indexOf('  add("get", "/audit",', accessStart);
        if (auditStart === -1) throw new Error("Cannot locate the legacy access-handler boundary.");
        management = management.slice(0, accessStart) + management.slice(auditStart);
    }
    changes.set("server/src/staff/management.mjs", management);

    // Retire the old bearer verifier even if an older router is mounted
    // accidentally. Keep its export for compatibility with old imports.
    let security = await read("server/src/security.mjs");
    const oldVerifier = security.indexOf("const jwks = config.oidcJwks");
    if (oldVerifier !== -1) {
        const nextFunction = security.indexOf("export function requireStaff(", oldVerifier);
        if (nextFunction === -1) throw new Error("Cannot locate the legacy staff verifier boundary.");
        security = security.slice(0, oldVerifier) +
            `export async function verifyStaff() {
  throw new SafeError(
    401, "STAFF_SESSION_REQUIRED", "Use the staff sign-in page."
  );
}

` + security.slice(nextFunction);
        security = security.replace(
            /^import\s*\{\s*createRemoteJWKSet,\s*jwtVerify\s*\}\s*from\s*["']jose["'];?\r?\n/m,
            ""
        );
    }
    changes.set("server/src/security.mjs", security);

    let app = await read("src/staff/StaffApp.jsx");
    if (!app.includes("./LocalAuth.jsx")) {
        app = `import {
  LocalAuthPage, LocalAccount, LocalAccess, isLocalAuthPath
} from "./LocalAuth.jsx";\n` + app;
    }

    if (!app.includes("<LocalAccess")) {
        app = replaceRequired(
            app,
            /<Gate permission="access">\s*<Access\s*\/>\s*<\/Gate>/,
            '<Gate permission="access"><LocalAccess /></Gate>',
            "staff access page"
        );
    }
    if (!app.includes("<LocalAccount")) {
        app = replaceRequired(
            app,
            /element=\{<Account\s*\/>\}/,
            "element={<><Account /><LocalAccount /></>}",
            "staff account page"
        );
    }

    // The old OIDC-oriented Access component is no longer used.
    const accessComponent = app.indexOf("function Access() {");
    if (accessComponent !== -1) {
        const accountComponent = app.indexOf("function Account() {", accessComponent);
        if (accountComponent === -1) throw new Error("Cannot locate the old Access component boundary.");
        app = app.slice(0, accessComponent) + app.slice(accountComponent);
    }

    if (!app.includes("isLocalAuthPath(location.pathname)")) {
        app = replaceRequired(
            app,
            /  if \(loading\) \{/,
            `  if (isLocalAuthPath(location.pathname)) {
    content = <LocalAuthPage
      key={location.pathname}
      signedIn={Boolean(session?.configured)}
      onLogin={async () => {
        setLoading(true);
        await checkSession(false, true);
      }}
    />;
  } else if (loading) {`,
            "staff authentication screen dispatch"
        );
    }

    const anonymousScreen =
        /(^[ \t]*)\}\s*else\s+if\s*\(!session\)\s*\{[\s\S]*?^\1\}\s*else\s*\{\s*(?=content\s*=\s*<Workspace\b)/m;

    if (!anonymousScreen.test(app)) {
        throw new Error(
            "Cannot locate the anonymous staff screen boundary."
        );
    }

    app = app.replace(
        anonymousScreen,
        (_matched, indent) =>
            `${indent}} else if (!session) {\n` +
            `${indent}  content = <Navigate replace to="/staff/login" />;\n` +
            `${indent}} else {\n` +
            `${indent}  `
    );

    app = app.replace(
        /setSession\(null\);\s*setLoading\(false\);/,
        "setSession(null);\n    setError(null);\n    setLoading(false);"
    ).replace(
        "The staff identity provider and explicit resource grants must be configured before use.",
        "Enable local staff access and create the first administrator before use."
    ).replace(
        /  const loginFailure =\s*new URLSearchParams\(location\.search\)\.get\("error"\) === "signin";\s*/,
        ""
    );
    changes.set("src/staff/StaffApp.jsx", app);

    let ui = await read("src/staff/ui.jsx");
    ui = ui.replace(
        '"read", "decide", "patients", "availability", "link", "outcome"',
        '"read", "decide", "patients", "availability", "link", "outcome", "reviews_read"'
    ).replace(
        'administrator: [...operational, "audit", "access"]',
        'administrator: [...operational, "audit", "access", "settings"]'
    );
    changes.set("src/staff/ui.jsx", ui);

    const application = await read("server/src/application.mjs");
    const staffMount = application.indexOf('app.use("/api/staff", createStaffRouter())');
    const patientMount = application.indexOf("app.use(patientRouter");
    const publicMount = application.indexOf("app.use(createApp");
    if (
        staffMount < 0 || patientMount < 0 || publicMount < 0 ||
        staffMount > patientMount || staffMount > publicMount
    ) throw new Error("The staff namespace must mount before patient and legacy routers.");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupRoot = path.join(root, ".local-staff-backup-" + stamp);

    // Validate and compute everything before writing anything.
    for (const relative of changes.keys()) {
        const backup = path.join(backupRoot, relative);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(path.join(root, relative), backup);
    }
    for (const [relative, source] of changes) {
        await fs.writeFile(path.join(root, relative), source);
        console.log("Updated " + relative);
    }
    console.log("\nSource backup: " + path.basename(backupRoot));
    console.log("Integration complete. Apply migration 008 and create the initial administrator.");
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}