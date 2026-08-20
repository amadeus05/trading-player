import { useEffect, useRef, useState } from "react";
import type { Persisted } from "../../types";
import { loadPlayerState, savePlayerState } from "../../shared/api/playerStateApi";
import { DEFAULT_ACCOUNT_SETTINGS, DEFAULT_SIMULATION_SETTINGS, DEFAULT_TIMEFRAME_MINUTES, INITIAL_PLAYER_STATE, isTimeframeOption } from "../../shared/config/simulation";

export function usePersistedPlayerState() {
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<Persisted>(INITIAL_PLAYER_STATE);
  const [initialDatasetId, setInitialDatasetId] = useState("");
  const [initialTimeframe, setInitialTimeframe] = useState(DEFAULT_TIMEFRAME_MINUTES);

  useEffect(() => {
    loadPlayerState()
      .then((loadedState) => {
        const datasets = (loadedState.datasets ?? []).filter((dataset) => dataset.id !== "demo");
        const savedTimeframe = loadedState.timeframeMinutes;
        setState({
          ...loadedState,
          datasets,
          settings: { ...DEFAULT_SIMULATION_SETTINGS, ...loadedState.settings },
          account: { ...DEFAULT_ACCOUNT_SETTINGS, ...loadedState.account },
        });
        setInitialDatasetId(loadedState.lastDatasetId ?? "");
        setInitialTimeframe(isTimeframeOption(savedTimeframe ?? NaN)
          ? savedTimeframe!
          : DEFAULT_TIMEFRAME_MINUTES);
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

  return { state, setState, initialDatasetId, initialTimeframe, hydrated };
}
