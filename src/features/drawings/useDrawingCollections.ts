import type { Dispatch, SetStateAction } from "react";
import type {
  FibonacciRetracement,
  FibonacciTrendExtension,
  ParallelChannel,
  Persisted,
  Rectangle,
  TrendLine,
} from "../../types";

export function useDrawingCollections(
  setState: Dispatch<SetStateAction<Persisted>>,
) {
  const handleTrendLineCreate = (line: TrendLine) => {
    setState((current) => ({ ...current, trendLines: [...(current.trendLines ?? []), line] }));
  };
  const handleTrendLineUpdate = (line: TrendLine) => {
    setState((current) => ({
      ...current,
      trendLines: (current.trendLines ?? []).map((item) => item.id === line.id ? line : item),
    }));
  };
  const handleTrendLineDelete = (id: string) => {
    setState((current) => ({
      ...current,
      trendLines: (current.trendLines ?? []).filter((item) => item.id !== id),
    }));
  };

  const handleRectangleCreate = (rectangle: Rectangle) => {
    setState((current) => ({ ...current, rectangles: [...(current.rectangles ?? []), rectangle] }));
  };
  const handleRectangleUpdate = (rectangle: Rectangle) => {
    setState((current) => ({
      ...current,
      rectangles: (current.rectangles ?? []).map((item) => item.id === rectangle.id ? rectangle : item),
    }));
  };
  const handleRectangleDelete = (id: string) => {
    setState((current) => ({
      ...current,
      rectangles: (current.rectangles ?? []).filter((item) => item.id !== id),
    }));
  };

  const handleFibonacciCreate = (fibonacci: FibonacciRetracement) => {
    setState((current) => ({
      ...current,
      fibonacciRetracements: [...(current.fibonacciRetracements ?? []), fibonacci],
    }));
  };
  const handleFibonacciUpdate = (fibonacci: FibonacciRetracement) => {
    setState((current) => ({
      ...current,
      fibonacciRetracements: (current.fibonacciRetracements ?? []).map((item) => item.id === fibonacci.id ? fibonacci : item),
    }));
  };
  const handleFibonacciDelete = (id: string) => {
    setState((current) => ({
      ...current,
      fibonacciRetracements: (current.fibonacciRetracements ?? []).filter((item) => item.id !== id),
    }));
  };

  const handleFibonacciTrendExtensionCreate = (extension: FibonacciTrendExtension) => {
    setState((current) => ({
      ...current,
      fibonacciTrendExtensions: [...(current.fibonacciTrendExtensions ?? []), extension],
    }));
  };
  const handleFibonacciTrendExtensionUpdate = (extension: FibonacciTrendExtension) => {
    setState((current) => ({
      ...current,
      fibonacciTrendExtensions: (current.fibonacciTrendExtensions ?? []).map((item) => item.id === extension.id ? extension : item),
    }));
  };
  const handleFibonacciTrendExtensionDelete = (id: string) => {
    setState((current) => ({
      ...current,
      fibonacciTrendExtensions: (current.fibonacciTrendExtensions ?? []).filter((item) => item.id !== id),
    }));
  };

  const handleParallelChannelCreate = (channel: ParallelChannel) => {
    setState((current) => ({ ...current, parallelChannels: [...(current.parallelChannels ?? []), channel] }));
  };
  const handleParallelChannelUpdate = (channel: ParallelChannel) => {
    setState((current) => ({
      ...current,
      parallelChannels: (current.parallelChannels ?? []).map((item) => item.id === channel.id ? channel : item),
    }));
  };
  const handleParallelChannelDelete = (id: string) => {
    setState((current) => ({
      ...current,
      parallelChannels: (current.parallelChannels ?? []).filter((item) => item.id !== id),
    }));
  };

  return {
    handleFibonacciCreate,
    handleFibonacciDelete,
    handleFibonacciTrendExtensionCreate,
    handleFibonacciTrendExtensionDelete,
    handleFibonacciTrendExtensionUpdate,
    handleFibonacciUpdate,
    handleParallelChannelCreate,
    handleParallelChannelDelete,
    handleParallelChannelUpdate,
    handleRectangleCreate,
    handleRectangleDelete,
    handleRectangleUpdate,
    handleTrendLineCreate,
    handleTrendLineDelete,
    handleTrendLineUpdate,
  };
}
