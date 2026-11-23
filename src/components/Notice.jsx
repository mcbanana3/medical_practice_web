import Icon from "./Icon.jsx";
import { emergency } from "../site.js";

export default function Notice({ title, children, tone = "info" }) {
  return (
    <div className={`notice notice--${tone}`}>
      <Icon name={tone === "success" ? "check" : "info"} />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div className="notice-copy">{children}</div>}
      </div>
    </div>
  );
}

export function EmergencyNotice() {
  return (
    <aside className="emergency-notice" aria-label="Emergency information">
      <Icon name="info" />
      <p>{emergency}</p>
    </aside>
  );
}