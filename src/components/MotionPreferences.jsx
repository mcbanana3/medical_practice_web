import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export default function MotionPreferences() {
  const { pathname } = useLocation();

  const [systemReduced, setSystemReduced] = useState(false);

  const active = !systemReduced;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = active ? "on" : "off";

    if (
      !active ||
      !("IntersectionObserver" in window) ||
      !("animate" in Element.prototype)
    ) {
      return undefined;
    }

    const animations = new Set();

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const animation = entry.target.animate(
          [
            { opacity: 0.8, transform: "translateY(16px)" },
            { opacity: 1, transform: "translateY(0)" }
          ],
          {
            duration: 550,
            easing: "cubic-bezier(.2,.65,.25,1)",
            fill: "none"
          }
        );

        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.12
    });

    document.querySelectorAll(
      "#main-content .section > .container > *"
    ).forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, [active, pathname]);

  return null;
}
