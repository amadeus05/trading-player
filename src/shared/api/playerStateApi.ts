import type { Persisted } from "../../types";

export async function loadPlayerState(): Promise<Persisted> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`State loading failed: ${response.status}`);
  return response.json() as Promise<Persisted>;
}

export async function savePlayerState(state: Persisted): Promise<void> {
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(`State saving failed: ${response.status}`);
}
