/** Mounts the ASCII wind on `scope` (and any `[data-ascii-wind]` inside it); returns a disposer. */
export function initAsciiWind2(scope?: Document | Element, variant?: "wind" | "capillary" | "estuary"): () => void;
