import { useCallback, useEffect, useRef, useState } from "react";

export function useChartFullscreen() {
  const appRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const setFullscreenActive = useCallback((next: boolean) => {
    const root = appRef.current;
    if (!root) return;
    root.classList.toggle("app--chart-fullscreen", next);
    setActive(next);
  }, []);

  const toggleChartFullscreen = useCallback(async () => {
    const root = appRef.current;
    if (!root) return;

    const fullscreenRoot = document.fullscreenElement;
    const isActive = fullscreenRoot === root
      || fullscreenRoot === document.documentElement
      || root.classList.contains("app--chart-fullscreen");
    if (isActive) {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        setFullscreenActive(false);
      }
      return;
    }

    setFullscreenActive(true);
    try {
      // Вся страница приложения, включая header / сайдбар / тулбар.
      await root.requestFullscreen();
    } catch {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // Class-only fallback when Fullscreen API is blocked.
      }
    }
  }, [setFullscreenActive]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const root = appRef.current;
      if (!root) return;
      const fs = document.fullscreenElement;
      if (fs === root || fs === document.documentElement) {
        setFullscreenActive(true);
        return;
      }
      setFullscreenActive(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [setFullscreenActive]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F11") return;
      const target = event.target;
      if (target instanceof Element) {
        const tag = target.tagName;
        const editable = target instanceof HTMLElement && target.isContentEditable;
        if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
      }
      event.preventDefault();
      void toggleChartFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleChartFullscreen]);

  return { appRef, chartFullscreenActive: active, toggleChartFullscreen };
}
