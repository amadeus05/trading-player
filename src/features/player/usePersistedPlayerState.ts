import { useEffect, useRef, useState } from "react";
import type { Persisted } from "../../types";
import { loadPlayerState, savePlayerState } from "../../shared/api/playerStateApi";
import { DEFAULT_SIMULATION_SETTINGS, INITIAL_PLAYER_STATE } from "../../shared/config/simulation";

export function usePersistedPlayerState() {
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<Persisted>(INITIAL_PLAYER_STATE);
  const [initialDatasetId, setInitialDatasetId] = useState("");

  useEffect(() => {
    loadPlayerState()
      .then((loadedState) => {
        const datasets = (loadedState.datasets ?? []).filter((dataset) => dataset.id !== "demo");
        setState({
          ...loadedState,
          datasets,
          settings: { ...DEFAULT_SIMULATION_SETTINGS, ...loadedState.settings },
        });
        setInitialDatasetId(datasets[0]?.id ?? "");
      })
      .catch(() => undefined)
      .finally(() => {
        hydratedRef.current = true;
        setHydrated(true);
      });
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const timeoutId = window.setTimeout(() => {
      void savePlayerState(state).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [state]);

  return { state, setState, initialDatasetId, hydrated };
}
