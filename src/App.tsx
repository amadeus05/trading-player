import { useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  Card,
  Divider,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
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
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Clock3,
  Download,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Upload as UploadIcon,
} from "lucide-react";
import type { Barrier, Candle, Persisted, Trade } from "./types";
import { HistoryManager } from "./HistoryManager";
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
const initial: Persisted = {
  datasets: [],
  trades: [],
  annotations: [],
};
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
}: {
  candles: Candle[];
  index: number;
  barriers: Barrier[];
  trades: Trade[];
  onBarrierChange: (id: string, kind: "tp" | "sl", price: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedLogicalRange = useRef<any>(null);
  const renderedIndex = useRef<number | null>(null);
  const followRealtime = useRef(true);
  const savedPriceRange = useRef<{from:number;to:number}|null>(null);
  const manualPriceScale = useRef(false);
  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const safeIndex = Math.max(0, Math.min(index, candles.length - 1));
    const visible = candles.slice(0, safeIndex + 1);
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
    const handles: HTMLButtonElement[] = [];
    barriers.forEach((b) => {
      const trade = trades.find((t) => t.id === b.id);
      if (!trade) return;
      (["tp", "sl"] as const).forEach((kind) => {
        const color = kind === "tp" ? "#2bd9a8" : "#ff5c73";
        const initialPrice = trade[kind];
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
        handle.textContent = `${kind.toUpperCase()} ${initialPrice.toFixed(2)}`;
        ref.current!.appendChild(handle);
        handles.push(handle);
        const place = (price: number) => {
          const y = cs.priceToCoordinate(price);
          if (y !== null) handle.style.top = `${y}px`;
        };
        requestAnimationFrame(() => place(initialPrice));
        handle.onpointerdown = (event) => {
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          let currentPrice = initialPrice;
          const move = (e: PointerEvent) => {
            const bounds = ref.current!.getBoundingClientRect();
            const price = cs.coordinateToPrice(e.clientY - bounds.top);
            if (price === null || price <= 0) return;
            currentPrice = price;
            line.applyOptions({ price });
            handle.textContent = `${kind.toUpperCase()} ${price.toFixed(2)}`;
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
    const replayMoved = renderedIndex.current !== null && renderedIndex.current !== index;
    if (savedLogicalRange.current && (!replayMoved || !followRealtime.current)) {
      chart.timeScale().setVisibleLogicalRange(savedLogicalRange.current);
    } else {
      chart.timeScale().scrollToRealTime();
    }
    renderedIndex.current = index;
    const markManualScale=(event:PointerEvent)=>{
      const bounds=ref.current!.getBoundingClientRect();
      if(event.clientX-bounds.left>=bounds.width-chart.priceScale("right").width()-4)manualPriceScale.current=true;
    };
    const resetManualScale=(event:MouseEvent)=>{
      const bounds=ref.current!.getBoundingClientRect();
      if(event.clientX-bounds.left>=bounds.width-chart.priceScale("right").width()-4){manualPriceScale.current=false;savedPriceRange.current=null}
    };
    ref.current.addEventListener("pointerdown",markManualScale);
    ref.current.addEventListener("dblclick",resetManualScale);
    return () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      savedLogicalRange.current = range;
      if (range) followRealtime.current = Math.abs(range.to - (visible.length - 1)) < 0.75;
      if(manualPriceScale.current)savedPriceRange.current=cs.priceScale().getVisibleRange();
      ref.current?.removeEventListener("pointerdown",markManualScale);
      ref.current?.removeEventListener("dblclick",resetManualScale);
      handles.forEach((handle) => handle.remove());
      chart.remove();
    };
  }, [candles, index, barriers, trades, onBarrierChange]);
  return <div className="chart" ref={ref}/>;
}
export default function App() {
  const { message, notification } = AntApp.useApp();
  const hydrated = useRef(false);
  const notifiedTrades = useRef(new Set<string>());
  const [state, setState] = useState(initial),
    [dataset, setDataset] = useState(""),
    [tf, setTf] = useState(15),
    [idx, setIdx] = useState(120),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [tradeOpen, setTradeOpen] = useState(false),
    [journal, setJournal] = useState(false),
    [loadedMarket,setLoadedMarket]=useState<{id:string;name:string;candles:Candle[]}|null>(null),
    [form, setForm] = useState({
      side: "LONG" as "LONG" | "SHORT",
      size: 1,
      sl: 0,
      tp: 0,
      comment: "",
    });
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((s: Persisted) => {
        const datasets=(s.datasets??[]).filter((item)=>item.id!=="demo");
        if (datasets.length) {
          setState({...s,datasets});
          setDataset(datasets[0].id);
        } else {
          setState({...s,datasets:[]});
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
  const activeDataset=availableDatasets.find((d)=>d.id===dataset);
  const raw = availableDatasets.find((d) => d.id === dataset)?.candles || [];
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
  }
  useEffect(() => {
    if (!cur) return;
    const closures = state.trades.flatMap((trade) => {
      if (trade.status !== "OPEN" || trade.entryTime >= cur.time) return [];
      const barrier = state.annotations.find((item) => item.id === trade.id);
      if (!barrier) return [];
      const slHit = trade.side === "LONG" ? cur.low <= trade.sl : cur.high >= trade.sl;
      const tpHit = trade.side === "LONG" ? cur.high >= trade.tp : cur.low <= trade.tp;
      const timedOut = cur.time >= barrier.timeLimit;
      if (!slHit && !tpHit && !timedOut) return [];
      const outcome: NonNullable<Trade["outcome"]> = slHit ? "SL" : tpHit ? "TP" : "TIMEOUT";
      const exit = slHit ? trade.sl : tpHit ? trade.tp : cur.close;
      const result = (trade.side === "LONG" ? exit - trade.entry : trade.entry - exit) * trade.size;
      return [{ trade, outcome, exit, result }];
    });
    if (!closures.length) return;
    const byId = new Map(closures.map((item) => [item.trade.id, item]));
    setState((current) => ({
      ...current,
      trades: current.trades.map((trade) => {
        const closed = byId.get(trade.id);
        return closed ? { ...trade, status: "CLOSED", exitTime: cur.time, exit: closed.exit, result: closed.result, outcome: closed.outcome } : trade;
      }),
    }));
    closures.forEach(({ trade, outcome, exit, result }) =>
      notifyTradeClosed(trade, outcome, exit, result),
    );
  }, [cur?.time]);
  const openTrades = state.trades.filter((t) => t.status === "OPEN");
  const activeTrade = openTrades.at(-1);
  const activeBarriers = activeTrade
    ? state.annotations.filter(
        (b) => b.id === activeTrade.id && b.entryTime <= (cur?.time || 0),
      )
    : [];
  function step() {
    setIdx((i) => Math.min(i + 1, lastIndex));
  }
  function reset() {
    setPlaying(false);
    setIdx(Math.min(120, lastIndex));
  }
  function showTrade(side: "LONG" | "SHORT") {
    if (!cur) return;
    if (activeTrade) {
      message.warning("Сначала закройте текущую позицию");
      return;
    }
    setForm({
      side,
      size: 1,
      sl: +(cur.close * (side === "LONG" ? 0.99 : 1.01)).toFixed(2),
      tp: +(cur.close * (side === "LONG" ? 1.02 : 0.98)).toFixed(2),
      comment: "",
    });
    setTradeOpen(true);
  }
  function createTrade() {
    if (!cur) return;
    if (state.trades.some((t) => t.status === "OPEN")) {
      setTradeOpen(false);
      message.warning("Уже есть открытая позиция");
      return;
    }
    const t: Trade = {
      id: crypto.randomUUID(),
      side: form.side,
      entryTime: cur.time,
      entry: cur.close,
      size: form.size,
      sl: form.sl,
      tp: form.tp,
      status: "OPEN",
      comment: form.comment,
    };
    const b: Barrier = {
      id: t.id,
      entryTime: cur.time,
      upper: form.side === "LONG" ? form.tp : form.sl,
      lower: form.side === "LONG" ? form.sl : form.tp,
      timeLimit: cur.time + tf * 60 * 24,
    };
    setState((s) => ({
      ...s,
      trades: [...s.trades, t],
      annotations: [...s.annotations, b],
    }));
    setTradeOpen(false);
    message.success(`${form.side} открыт`);
  }
  function closeTrade(t: Trade) {
    if (!cur) return;
    const result =
      (t.side === "LONG" ? cur.close - t.entry : t.entry - cur.close) * t.size;
    setState((s) => ({
      ...s,
      trades: s.trades.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status: "CLOSED",
              exitTime: cur.time,
              exit: cur.close,
              result,
              outcome: "MANUAL",
            }
          : x,
      ),
    }));
    notifyTradeClosed(t, "MANUAL", cur.close, result);
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
    const rounded = Number(price.toFixed(2));
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
    {
      title: "Действия",
      render: (_: any, t: Trade) => (
        <Space size={6}>
          {t.status === "OPEN" && (
            <Button size="small" onClick={() => closeTrade(t)}>
              Закрыть
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
              {[5, 15, 60, 240].map((v) => (
                <Button
                  key={v}
                  type={tf === v ? "primary" : "text"}
                  onClick={() => changeTimeframe(v)}
                >
                  {v < 60 ? v + "m" : v / 60 + "h"}
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
                index={replayIndex}
                barriers={activeBarriers}
                trades={activeTrade ? [activeTrade] : []}
                onBarrierChange={moveBarrier}
              />
            ) : (
              <Empty />
            )}
            <div className="symbol">
              <b>{availableDatasets.find((d) => d.id === dataset)?.name}</b>
              <span>{tf < 60 ? tf + "m" : tf / 60 + "h"} · Historical</span>
            </div>
          </div>
          <div className="replay">
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
          <div className="sideTitle">ТЕКУЩАЯ СВЕЧА</div>
          <Card className="price">
            <span>{cur ? formatMarketPair(activeDataset?.name) : "Нет данных"}</span>
            <strong>{cur ? fmt(cur.close) : "—"}</strong>
            <small className={cur && cur.close >= cur.open ? "pos" : "neg"}>
              {cur
                ? `${cur.close >= cur.open ? "+" : ""}${((cur.close / cur.open - 1) * 100).toFixed(2)}%`
                : "—"}
            </small>
            <Divider />
            <div className="ohlc">
              {["O", "H", "L", "V"].map((x, i) => (
                <div key={x}>
                  <span>{x}</span>
                  <b>
                    {cur
                      ? fmt([cur.open, cur.high, cur.low, cur.volume][i])
                      : "—"}
                  </b>
                </div>
              ))}
            </div>
          </Card>
          <div className="sideTitle">УЧЕБНАЯ СДЕЛКА</div>
          <div className="tradeBtns">
            <Button
              className="long"
              disabled={Boolean(activeTrade)}
              onClick={() => showTrade("LONG")}
            >
              LONG
            </Button>
            <Button
              className="short"
              disabled={Boolean(activeTrade)}
              onClick={() => showTrade("SHORT")}
            >
              SHORT
            </Button>
          </div>
          <div className="sideTitle">ОТКРЫТЫЕ ПОЗИЦИИ</div>
          {state.trades.filter((t) => t.status === "OPEN").length ? (
            state.trades
              .filter((t) => t.status === "OPEN")
              .map((t) => (
                <Card size="small" key={t.id} className="position">
                  <Tag color={t.side === "LONG" ? "green" : "red"}>
                    {t.side}
                  </Tag>
                  <b>{fmt(t.entry)}</b>
                  <Button size="small" onClick={() => closeTrade(t)}>
                    Закрыть
                  </Button>
                </Card>
              ))
          ) : (
            <div className="muted">Открытых позиций нет</div>
          )}
          <div className="tip">
            Будущие свечи скрыты
            <br />
            <span>Доступно до {cur ? dt(cur.time) : "—"}</span>
          </div>
        </aside>
      </main>
      <Modal
        title={`Открыть ${form.side}`}
        open={tradeOpen}
        onOk={createTrade}
        okText="Открыть сделку"
        onCancel={() => setTradeOpen(false)}
      >
        <div className="form">
          <label>
            Размер позиции
            <InputNumber
              value={form.size}
              min={0.01}
              onChange={(v) => setForm({ ...form, size: v || 1 })}
            />
          </label>
          <label>
            Stop loss
            <InputNumber
              value={form.sl}
              onChange={(v) => setForm({ ...form, sl: v || 0 })}
            />
          </label>
          <label>
            Take profit
            <InputNumber
              value={form.tp}
              onChange={(v) => setForm({ ...form, tp: v || 0 })}
            />
          </label>
          <label>
            Комментарий
            <Input.TextArea
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
          </label>
          <div className="barrierNote">
            Временной барьер: 24 свечи. Линии TP и SL появятся на графике.
          </div>
        </div>
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
