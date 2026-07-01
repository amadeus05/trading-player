import type { Dispatch, SetStateAction } from "react";
import type {
  FibonacciRetracement,
  FibonacciTrendExtension,
  ParallelChannel,
  Persisted,
  Rectangle,
  TrendLine,
  VolumeProfile,
} from "../../types";

export interface DrawingCollections {
  trendLines: TrendLine[];
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
};

const filterByDataset = <Item extends { datasetId: string }>(
  items: Item[],
  datasetId: string,
  keep: boolean,
): Item[] => items.filter((item) => (item.datasetId === datasetId) === keep);

const createCollectionMutations = <Key extends DrawingCollectionKey>(
  setState: Dispatch<SetStateAction<Persisted>>,
  key: Key,
): CollectionMutations<DrawingItem<Key>> => {
  const read = (state: Persisted) => (state[key] ?? []) as DrawingCollections[Key];
  const write = (state: Persisted, items: DrawingCollections[Key]) => ({
    ...state,
    [key]: items,
  }) as Persisted;

  return {
    onCreate: (item) => {
      setState((current) => write(current, [...read(current), item] as DrawingCollections[Key]));
    },
    onUpdate: (item) => {
      setState((current) => write(
        current,
        read(current).map((currentItem) => currentItem.id === item.id ? item : currentItem) as DrawingCollections[Key],
      ));
    },
    onDelete: (id) => {
      setState((current) => write(
        current,
        read(current).filter((item) => item.id !== id) as DrawingCollections[Key],
      ));
    },
  };
};

export function useDrawingCollections(
  setState: Dispatch<SetStateAction<Persisted>>,
): DrawingActions {
  return {
    trendLines: createCollectionMutations(setState, "trendLines"),
    rectangles: createCollectionMutations(setState, "rectangles"),
    fibonacciRetracements: createCollectionMutations(setState, "fibonacciRetracements"),
    fibonacciTrendExtensions: createCollectionMutations(setState, "fibonacciTrendExtensions"),
    parallelChannels: createCollectionMutations(setState, "parallelChannels"),
    volumeProfiles: createCollectionMutations(setState, "volumeProfiles"),
    deleteAllForDataset: (datasetId) => {
      setState((current) => ({
        ...current,
        trendLines: filterByDataset(current.trendLines ?? [], datasetId, false),
        rectangles: filterByDataset(current.rectangles ?? [], datasetId, false),
        fibonacciRetracements: filterByDataset(current.fibonacciRetracements ?? [], datasetId, false),
        fibonacciTrendExtensions: filterByDataset(current.fibonacciTrendExtensions ?? [], datasetId, false),
        parallelChannels: filterByDataset(current.parallelChannels ?? [], datasetId, false),
        volumeProfiles: filterByDataset(current.volumeProfiles ?? [], datasetId, false),
      }));
    },
  };
}

export function countDrawingsForDataset(collections: DrawingCollections, datasetId: string): number {
  const match = (item: { datasetId: string }) => item.datasetId === datasetId;
  return (
    collections.trendLines.filter(match).length
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
    rectangles: state.rectangles ?? [],
    fibonacciRetracements: state.fibonacciRetracements ?? [],
    fibonacciTrendExtensions: state.fibonacciTrendExtensions ?? [],
    parallelChannels: state.parallelChannels ?? [],
    volumeProfiles: state.volumeProfiles ?? [],
  };
}
