
import { useEffect, useState } from "react";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import { practice } from "../content.js";

function googleUrl(value, embedded = false) {
  try {
    const url = new URL(value);

    const allowedHost = [
      "www.google.com",
      "google.com"
    ].includes(url.hostname);

    const allowedPath = embedded
      ? url.pathname.startsWith("/maps/embed")
      : url.pathname.startsWith("/maps/");

    return url.protocol === "https:" &&
      allowedHost &&
      allowedPath
        ? url.href
        : "";
  } catch {
    return "";
  }
}

export default function LocationMap() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [delayed, setDelayed] = useState(false);

  const embedUrl = googleUrl(practice.map?.embedUrl, true);
  const directionsUrl = googleUrl(practice.map?.directionsUrl);

  const verifiedAddress =
    Boolean(practice.address?.trim());

  const configured =
    practice.map?.verified === true &&
    verifiedAddress &&
    Boolean(embedUrl);

  useEffect(() => {
    if (!open || loaded) return undefined;

    const timer = window.setTimeout(
      () => setDelayed(true),
      12000
    );

    return () => window.clearTimeout(timer);
  }, [open, loaded]);

  return (
    <section
      className="google-map-panel"
      aria-label="Practice location map"
    >
      {open && configured ? (
        <div className="google-map-frame">
          <iframe
            title={`Google Maps location: ${practice.address}`}
            src={embedUrl}
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setLoaded(true)}
          />
        </div>
      ) : (
        <div className="google-map-cover">
          <div
            className="map-cover-lines"
            aria-hidden="true"
          />

          <span
            className="map-cover-pin"
            aria-hidden="true"
          >
            <Icon name="pin" />
          </span>

          <div className="map-cover-copy">
            <p className="eyebrow">Find the practice</p>

            <h3>
              {configured
                ? "Explore the location."
                : "Our Odessa practice location."}
            </h3>

            <p>
              {configured
                ? "Load the interactive Google map to explore the location."
                : "The interactive map will be available after location verification."}
            </p>
          </div>
        </div>
      )}

      <div className="google-map-details">
        <p className="small-label">Practice address</p>

        <p className="map-address">
          {practice.address}
        </p>

        {practice.map?.arrivalDirections && (
          <p>{practice.map.arrivalDirections}</p>
        )}

        <p className="help">
          Loading the map connects your browser to Google.
          Written location details remain available without
          loading the interactive map.
        </p>

        <div className="button-row">
          <Button
            type="button"
            variant="outline"
            disabled={!configured}
            arrow={false}
            onClick={() => {
              if (open) {
                setOpen(false);
              } else {
                setLoaded(false);
                setDelayed(false);
                setOpen(true);
              }
            }}
          >
            {open
              ? "Hide Google Maps"
              : configured
                ? "Load Google Maps"
                : "Map awaiting verification"}
          </Button>

          {configured && directionsUrl && (
            <a
              className="inline-link"
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get directions <Icon />
            </a>
          )}
        </div>

        <div role="status" className="map-status">
          {open && !loaded && (
            <p>
              {delayed
                ? "The map is taking longer than expected to load. You can use the written address instead."
                : "Loading Google Maps..."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}