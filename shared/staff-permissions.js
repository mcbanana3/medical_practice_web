// Both portals and the API use this policy. Route names never grant permissions.
const staff = ["read", "decide", "reviews_read", "reviews_moderate", "review_invite", "outcome", "patient_notes"];
const admin = [...staff, "patients", "medical", "availability", "link", "audit", "access", "settings"];
export const staffPermissions = Object.freeze({
  scheduler: Object.freeze([...staff]),
  clinician: Object.freeze([...staff]),
  administrator: Object.freeze(admin),
  auditor: Object.freeze(["audit"])
});
export const isAdministrator = session => Boolean(session?.grants?.some(g => g.role === "administrator"));
export const workspaceHome = session => isAdministrator(session) ? "/admin" : "/staff";
