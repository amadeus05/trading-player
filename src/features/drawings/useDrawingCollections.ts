import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  FibonacciRetracement,
  FibonacciTrendExtension,
  HorizontalLine,
  ParallelChannel,
  Persisted,
  Rectangle,
  TrendLine,
  VolumeProfile,
} from "../../types";

export interface DrawingCollections {
  trendLines: TrendLine[];
  horizontalLines: HorizontalLine[];
  rectangles: Rectangle[];
  fibonacciRetracements: FibonacciRetracement[];
  fibonacciTrendExtensions: FibonacciTrendExtension[];
  parallelChannels: ParallelChannel[];
  volumeProfiles: VolumeProfile[];
}

type DrawingCollectionKey = keyof DrawingCollections;
type DrawingItem<Key extends DrawingCollectionKey> = DrawingCollections[Key][number];

export interface CollectionMutations<Item extends { id: string }> {
  onCreate: (item: Item) => void;
  onUpdate: (item: Item) => void;
  onDelete: (id: string) => void;
}

export type DrawingActions = {
  [Key in DrawingCollectionKey]: CollectionMutations<DrawingItem<Key>>;
} & {
  deleteAllForDataset: (datasetId: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  restoreRevision: number;
};

const HISTORY_LIMIT = 80;
const HISTORY_MERGE_WINDOW_MS = 250;

const cloneCollections = (state: Persisted): DrawingCollections => ({
  trendLines: structuredClone(state.trendLines ?? []),
  horizontalLines: structuredClone(state.horizontalLines ?? []),
  rectangles: structuredClone(state.rectangles ?? []),
  fibonacciRetracements: structuredClone(state.fibonacciRetracements ?? []),
  fibonacciTrendExtensions: structuredClone(state.fibonacciTrendExtensions ?? []),
  parallelChannels: structuredClone(state.parallelChannels ?? []),
  volumeProfiles: structuredClone(state.volumeProfiles ?? []),
});

const applyCollections = (state: Persisted, collections: DrawingCollections): Persisted => ({
  ...state,
  trendLines: collections.trendLines,
  horizontalLines: collections.horizontalLines,
  rectangles: collections.rectangles,
  fibonacciRetracements: collections.fibonacciRetracements,
  fibonacciTrendExtensions: collections.fibonacciTrendExtensions,
  parallelChannels: collections.parallelChannels,
  volumeProfiles: collections.volumeProfiles,
});

const collectionsEqual = (a: DrawingCollections, b: DrawingCollections): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const appendHistoryState = (stack: DrawingCollections[], state: DrawingCollections): DrawingCollections[] => {
  const last = stack.at(-1);
  if (last && collectionsEqual(last, state)) return stack;
  return [...stack.slice(-(HISTORY_LIMIT - 1)), state];
};

const filterByDataset = <Item extends { datasetId: string }>(
  items: Item[],
  datasetId: string,
  keep: boolean,
): Item[] => items.filter((item) => (item.datasetId === datasetId) === keep);

const createCollectionMutations = <Key extends DrawingCollectionKey>(
  updateWithHistory: (recipe: (current: Persisted) => Persisted, historyKey?: string) => void,
  key: Key,
): CollectionMutations<DrawingItem<Key>> => {
  const read = (state: Persisted) => (state[key] ?? []) as DrawingCollections[Key];
  const write = (state: Persisted, items: DrawingCollections[Key]) => ({
    ...state,
    [key]: items,
  }) as Persisted;

  return {
    onCreate: (item) => {
      const nextItem = structuredClone(item) as DrawingItem<Key>;
      updateWithHistory((current) => write(current, [...read(current), nextItem] as DrawingCollections[Key]));
    },
    onUpdate: (item) => {
      const nextItem = structuredClone(item) as DrawingItem<Key>;
      updateWithHistory((current) => write(
        current,
        read(current).map((currentItem) => currentItem.id === nextItem.id ? nextItem : currentItem) as DrawingCollections[Key],
      ), `${key}:${item.id}:update`);
    },
    onDelete: (id) => {
      updateWithHistory((current) => write(
        current,
        read(current).filter((item) => item.id !== id) as DrawingCollections[Key],
      ));
    },
  };
};

export function useDrawingCollections(
  setState: Dispatch<SetStateAction<Persisted>>,
): DrawingActions {
  const undoStackRef = useRef<DrawingCollections[]>([]);
  const redoStackRef = useRef<DrawingCollections[]>([]);
  const lastHistoryKeyRef = useRef<string | null>(null);
  const lastHistoryAtRef = useRef(0);
  const [, setHistoryRevision] = useState(0);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const refreshHistoryState = useCallback(() => setHistoryRevision((current) => current + 1), []);

  const updateWithHistory = useCallback((recipe: (current: Persisted) => Persisted, historyKey?: string) => {
    setState((current) => {
      const previous = cloneCollections(current);
      const next = recipe(current);
      const nextCollections = cloneCollections(next);
      if (collectionsEqual(previous, nextCollections)) return current;
      const now = Date.now();
      const canMerge = historyKey
        && historyKey === lastHistoryKeyRef.current
        && now - lastHistoryAtRef.current < HISTORY_MERGE_WINDOW_MS
        && undoStackRef.current.length > 0;
      if (!canMerge) {
        undoStackRef.current = appendHistoryState(undoStackRef.current, previous);
      }
      lastHistoryKeyRef.current = historyKey ?? null;
      lastHistoryAtRef.current = now;
      redoStackRef.current = [];
      return next;
    });
    refreshHistoryState();
  }, [refreshHistoryState, setState]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    lastHistoryKeyRef.current = null;
    lastHistoryAtRef.current = 0;
    setState((current) => {
      redoStackRef.current = appendHistoryState(redoStackRef.current, cloneCollections(current));
      return applyCollections(current, previous);
    });
    setRestoreRevision((current) => current + 1);
    refreshHistoryState();
  }, [refreshHistoryState, setState]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.at(-1);
    if (!next) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    lastHistoryKeyRef.current = null;
    lastHistoryAtRef.current = 0;
    setState((current) => {
      undoStackRef.current = appendHistoryState(undoStackRef.current, cloneCollections(current));
      return applyCollections(current, next);
    });
    setRestoreRevision((current) => current + 1);
    refreshHistoryState();
  }, [refreshHistoryState, setState]);

  return {
    trendLines: createCollectionMutations(updateWithHistory, "trendLines"),
    horizontalLines: createCollectionMutations(updateWithHistory, "horizontalLines"),
    rectangles: createCollectionMutations(updateWithHistory, "rectangles"),
    fibonacciRetracements: createCollectionMutations(updateWithHistory, "fibonacciRetracements"),
    fibonacciTrendExtensions: createCollectionMutations(updateWithHistory, "fibonacciTrendExtensions"),
    parallelChannels: createCollectionMutations(updateWithHistory, "parallelChannels"),
    volumeProfiles: createCollectionMutations(updateWithHistory, "volumeProfiles"),
    deleteAllForDataset: (datasetId) => {
      updateWithHistory((current) => ({
        ...current,
        trendLines: filterByDataset(current.trendLines ?? [], datasetId, false),
        horizontalLines: filterByDataset(current.horizontalLines ?? [], datasetId, false),
        rectangles: filterByDataset(current.rectangles ?? [], datasetId, false),
        fibonacciRetracements: filterByDataset(current.fibonacciRetracements ?? [], datasetId, false),
        fibonacciTrendExtensions: filterByDataset(current.fibonacciTrendExtensions ?? [], datasetId, false),
        parallelChannels: filterByDataset(current.parallelChannels ?? [], datasetId, false),
        volumeProfiles: filterByDataset(current.volumeProfiles ?? [], datasetId, false),
      }));
    },
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    restoreRevision,
  };
}

export function countDrawingsForDataset(collections: DrawingCollections, datasetId: string): number {
  const match = (item: { datasetId: string }) => item.datasetId === datasetId;
  return (
    collections.trendLines.filter(match).length
    + collections.horizontalLines.filter(match).length
    + collections.rectangles.filter(match).length
    + collections.fibonacciRetracements.filter(match).length
    + collections.fibonacciTrendExtensions.filter(match).length
    + collections.parallelChannels.filter(match).length
    + collections.volumeProfiles.filter(match).length
  );
}

export function selectDrawingCollections(state: Persisted): DrawingCollections {
  return {
    trendLines: state.trendLines ?? [],
    horizontalLines: state.horizontalLines ?? [],
    rectangles: state.rectangles ?? [],
    fibonacciRetracements: state.fibonacciRetracements ?? [],
    fibonacciTrendExtensions: state.fibonacciTrendExtensions ?? [],
    parallelChannels: state.parallelChannels ?? [],
    volumeProfiles: state.volumeProfiles ?? [],
  };
}
