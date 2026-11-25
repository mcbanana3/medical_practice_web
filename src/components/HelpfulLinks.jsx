import { Link } from "react-router-dom";
import Icon from "./Icon.jsx";

export default function HelpfulLinks({ title = "Your next step, made simpler.", items }) {
  return <section className="section helpful-section"><div className="container">
    <div className="section-topline"><div><p className="eyebrow">Here to help</p><h2>{title}</h2></div></div>
    <div className="helpful-grid">{items.map(({ to, title: heading, text, icon = "arrow" }) =>
      <Link className="helpful-card" to={to} key={to}><span className="helpful-icon"><Icon name={icon} /></span><h3>{heading}</h3><p>{text}</p><span className="helpful-action">Explore <Icon /></span></Link>
    )}</div>
  </div></section>;
}
