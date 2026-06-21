import { useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Divider,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
} from "lightweight-charts";
import Papa from "papaparse";
import dayjs from "dayjs";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  CircleHelp,
  Crosshair,
  Dices,
  Download,
  Pause,
  Play,
  Flag,
  RotateCcw,
  Settings,
  Trash2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import type { Barrier, Candle, Persisted, SimulationSettings, Trade } from "./types";
import { HistoryManager } from "./HistoryManager";
import { IntrabarExitResolver } from "./simulation/IntrabarExitResolver";
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const dt = (t: number) =>
  new Date(t * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const formatMarketPair = (name?: string) => {
  if (!name) return "Нет данных";
  const symbol = name.split(/[·\s]/)[0].toUpperCase();
  const quote = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"].find(
    (value) => symbol.endsWith(value) && symbol.length > value.length,
  );
  return quote ? `${symbol.slice(0, -quote.length)} / ${quote}` : symbol;
};
const formatTimeframe = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : minutes === 1440 ? "1d" : `${minutes / 60}h`;
const decimalPlaces = (value: number) => {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
};
const inferPricePrecision = (candles: Candle[]) => {
  let precision = 2;
  const step = Math.max(1, Math.floor(candles.length / 4000));
  for (let i = 0; i < candles.length; i += step) {
    precision = Math.max(precision, decimalPlaces(candles[i].open), decimalPlaces(candles[i].high), decimalPlaces(candles[i].low), decimalPlaces(candles[i].close));
  }
  return Math.min(10, precision);
};
const formatPrice = (value: number, precision: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
const PAPER_BALANCE_USDT = 1000;
const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  makerFeePct: 0.02,
  takerFeePct: 0.055,
  slippagePct: 0.02,
  stopSlippagePct: 0.05,
  showClosedTradeOverlays: true,
};
const initial: Persisted = {
  datasets: [],
  trades: [],
  annotations: [],
  settings: DEFAULT_SIMULATION_SETTINGS,
};
const intrabarExitResolver = new IntrabarExitResolver();
function aggregate(xs: Candle[], min: number) {
  const s = min * 60,
    m = new Map<number, Candle>();
  xs.forEach((c) => {
    const t = Math.floor(c.time / s) * s,
      q = m.get(t);
    if (!q) m.set(t, { ...c, time: t });
    else {
      q.high = Math.max(q.high, c.high);
      q.low = Math.min(q.low, c.low);
      q.close = c.close;
      q.volume += c.volume;
    }
  });
  return [...m.values()];
}
function Chart({
  candles,
  index,
  barriers,
  trades,
  onBarrierChange,
  selectingStart,
  onStartSelected,
  focusRevision,
  onInteractionChange,
  pricePrecision,
  entryMarker,
  onEntryMarkerChange,
  showClosedTradeOverlays,
}: {
  candles: Candle[];
  index: number;
  barriers: Barrier[];
  trades: Trade[];
  onBarrierChange: (id: string, kind: "tp" | "sl", price: number) => void;
  selectingStart: boolean;
  onStartSelected: (time: number) => void;
  focusRevision: number;
  onInteractionChange: (active: boolean) => void;
  pricePrecision: number;
  entryMarker?: { id: string; price: number };
  onEntryMarkerChange: (id: string, price: number) => void;
  showClosedTradeOverlays: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedLogicalRange = useRef<any>(null);
  const renderedIndex = useRef<number | null>(null);
  const followRealtime = useRef(true);
  const savedPriceRange = useRef<{from:number;to:number}|null>(null);
  const manualPriceScale = useRef(false);
  const appliedFocusRevision = useRef(focusRevision);
  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const safeIndex = Math.max(0, Math.min(index, candles.length - 1));
    const visible = candles.slice(0, safeIndex + 1);
    const forceFocus = appliedFocusRevision.current !== focusRevision;
    if (forceFocus) {
      manualPriceScale.current = false;
      savedPriceRange.current = null;
    }
    if (!visible.length) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: "#0d0f15" }, textColor: "#7f8494" },
      grid: {
        vertLines: { color: "#171a22" },
        horzLines: { color: "#171a22" },
      },
      rightPriceScale: { borderColor: "#232632" },
      timeScale: { borderColor: "#232632", timeVisible: true },
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#2bd9a8",
      downColor: "#ff5c73",
      wickUpColor: "#2bd9a8",
      wickDownColor: "#ff5c73",
      borderVisible: false,
      priceFormat: { type: "price", precision: pricePrecision, minMove: 10 ** -pricePrecision },
    });
    cs.setData(visible as any);
    if (manualPriceScale.current && savedPriceRange.current) {
      cs.priceScale().setVisibleRange(savedPriceRange.current);
    }
    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vs.setData(
      visible.map((c) => ({
        time: c.time as any,
        value: c.volume,
        color: c.close >= c.open ? "#2bd9a855" : "#ff5c7355",
      })),
    );
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.classList.add("closed-trades-overlay");
    ref.current.appendChild(overlay);
    const closedTradeShapes = (showClosedTradeOverlays ? trades : [])
      .filter((trade) => trade.status === "CLOSED" && trade.exitTime != null && trade.exit != null)
      .map((trade) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const target = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const risk = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const exitPath = document.createElementNS("http://www.w3.org/2000/svg", "line");
        target.setAttribute("class", "trade-zone target");
        risk.setAttribute("class", "trade-zone risk");
        exitPath.setAttribute("class", "trade-exit-path");
        group.append(target, risk, exitPath);
        overlay.appendChild(group);
        return { trade, group, target, risk, exitPath };
      });
    const candleIndexAt = (time: number) => {
      let low = 0, high = visible.length - 1, found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (visible[middle].time <= time) { found = middle; low = middle + 1; }
        else high = middle - 1;
      }
      return found;
    };
    const setRect = (rect: SVGRectElement, x1: number, x2: number, y1: number, y2: number) => {
      rect.setAttribute("x", String(Math.min(x1, x2)));
      rect.setAttribute("y", String(Math.min(y1, y2)));
      rect.setAttribute("width", String(Math.max(6, Math.abs(x2 - x1))));
      rect.setAttribute("height", String(Math.max(1, Math.abs(y2 - y1))));
    };
    const syncClosedTradeOverlays = () => {
      closedTradeShapes.forEach(({ trade, group, target, risk, exitPath }) => {
        if (trade.entryTime < visible[0].time || trade.exitTime! > visible.at(-1)!.time) {
          group.setAttribute("visibility", "hidden");
          return;
        }
        const entryIndex = candleIndexAt(trade.entryTime);
        const exitIndex = candleIndexAt(trade.exitTime!);
        const x1 = entryIndex >= 0 ? chart.timeScale().logicalToCoordinate(entryIndex as any) : null;
        const x2raw = exitIndex >= 0 ? chart.timeScale().logicalToCoordinate(exitIndex as any) : null;
        const entryY = cs.priceToCoordinate(trade.entry);
        const tpY = cs.priceToCoordinate(trade.tp);
        const slY = cs.priceToCoordinate(trade.sl);
        const exitY = cs.priceToCoordinate(trade.exit!);
        if ([x1, x2raw, entryY, tpY, slY, exitY].some((value) => value == null)) {
          group.setAttribute("visibility", "hidden");
          return;
        }
        group.setAttribute("visibility", "visible");
        const x2 = Math.max(x1! + 6, x2raw!);
        setRect(target, x1!, x2, entryY!, tpY!);
        setRect(risk, x1!, x2, entryY!, slY!);
        exitPath.setAttribute("x1", String(x1));
        exitPath.setAttribute("y1", String(entryY));
        exitPath.setAttribute("x2", String(x2raw));
        exitPath.setAttribute("y2", String(exitY));
      });
    };
    const handles: HTMLButtonElement[] = [];
    const removablePriceLines: any[] = [];
    const handlePositions: Array<{ handle: HTMLButtonElement; price: () => number }> = [];
    barriers.forEach((b) => {
      const trade = trades.find((t) => t.id === b.id);
      if (!trade) return;
      (["tp", "sl"] as const).forEach((kind) => {
        const color = kind === "tp" ? "#2bd9a8" : "#ff5c73";
        const initialPrice = trade[kind];
        let displayedPrice = initialPrice;
        const line = cs.createPriceLine({
          price: initialPrice,
          color,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
          title: "",
        });
        const handle = document.createElement("button");
        handle.className = `barrier-handle ${kind}`;
        handle.textContent = `${kind.toUpperCase()} ${initialPrice.toFixed(pricePrecision)}`;
        ref.current!.appendChild(handle);
        handles.push(handle);
        handlePositions.push({ handle, price: () => displayedPrice });
        const place = (price: number) => {
          const y = cs.priceToCoordinate(price);
          if (y !== null) handle.style.top = `${y}px`;
        };
        requestAnimationFrame(() => place(initialPrice));
        handle.onpointerdown = (event) => {
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          let currentPrice = displayedPrice;
          const move = (e: PointerEvent) => {
            const bounds = ref.current!.getBoundingClientRect();
            const price = cs.coordinateToPrice(e.clientY - bounds.top);
            if (price === null || price <= 0) return;
            currentPrice = price;
            displayedPrice = price;
            line.applyOptions({ price });
            handle.textContent = `${kind.toUpperCase()} ${price.toFixed(pricePrecision)}`;
            place(price);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            onBarrierChange(b.id, kind, currentPrice);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up, { once: true });
        };
      });
      /* Static upper/lower values remain in the annotation and are updated
         together with the trade when a handle is released. */
      /*
      cs.createPriceLine({
        price: b.upper,
        color: "#2bd9a8",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "TP / upper",
      });
      cs.createPriceLine({
        price: b.lower,
        color: "#ff5c73",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "SL / lower",
      });
      */
    });
    if (entryMarker) {
      let displayedPrice = entryMarker.price;
      const line = cs.createPriceLine({ price: displayedPrice, color: "#9b8cff", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      removablePriceLines.push(line);
      const handle = document.createElement("button");
      handle.className = "barrier-handle entry";
      handle.textContent = `LIMIT ${displayedPrice.toFixed(pricePrecision)}`;
      ref.current!.appendChild(handle);
      handles.push(handle);
      handlePositions.push({ handle, price: () => displayedPrice });
      handle.onpointerdown = (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
          const bounds = ref.current!.getBoundingClientRect();
          const price = cs.coordinateToPrice(e.clientY - bounds.top);
          if (price === null || price <= 0) return;
          displayedPrice = price;
          line.applyOptions({ price });
          handle.textContent = `LIMIT ${price.toFixed(pricePrecision)}`;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          onEntryMarkerChange(entryMarker.id, displayedPrice);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      };
    }
    let handleAnimationFrame = 0;
    const syncHandlePositions = () => {
      syncClosedTradeOverlays();
      handlePositions.forEach(({ handle, price }) => {
        const y = cs.priceToCoordinate(price());
        if (y !== null) handle.style.top = `${y}px`;
      });
      handleAnimationFrame = requestAnimationFrame(syncHandlePositions);
    };
    handleAnimationFrame = requestAnimationFrame(syncHandlePositions);
    const selectStart = (event: any) => {
      if (selectingStart && typeof event.time === "number") onStartSelected(Number(event.time));
    };
    if (selectingStart) chart.subscribeClick(selectStart);
    const replayMoved = renderedIndex.current !== null && renderedIndex.current !== index;
    if (forceFocus) {
      const span = savedLogicalRange.current
        ? Math.max(20, savedLogicalRange.current.to - savedLogicalRange.current.from)
        : 100;
      chart.timeScale().setVisibleLogicalRange({ from: safeIndex - span / 2, to: safeIndex + span / 2 });
    } else if (savedLogicalRange.current && (!replayMoved || !followRealtime.current)) {
      chart.timeScale().setVisibleLogicalRange(savedLogicalRange.current);
    } else {
      chart.timeScale().scrollToRealTime();
    }
    appliedFocusRevision.current = focusRevision;
    renderedIndex.current = index;
    const priceScaleWidth = Math.max(70, chart.priceScale("right").width());
    let chartAlive = true;
    const markManualScale=(event:PointerEvent)=>{
      const element=ref.current;if(!element)return;
      const bounds=element.getBoundingClientRect();
      if(event.clientX-bounds.left>=bounds.width-priceScaleWidth-4)manualPriceScale.current=true;
    };
    const resetManualScale=(event:MouseEvent)=>{
      const element=ref.current;if(!element)return;
      const bounds=element.getBoundingClientRect();
      if(event.clientX-bounds.left>=bounds.width-priceScaleWidth-4){manualPriceScale.current=false;savedPriceRange.current=null}
    };
    const zoomPriceScale = (event: WheelEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left < bounds.width - priceScaleWidth - 4) return;
      const range = cs.priceScale().getVisibleRange();
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const factor = Math.min(1.35, Math.max(0.74, Math.exp(event.deltaY * 0.0015)));
      const center = (range.from + range.to) / 2;
      const half = ((range.to - range.from) * factor) / 2;
      const nextRange = { from: center - half, to: center + half };
      manualPriceScale.current = true;
      savedPriceRange.current = nextRange;
      cs.priceScale().setVisibleRange(nextRange);
    };
    ref.current.addEventListener("pointerdown",markManualScale);
    ref.current.addEventListener("dblclick",resetManualScale);
    ref.current.addEventListener("wheel",zoomPriceScale,{capture:true,passive:false});
    return () => {
      chartAlive = false;
      const range = chart.timeScale().getVisibleLogicalRange();
      savedLogicalRange.current = range;
      if (range) followRealtime.current = Math.abs(range.to - (visible.length - 1)) < 0.75;
      if(manualPriceScale.current)savedPriceRange.current=cs.priceScale().getVisibleRange();
      ref.current?.removeEventListener("pointerdown",markManualScale);
      ref.current?.removeEventListener("dblclick",resetManualScale);
      ref.current?.removeEventListener("wheel",zoomPriceScale,{capture:true});
      handles.forEach((handle) => handle.remove());
      overlay.remove();
      removablePriceLines.forEach((line) => { try { cs.removePriceLine(line); } catch {} });
      cancelAnimationFrame(handleAnimationFrame);
      if (selectingStart) chart.unsubscribeClick(selectStart);
      chart.remove();
    };
  }, [candles, index, barriers, trades, onBarrierChange, selectingStart, onStartSelected, focusRevision, pricePrecision, entryMarker, onEntryMarkerChange, showClosedTradeOverlays]);
  return <div
    className={`chart ${selectingStart ? "selecting-replay-start" : ""}`}
    ref={ref}
    onPointerDownCapture={() => onInteractionChange(true)}
    onPointerUpCapture={() => onInteractionChange(false)}
    onPointerCancel={() => onInteractionChange(false)}
    onLostPointerCapture={() => onInteractionChange(false)}
  />;
}
export default function App() {
  const { message, notification } = AntApp.useApp();
  const hydrated = useRef(false);
  const notifiedTrades = useRef(new Set<string>());
  const chartInteractionActive = useRef(false);
  const [state, setState] = useState(initial),
    [dataset, setDataset] = useState(""),
    [tf, setTf] = useState(15),
    [idx, setIdx] = useState(120),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [journal, setJournal] = useState(false),
    [settingsOpen,setSettingsOpen]=useState(false),
    [selectingStart, setSelectingStart] = useState(false),
    [datePickerOpen, setDatePickerOpen] = useState(false),
    [focusRevision,setFocusRevision]=useState(0),
    [loadedMarket,setLoadedMarket]=useState<{id:string;name:string;candles:Candle[]}|null>(null),
    [orderType,setOrderType]=useState<"MARKET"|"LIMIT">("MARKET"),
    [leverage,setLeverage]=useState(10),
    [amountUnit,setAmountUnit]=useState<"USDT"|"COIN">("USDT"),
    [orderValue,setOrderValue]=useState(100),
    [allocationPercent,setAllocationPercent]=useState(1),
    [limitPrice,setLimitPrice]=useState(0),
    [protectionEnabled,setProtectionEnabled]=useState(false),
    [limitTakeProfit,setLimitTakeProfit]=useState(0),
    [limitStopLoss,setLimitStopLoss]=useState(0);
  useEffect(() => {
    const release = () => { chartInteractionActive.current = false; };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((s: Persisted) => {
        const datasets=(s.datasets??[]).filter((item)=>item.id!=="demo");
        if (datasets.length) {
          setState({...s,datasets,settings:{...DEFAULT_SIMULATION_SETTINGS,...s.settings}});
          setDataset(datasets[0].id);
        } else {
          setState({...s,datasets:[],settings:{...DEFAULT_SIMULATION_SETTINGS,...s.settings}});
        }
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true;
      });
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    const h = setTimeout(
      () =>
        fetch("/api/state", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state),
        }).catch(() => {}),
      300,
    );
    return () => clearTimeout(h);
  }, [state]);
  const availableDatasets=loadedMarket?[loadedMarket,...state.datasets.filter(d=>d.id!==loadedMarket.id)]:state.datasets;
  const simulationSettings={...DEFAULT_SIMULATION_SETTINGS,...state.settings};
  const activeDataset=availableDatasets.find((d)=>d.id===dataset);
  const marketSymbol=(activeDataset?.name.split(/[·\s]/)[0]??"").toUpperCase();
  const quoteAsset=["USDT","USDC","BUSD","USD","BTC","ETH"].find((value)=>marketSymbol.endsWith(value)&&marketSymbol.length>value.length)??"USDT";
  const baseAsset=marketSymbol.slice(0,-quoteAsset.length)||"COIN";
  const raw = availableDatasets.find((d) => d.id === dataset)?.candles || [];
  const pricePrecision = useMemo(() => inferPricePrecision(raw), [raw]);
  const candles = useMemo(() => aggregate(raw, tf), [raw, tf]);
  const lastIndex = Math.max(0, candles.length - 1);
  const replayIndex = Math.max(
    0,
    Math.min(Number.isFinite(idx) ? idx : 0, lastIndex),
  );
  useEffect(
    () => setIdx((i) => Math.max(0, Math.min(i, candles.length - 1))),
    [candles.length],
  );
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(
      () =>
        setIdx((i) => {
          if (chartInteractionActive.current) return i;
          if (i >= lastIndex) {
            setPlaying(false);
            return lastIndex;
          }
          return i + 1;
        }),
      Math.max(80, 800 / speed),
    );
    return () => clearInterval(h);
  }, [playing, speed, lastIndex]);
  const cur = candles[replayIndex];
  function changeTimeframe(nextTf: number) {
    const replayTime = cur?.time;
    const nextCandles = aggregate(raw, nextTf);
    let nextIndex = 0;
    if (replayTime != null) {
      for (let i = 0; i < nextCandles.length; i++) {
        if (nextCandles[i].time > replayTime) break;
        nextIndex = i;
      }
    }
    setTf(nextTf);
    setIdx(nextIndex);
    setFocusRevision((value) => value + 1);
  }
  function selectReplayIndex(nextIndex: number) {
    setPlaying(false);
    setIdx(Math.max(0, Math.min(nextIndex, lastIndex)));
    setSelectingStart(false);
    setFocusRevision((value) => value + 1);
  }
  function selectReplayTime(time: number) {
    const found = candles.findIndex((candle) => candle.time >= time);
    selectReplayIndex(found === -1 ? lastIndex : found);
  }
  function handleReplayStartAction(key: string) {
    setPlaying(false);
    if (key === "bar") setSelectingStart(true);
    if (key === "date") setDatePickerOpen(true);
    if (key === "first") selectReplayIndex(0);
    if (key === "random") selectReplayIndex(Math.floor(Math.random() * Math.max(1, lastIndex)));
  }
  useEffect(() => {
    if (!cur) return;
    const filled = state.trades.filter((trade) =>
      trade.status === "PENDING" &&
      (trade.createdTime ?? trade.entryTime) < cur.time &&
      cur.low <= trade.entry && cur.high >= trade.entry,
    );
    if (!filled.length) return;
    const ids = new Set(filled.map((trade) => trade.id));
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) => ids.has(trade.id) ? { ...trade, status: "OPEN", entryTime: cur.time } : trade),
      annotations: current.annotations.map((barrier) => ids.has(barrier.id) ? { ...barrier, entryTime: cur.time } : barrier),
    }));
    filled.forEach((trade) => message.success(`${trade.side} limit исполнен по ${formatPrice(trade.entry, pricePrecision)}`));
  }, [cur?.time]);
  useEffect(() => {
    if (!cur) return;
    const closures = state.trades.flatMap((trade) => {
      if (trade.status !== "OPEN" || trade.entryTime >= cur.time) return [];
      const intrabar = intrabarExitResolver.resolve(raw, cur.time, tf * 60, trade);
      let outcome: "TP" | "SL";
      let exitTime: number;
      if (intrabar.kind === "resolved") {
        outcome = intrabar.outcome;
        exitTime = intrabar.candleTime;
      } else if (intrabar.kind === "not-hit") {
        return [];
      } else {
        const slHit = trade.side === "LONG" ? cur.low <= trade.sl : cur.high >= trade.sl;
        const tpHit = trade.side === "LONG" ? cur.high >= trade.tp : cur.low <= trade.tp;
        if (!slHit && !tpHit) return [];
        outcome = slHit ? "SL" : "TP";
        exitTime = cur.time;
      }
      const slHit = outcome === "SL";
      const rawExit = slHit ? trade.sl : trade.tp;
      const stopSlip = (trade.stopSlippagePct ?? simulationSettings.stopSlippagePct) / 100;
      const exit = slHit ? rawExit * (trade.side === "LONG" ? 1 - stopSlip : 1 + stopSlip) : rawExit;
      const grossResult = (trade.side === "LONG" ? exit - trade.entry : trade.entry - exit) * trade.size;
      const exitFeePct = outcome === "TP" ? (trade.makerFeePct ?? simulationSettings.makerFeePct) : (trade.takerFeePct ?? simulationSettings.takerFeePct);
      const exitFee = exit * trade.size * exitFeePct / 100;
      const fees = (trade.entryFee ?? 0) + exitFee;
      const result = grossResult - fees;
      return [{ trade, outcome, exitTime, exit, grossResult, fees, result }];
    });
    if (!closures.length) return;
    const byId = new Map(closures.map((item) => [item.trade.id, item]));
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) => {
        const closed = byId.get(trade.id);
        return closed ? { ...trade, status: "CLOSED", exitTime: closed.exitTime, exit: closed.exit, grossResult: closed.grossResult, fees: closed.fees, result: closed.result, outcome: closed.outcome } : trade;
      }),
    }));
    closures.forEach(({ trade, outcome, exit, result }) =>
      notifyTradeClosed(trade, outcome, exit, result),
    );
  }, [cur?.time]);
  const workingTrades = state.trades.filter((t) => t.status === "OPEN" || t.status === "PENDING");
  const blockingTrade = workingTrades.at(-1);
  const chartTrade = workingTrades.at(-1);
  const activeBarriers = chartTrade
    ? state.annotations.filter(
        (b) => b.id === chartTrade.id && b.entryTime <= (cur?.time || 0),
      )
    : [];
  function step() {
    setIdx((i) => Math.min(i + 1, lastIndex));
  }
  function reset() {
    setPlaying(false);
    setIdx(Math.min(120, lastIndex));
  }
  function placeOrder(side: "LONG" | "SHORT") {
    if (!cur) return;
    if (blockingTrade) {
      message.warning("Сначала закройте позицию или отмените лимитную заявку");
      return;
    }
    const requestedEntry = orderType === "MARKET" ? cur.close : (limitPrice || cur.close);
    const entrySlip = simulationSettings.slippagePct / 100;
    const entry = orderType === "MARKET" ? requestedEntry * (side === "LONG" ? 1 + entrySlip : 1 - entrySlip) : requestedEntry;
    if (!Number.isFinite(entry) || entry <= 0 || orderValue <= 0) {
      message.warning("Проверьте цену и размер заявки");
      return;
    }
    const size = amountUnit === "USDT" ? orderValue / entry : orderValue;
    const entryFeePct = orderType === "MARKET" ? simulationSettings.takerFeePct : simulationSettings.makerFeePct;
    const entryFee = entry * size * entryFeePct / 100;
    if (!protectionEnabled || limitStopLoss <= 0 || limitTakeProfit <= 0) {
      message.warning("Включите TP/SL и укажите обе цены");
      return;
    }
    const sl = limitStopLoss;
    const tp = limitTakeProfit;
    const invalidBarriers = side === "LONG" ? sl >= entry || tp <= entry : sl <= entry || tp >= entry;
    if (invalidBarriers) {
      message.warning(side === "LONG" ? "Для LONG: SL ниже цены, TP выше цены" : "Для SHORT: SL выше цены, TP ниже цены");
      return;
    }
    const t: Trade = {
      id: crypto.randomUUID(),
      side,
      entryTime: cur.time,
      createdTime: cur.time,
      entry,
      size,
      sl,
      tp,
      status: orderType === "MARKET" ? "OPEN" : "PENDING",
      orderType,
      leverage,
      inputUnit: amountUnit,
      inputValue: orderValue,
      entryFee,
      makerFeePct: simulationSettings.makerFeePct,
      takerFeePct: simulationSettings.takerFeePct,
      slippagePct: simulationSettings.slippagePct,
      stopSlippagePct: simulationSettings.stopSlippagePct,
      comment: "",
    };
    const b: Barrier = {
      id: t.id,
      entryTime: cur.time,
      upper: side === "LONG" ? tp : sl,
      lower: side === "LONG" ? sl : tp,
      timeLimit: cur.time + tf * 60 * 24,
    };
    setState((s) => ({
      ...s,
      trades: [...s.trades, t],
      annotations: [...s.annotations, b],
    }));
    setLimitTakeProfit(0);
    setLimitStopLoss(0);
    setProtectionEnabled(false);
    message.success(orderType === "MARKET" ? `${side} открыт` : `${side} limit размещён`);
  }
  function cancelOrder(id: string) {
    setState((current) => ({
      ...current,
      trades: current.trades.filter((trade) => trade.id !== id),
      annotations: current.annotations.filter((barrier) => barrier.id !== id),
    }));
    message.info("Лимитная заявка отменена");
  }
  function closeTrade(t: Trade) {
    if (t.status === "PENDING") return cancelOrder(t.id);
    if (!cur) return;
    const slippage = (t.slippagePct ?? simulationSettings.slippagePct) / 100;
    const exit = cur.close * (t.side === "LONG" ? 1 - slippage : 1 + slippage);
    const grossResult = (t.side === "LONG" ? exit - t.entry : t.entry - exit) * t.size;
    const exitFee = exit * t.size * (t.takerFeePct ?? simulationSettings.takerFeePct) / 100;
    const fees = (t.entryFee ?? 0) + exitFee;
    const result = grossResult - fees;
    setState((s) => ({
      ...s,
      trades: s.trades.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status: "CLOSED",
              exitTime: cur.time,
              exit,
              grossResult,
              fees,
              result,
              outcome: "MANUAL",
            }
          : x,
      ),
    }));
    notifyTradeClosed(t, "MANUAL", exit, result);
  }
  function notifyTradeClosed(
    trade: Trade,
    outcome: NonNullable<Trade["outcome"]>,
    exit: number,
    result: number,
  ) {
    if (notifiedTrades.current.has(trade.id)) return;
    notifiedTrades.current.add(trade.id);
    const profitable = result >= 0;
    notification.open({
      placement: "topRight",
      type: profitable ? "success" : "error",
      message: `Сделка закрыта · ${outcome}`,
      description: (
        <div className="close-notification">
          <b>{trade.side}</b>
          <span>{fmt(trade.entry)} → {fmt(exit)}</span>
          <strong className={profitable ? "pos" : "neg"}>
            P&amp;L {result >= 0 ? "+" : ""}{fmt(result)}
          </strong>
        </div>
      ),
      duration: 5,
    });
  }
  function deleteTrade(id: string) {
    setState((s) => ({
      ...s,
      trades: s.trades.filter((t) => t.id !== id),
      annotations: s.annotations.filter((b) => b.id !== id),
    }));
    message.success("Сделка удалена");
  }
  function moveBarrier(id: string, kind: "tp" | "sl", price: number) {
    const rounded = Number(price.toFixed(pricePrecision));
    if (id === "__draft_protection__") {
      if (kind === "tp") setLimitTakeProfit(rounded);
      else setLimitStopLoss(rounded);
      return;
    }
    setState((s) => {
      const trades = s.trades.map((t) =>
        t.id === id ? { ...t, [kind]: rounded } : t,
      );
      const trade = trades.find((t) => t.id === id);
      if (!trade) return s;
      const annotations = s.annotations.map((b) =>
        b.id === id
          ? {
              ...b,
              upper: trade.side === "LONG" ? trade.tp : trade.sl,
              lower: trade.side === "LONG" ? trade.sl : trade.tp,
            }
          : b,
      );
      return { ...s, trades, annotations };
    });
  }
  function moveEntryMarker(id: string, price: number) {
    const rounded = Number(price.toFixed(pricePrecision));
    if (id === "__draft_limit_entry__") {
      setLimitPrice(rounded);
      return;
    }
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) =>
        trade.id === id && trade.status === "PENDING" ? { ...trade, entry: rounded } : trade,
      ),
    }));
  }
  function importCsv(file: File) {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: (r) => {
        const cs = (r.data as any[])
          .map((x) => ({
            time: Math.floor(
              new Date(x.time ?? x.timestamp ?? x.date).getTime() / 1000,
            ),
            open: +x.open,
            high: +x.high,
            low: +x.low,
            close: +x.close,
            volume: +(x.volume || 0),
          }))
          .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.close))
          .sort((a, b) => a.time - b.time);
        if (!cs.length)
          return message.error(
            "Не найдены колонки time, open, high, low, close",
          );
        const id = crypto.randomUUID();
        setState((s) => ({
          ...s,
          datasets: [...s.datasets, { id, name: file.name, candles: cs }],
        }));
        setDataset(id);
        setIdx(Math.min(120, cs.length - 1));
        message.success(`Загружено ${cs.length} свечей`);
      },
    });
    return false;
  }
  const ticketPrice = orderType === "MARKET" ? (cur?.close ?? 0) : (limitPrice || cur?.close || 0);
  const ticketQuantity = ticketPrice > 0 ? (amountUnit === "USDT" ? orderValue / ticketPrice : orderValue) : 0;
  const ticketNotional = ticketQuantity * ticketPrice;
  const ticketMargin = ticketNotional / leverage;
  const longLiquidation = ticketPrice > 0 && leverage > 1 ? ticketPrice * (1 - 1 / leverage) : null;
  const shortLiquidation = ticketPrice > 0 && leverage > 1 ? ticketPrice * (1 + 1 / leverage) : null;
  const draftProtectionTrade: Trade | undefined = protectionEnabled && ticketPrice > 0 && limitTakeProfit > 0 && limitStopLoss > 0 ? {
    id: "__draft_protection__", side: "LONG", entryTime: cur?.time ?? 0, entry: ticketPrice,
    size: 0, sl: limitStopLoss, tp: limitTakeProfit, status: "OPEN", comment: "",
  } : undefined;
  const displayedChartTrade = chartTrade ?? draftProtectionTrade;
  const chartTrades = displayedChartTrade?.id === "__draft_protection__"
    ? [...state.trades, displayedChartTrade]
    : state.trades;
  const displayedBarriers: Barrier[] = chartTrade ? activeBarriers : draftProtectionTrade ? [{
    id: draftProtectionTrade.id, entryTime: cur?.time ?? 0,
    upper: draftProtectionTrade.tp, lower: draftProtectionTrade.sl,
    timeLimit: Number.MAX_SAFE_INTEGER,
  }] : [];
  const displayedEntryMarker = chartTrade?.status === "PENDING"
    ? { id: chartTrade.id, price: chartTrade.entry }
    : !chartTrade && protectionEnabled && orderType === "LIMIT" && ticketPrice > 0
      ? { id: "__draft_limit_entry__", price: ticketPrice }
      : undefined;
  function updateSimulationSetting(key: Exclude<keyof SimulationSettings, "showClosedTradeOverlays">, value: number | null) {
    setState((current) => ({
      ...current,
      settings: { ...(current.settings ?? DEFAULT_SIMULATION_SETTINGS), [key]: Math.max(0, value ?? 0) },
    }));
  }
  const cols = [
    { title: "Вход", dataIndex: "entryTime", render: dt },
    {
      title: "Side",
      dataIndex: "side",
      render: (v: string) => (
        <Tag color={v === "LONG" ? "green" : "red"}>{v}</Tag>
      ),
    },
    { title: "Цена", dataIndex: "entry", render: fmt },
    { title: "Статус", dataIndex: "status" },
    {
      title: "P&L",
      dataIndex: "result",
      render: (v?: number) => (
        <span className={(v || 0) >= 0 ? "pos" : "neg"}>
          {v == null ? "—" : fmt(v)}
        </span>
      ),
    },
    { title: "Комиссии", dataIndex: "fees", render: (value?: number) => value == null ? "—" : fmt(value) },
    {
      title: "Действия",
      render: (_: any, t: Trade) => (
        <Space size={6}>
          {(t.status === "OPEN" || t.status === "PENDING") && (
            <Button size="small" onClick={() => t.status === "PENDING" ? cancelOrder(t.id) : closeTrade(t)}>
              {t.status === "PENDING" ? "Отменить" : "Закрыть"}
            </Button>
          )}
          <Popconfirm
            title="Удалить сделку?"
            description="Сделка и её разметка будут удалены."
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteTrade(t.id)}
          >
            <Button danger size="small" icon={<Trash2 size={14} />}>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo">
            <BarChart3 size={20} />
          </div>
          <div>
            <b>CANDLE LAB</b>
            <small>Replay terminal</small>
          </div>
        </div>
        <div className="headerRight">
          <HistoryManager onOpen={(market)=>{setLoadedMarket(market);setDataset(market.id);setIdx(Math.min(120,market.candles.length-1))}}/>
          <span className="live">
            <i /> LOCAL
          </span>
          <Button icon={<Settings size={16}/>} onClick={()=>setSettingsOpen(true)}>Настройки</Button>
          <Button
            icon={<BookOpen size={16} />}
            onClick={() => setJournal(true)}
          >
            Журнал <Tag>{state.trades.length}</Tag>
          </Button>
        </div>
      </header>
      <main>
        <section className="workspace">
          <div className="toolbar">
            <Select
              value={dataset || undefined}
              placeholder="Выберите историю"
              onChange={(v) => {
                setDataset(v);
                setIdx(120);
              }}
              options={availableDatasets.map((d) => ({
                value: d.id,
                label: d.name,
              }))}
              style={{ width: 190 }}
            />
            <div className="tf">
              {[5, 15, 30, 60, 180, 240, 1440].map((v) => (
                <Button
                  key={v}
                  type="text"
                  className={tf === v ? "is-active" : undefined}
                  onClick={() => changeTimeframe(v)}
                >
                  {formatTimeframe(v)}
                </Button>
              ))}
            </div>
            <div className="spacer" />
            <Upload
              beforeUpload={importCsv}
              showUploadList={false}
              accept=".csv"
            >
              <Button icon={<UploadIcon size={15} />}>CSV</Button>
            </Upload>
          </div>
          <div className="chartWrap">
            {candles.length ? (
              <Chart
                candles={candles}
                index={selectingStart ? lastIndex : replayIndex}
                barriers={displayedBarriers}
                trades={chartTrades}
                onBarrierChange={moveBarrier}
                selectingStart={selectingStart}
                onStartSelected={selectReplayTime}
                focusRevision={focusRevision}
                pricePrecision={pricePrecision}
                entryMarker={displayedEntryMarker}
                onEntryMarkerChange={moveEntryMarker}
                showClosedTradeOverlays={simulationSettings.showClosedTradeOverlays}
                onInteractionChange={(active) => { chartInteractionActive.current = active; }}
              />
            ) : (
              <Empty />
            )}
            <div className="symbol">
              <b>{availableDatasets.find((d) => d.id === dataset)?.name}</b>
              <span>{formatTimeframe(tf)} · Historical</span>
            </div>
          </div>
          <div className="replay">
            <Dropdown
              trigger={["click"]}
              menu={{
                onClick: ({ key }) => handleReplayStartAction(key),
                items: [
                  { key: "bar", icon: <Crosshair size={15} />, label: "Выбрать свечу" },
                  { key: "date", icon: <CalendarDays size={15} />, label: "Выбрать дату" },
                  { key: "first", icon: <Flag size={15} />, label: "Первая доступная" },
                  { key: "random", icon: <Dices size={15} />, label: "Случайная свеча" },
                ],
              }}
            >
              <Button className={selectingStart ? "select-start active" : "select-start"} icon={<Crosshair size={16} />}>
                {selectingStart ? "Кликните по свече" : "Выбрать старт"}
              </Button>
            </Dropdown>
            <Button
              type="text"
              icon={<RotateCcw size={18} />}
              onClick={reset}
            />
            <Button
              className="play"
              shape="circle"
              icon={playing ? <Pause size={20} /> : <Play size={20} />}
              onClick={() => setPlaying(!playing)}
            />
            <Button
              type="text"
              icon={<ChevronRight size={22} />}
              onClick={step}
            />
            <Select
              value={speed}
              onChange={setSpeed}
              options={[1, 5, 10].map((v) => ({ value: v, label: `${v}×` }))}
              style={{ width: 70 }}
            />
            <div className="clock">
              <Clock3 size={15} />
              {cur ? dt(cur.time) : "—"}{" "}
              <span>
                {replayIndex + 1} / {candles.length}
              </span>
            </div>
          </div>
        </section>
        <aside>
          <div className="orderHeader"><b>Trade</b></div>
          <div className="ticketTopRow">
            <Select value="isolated" options={[{value:"isolated",label:"Isolated"}]}/>
            <Select className="leverageSelect" value={leverage} onChange={setLeverage} options={[1,2,3,5,10,20,50,100].map((value)=>({value,label:`${value.toFixed(2)}x`}))}/>
          </div>
          <div className="orderTabs">
            <button className={orderType === "LIMIT" ? "active" : ""} onClick={() => { setOrderType("LIMIT"); if (cur) setLimitPrice(cur.close); }}>Limit</button>
            <button className={orderType === "MARKET" ? "active" : ""} onClick={() => setOrderType("MARKET")}>Market</button>
            <CircleHelp size={16}/>
          </div>
          {orderType === "LIMIT" && <div className="ticketField">
            <span>Цена</span>
            <div className="priceInput"><InputNumber controls={false} value={limitPrice || cur?.close} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value)=>setLimitPrice(value||0)}/><button onClick={()=>cur&&setLimitPrice(cur.close)}>Last</button></div>
          </div>}
          <div className="protectionToggle">
            <Checkbox checked={protectionEnabled} onChange={(event)=>{
              const enabled=event.target.checked;
              setProtectionEnabled(enabled);
              if(enabled&&cur?.close){
                const currentPrice=cur.close;
                if(orderType==="LIMIT")setLimitPrice(+currentPrice.toFixed(pricePrecision));
                setLimitTakeProfit(+(currentPrice*1.01).toFixed(pricePrecision));
                setLimitStopLoss(+(currentPrice*0.99).toFixed(pricePrecision));
              }
            }}>TP / SL</Checkbox>
            <span>обязательно</span>
          </div>
          {protectionEnabled && <div className="limitProtection">
            <div className="ticketField"><span>Take Profit</span><InputNumber controls={false} placeholder="Не задан" value={limitTakeProfit || undefined} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value)=>setLimitTakeProfit(value||0)}/></div>
            <div className="ticketField"><span>Stop Loss</span><InputNumber controls={false} placeholder="Не задан" value={limitStopLoss || undefined} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value)=>setLimitStopLoss(value||0)}/></div>
          </div>}
          <div className="ticketField">
            <span>Value</span>
            <div className="amountInput">
              <InputNumber controls={false} min={0} value={orderValue} onChange={(value)=>{const next=value||0;setOrderValue(next);const notional=amountUnit==="USDT"?next:next*ticketPrice;setAllocationPercent(Math.min(100,notional/leverage/PAPER_BALANCE_USDT*100))}}/>
              <Select variant="borderless" value={amountUnit} onChange={(next)=>{setOrderValue(next==="USDT"?ticketNotional:ticketQuantity);setAmountUnit(next)}} options={[{value:"USDT",label:"USDT"},{value:"COIN",label:baseAsset}]}/>
            </div>
          </div>
          <div className="allocationSlider">
            <Slider min={0} max={100} step={1} value={allocationPercent} onChange={(percent)=>{setAllocationPercent(percent);const notional=PAPER_BALANCE_USDT*(percent/100)*leverage;setOrderValue(amountUnit==="USDT"?notional:(ticketPrice?notional/ticketPrice:0))}} tooltip={{formatter:(value)=>`${value}%`}}/>
            <div><span>0</span><span>100%</span></div>
          </div>
          <div className="orderSummary">
            <div><span>Quantity</span><b>{ticketQuantity ? formatPrice(ticketQuantity, Math.min(8,pricePrecision+2)) : "—"} {baseAsset}</b></div>
            <div><span>Cost</span><b>{ticketMargin ? `${fmt(ticketMargin)} ${quoteAsset}` : "—"}</b></div>
            <div><span>Liq. Price</span><b><em>{longLiquidation != null ? formatPrice(longLiquidation,pricePrecision) : "—"}</em> / <strong>{shortLiquidation != null ? formatPrice(shortLiquidation,pricePrecision) : "—"}</strong></b></div>
          </div>
          <div className="tradeBtns">
            <Button className="long" disabled={Boolean(blockingTrade)||!cur||!protectionEnabled||limitTakeProfit<=0||limitStopLoss<=0} onClick={() => placeOrder("LONG")}>Long</Button>
            <Button className="short" disabled={Boolean(blockingTrade)||!cur||!protectionEnabled||limitTakeProfit<=0||limitStopLoss<=0} onClick={() => placeOrder("SHORT")}>Short</Button>
          </div>
          <div className="sideTitle">ПОЗИЦИИ И ЗАЯВКИ</div>
          {workingTrades.length ? workingTrades.map((t) => {
            const unrealizedPnl = cur && t.status === "OPEN"
              ? (t.side === "LONG" ? cur.close - t.entry : t.entry - cur.close) * t.size
              : null;
            const margin = t.entry * t.size / (t.leverage ?? 1);
            const unrealizedRoi = unrealizedPnl != null && margin > 0 ? unrealizedPnl / margin * 100 : null;
            return (
              <Card size="small" key={t.id} className="position">
                <div className="positionMain">
                  <Tag color={t.status === "PENDING" ? "orange" : t.side === "LONG" ? "green" : "red"}>{t.status === "PENDING" ? "LIMIT" : t.side}</Tag>
                  <div className="positionPrice"><b>{formatPrice(t.entry,pricePrecision)}</b><small>{t.leverage??1}x · {formatPrice(t.size,Math.min(8,pricePrecision+2))} {baseAsset}</small></div>
                  {unrealizedPnl != null && <div className={`positionPnl ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
                    <b>{unrealizedPnl >= 0 ? "+" : ""}{fmt(unrealizedPnl)} {quoteAsset}</b>
                    <em>{unrealizedRoi != null && unrealizedRoi >= 0 ? "+" : ""}{unrealizedRoi?.toFixed(2)}%</em>
                  </div>}
                  <Tooltip title={t.status === "PENDING" ? "Отменить заявку" : "Закрыть позицию"}>
                  <Button
                    className={`positionAction ${t.status === "PENDING" ? "cancel" : "close"}`}
                    aria-label={t.status === "PENDING" ? "Отменить заявку" : "Закрыть позицию"}
                    icon={<X size={14} />}
                    onClick={() => t.status === "PENDING" ? cancelOrder(t.id) : closeTrade(t)}
                  />
                  </Tooltip>
                </div>
              </Card>
            );
          }) : <div className="muted">Нет активных позиций и заявок</div>}
          <div className="tip">
            Будущие свечи скрыты
            <br />
            <span>Доступно до {cur ? dt(cur.time) : "—"}</span>
          </div>
        </aside>
      </main>
      <Modal title="Настройки симуляции" open={settingsOpen} onCancel={()=>setSettingsOpen(false)} footer={<><Button onClick={()=>setState((current)=>({...current,settings:DEFAULT_SIMULATION_SETTINGS}))}>По умолчанию</Button><Button type="primary" onClick={()=>setSettingsOpen(false)}>Готово</Button></>}>
        <div className="settingsGrid">
          <label><span>Maker fee</span><InputNumber value={simulationSettings.makerFeePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value)=>updateSimulationSetting("makerFeePct",value)}/><small>Limit-вход и Take Profit</small></label>
          <label><span>Taker fee</span><InputNumber value={simulationSettings.takerFeePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value)=>updateSimulationSetting("takerFeePct",value)}/><small>Market, Stop Loss и ручное закрытие</small></label>
          <label><span>Market slippage</span><InputNumber value={simulationSettings.slippagePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value)=>updateSimulationSetting("slippagePct",value)}/><small>Вход и ручное закрытие по рынку</small></label>
          <label><span>Stop slippage</span><InputNumber value={simulationSettings.stopSlippagePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value)=>updateSimulationSetting("stopSlippagePct",value)}/><small>Ухудшение цены исполнения Stop Loss</small></label>
          <label className="settingsToggle"><span>Разметка закрытых сделок</span><Switch checked={simulationSettings.showClosedTradeOverlays} onChange={(checked)=>setState((current)=>({...current,settings:{...DEFAULT_SIMULATION_SETTINGS,...current.settings,showClosedTradeOverlays:checked}}))}/><small>Зоны TP/SL и линия фактического выхода на графике</small></label>
        </div>
      </Modal>
      <Modal title="Выберите дату начала replay" open={datePickerOpen} footer={null} onCancel={() => setDatePickerOpen(false)} width={360}>
        <DatePicker
          style={{ width: "100%" }}
          minDate={candles[0] ? dayjs(candles[0].time * 1000) : undefined}
          maxDate={candles.at(-1) ? dayjs(candles.at(-1)!.time * 1000) : undefined}
          onChange={(value) => {
            if (!value) return;
            selectReplayTime(value.startOf("day").unix());
            setDatePickerOpen(false);
          }}
        />
      </Modal>
      <Modal
        title="Журнал сделок"
        width={900}
        open={journal}
        footer={<Button onClick={() => setJournal(false)}>Закрыть</Button>}
        onCancel={() => setJournal(false)}
      >
        <Table
          rowKey="id"
          dataSource={state.trades}
          columns={cols as any}
          pagination={false}
        />
      </Modal>
    </div>
  );
}
