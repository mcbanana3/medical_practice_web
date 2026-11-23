import { Link } from "react-router-dom";
import Icon from "./Icon.jsx";

export default function Button({
  to,
  children,
  variant = "primary",
  arrow = true,
  className = "",
  ...props
}) {
  const content = <>{children}{arrow && <Icon />}</>;
  const classes = `button button--${variant} ${className}`;

  return to
    ? <Link to={to} className={classes} {...props}>{content}</Link>
    : <button className={classes} {...props}>{content}</button>;
}