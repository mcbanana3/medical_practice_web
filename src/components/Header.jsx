import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import Icon from "./Icon.jsx";
import MotionPreferences from "./MotionPreferences.jsx";
import { site } from "../site.js";


export function Brand() {
  return (
    <Link className="brand" to="/" aria-label={`${site.name} home`}>
      <img
        className="brand-icon"
        src="/favicon.svg"
        alt=""
        aria-hidden="true"
      />
      <span>{site.name}</span>
    </Link>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const toggle = useRef(null);

  useEffect(() => {
    setOpen(false);
    document.querySelectorAll(".site-nav details[open]")
      .forEach((element) => element.removeAttribute("open"));
  }, [pathname]);

  function escape(event) {
    if (event.key !== "Escape") return;

    event.currentTarget.querySelectorAll("details[open]")
      .forEach((element) => element.removeAttribute("open"));

    if (open) {
      setOpen(false);
      toggle.current?.focus();
    }
  }

  return (
    <header className="site-header" onKeyDown={escape}>
      {!site.publicationReady && (
        <div className="preview-banner">
          <div className="container">
            <strong>Website setup in progress</strong>
            <span>
              Practice facts require approval. Booking operates only when
              the configured booking service is enabled.
            </span>
          </div>
        </div>
      )}

      <MotionPreferences />

      <div className="container header-inner">
        <Brand />

        <button
          ref={toggle}
          className="menu-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="public-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? "Close" : "Menu"}
          <Icon name={open ? "close" : "menu"} />
        </button>

        <nav
          id="public-navigation"
          className={`site-nav ${open ? "is-open" : ""}`}
          aria-label="Main navigation"
          onClick={(event) => {
            if (event.target.closest("a")) setOpen(false);
          }}
        >
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/care">Care</NavLink>
          <NavLink to="/reviews">Reviews</NavLink>

          <details className="nav-group">
            <summary>Patient information <Icon name="chevron" /></summary>
            <div className="nav-dropdown">
              <NavLink to="/new-patients">New patients</NavLink>
              <NavLink to="/insurance-fees">Insurance and fees</NavLink>
            </div>
          </details>

          <NavLink to="/contact">Locations &amp; contact</NavLink>
          <Link to="/portal" className="portal-link">Patient portal</Link>
          <Link className="button button--primary" to="/request-an-appointment">
            Request an appointment
          </Link>
        </nav>
      </div>
    </header>
  );
}