import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  type TableProps,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { BarChart3, Database, Download, RefreshCw } from "lucide-react";
import type { Candle, Dataset } from "../../types";

interface CatalogItem {
  category: string;
  symbol: string;
  from: number;
  to: number;
  candles: number;
  bytes: number;
}

interface DownloadJob {
  id: string;
  status: string;
  progress: number;
  completedPages: number;
  totalPages: number;
  candles: number;
  error?: string;
}

interface MarketCandleRow {
  openTime?: number | string;
  open_time?: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

interface HistoryFormValues {
  category: string;
  symbol: string;
  range: [Dayjs, Dayjs];
}

interface HistoryManagerProps {
  onOpen: (market: Dataset) => void;
}

const formatDate = (milliseconds: number) => dayjs(milliseconds).format("YYYY-MM-DD");

const readError = async (response: Response) => {
  const payload = await response.json() as { error?: string };
  return payload.error ?? `HTTP ${response.status}`;
};

export function HistoryManager({ onOpen }: HistoryManagerProps) {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [loading, setLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [form] = Form.useForm<HistoryFormValues>();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/market/catalog");
      if (!response.ok) throw new Error(await readError(response));
      setCatalog(await response.json() as CatalogItem[]);
    } catch {
      void message.error("Не удалось прочитать каталог");
    }
  }, [message]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  const openRange = async (
    category: string,
    symbol: string,
    from: number,
    to: number,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        category,
        symbol,
        timeframe: "5m",
        from: String(from),
        to: String(to),
      });
      const response = await fetch(`/api/market/candles?${params}`);
      if (!response.ok) throw new Error(await readError(response));
      const rows = await response.json() as MarketCandleRow[];
      const candles: Candle[] = rows.map((row) => ({
        time: Number(row.openTime ?? row.open_time) / 1_000,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      }));
      onOpen({ id: `market:${category}:${symbol}`, name: `${symbol} · Bybit`, candles });
      setOpen(false);
      void message.success(`Открыто ${candles.length} свечей`);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    const values = await form.validateFields();
    const from = values.range[0].startOf("day").valueOf();
    const to = values.range[1].add(1, "day").startOf("day").valueOf();
    const symbol = values.symbol.toUpperCase();
    setLoading(true);
    try {
      const response = await fetch("/api/market/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: values.category, symbol, from, to }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const created = await response.json() as DownloadJob;
      setJob(created);
      eventSourceRef.current?.close();
      const source = new EventSource(`/api/market/jobs/${created.id}/events`);
      eventSourceRef.current = source;
      source.onmessage = (event) => {
        const next = JSON.parse(event.data as string) as DownloadJob;
        setJob(next);
        if (next.status === "completed") {
          source.close();
          eventSourceRef.current = null;
          setLoading(false);
          void refresh();
          void openRange(values.category, symbol, from, to);
        } else if (next.status === "failed") {
          source.close();
          eventSourceRef.current = null;
          setLoading(false);
          void message.error(next.error ?? "Ошибка загрузки");
        }
      };
      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;
        setLoading(false);
      };
    } catch (error) {
      setLoading(false);
      void message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const columns: TableProps<CatalogItem>["columns"] = [
    {
      title: "Рынок",
      render: (_value, item) => <><b>{item.symbol}</b> <Tag>{item.category}</Tag></>,
    },
    {
      title: "Покрытие",
      render: (_value, item) => `${formatDate(item.from)} — ${formatDate(item.to - 1)}`,
    },
    { title: "5m свечей", dataIndex: "candles", render: (value: number) => value.toLocaleString() },
    { title: "Размер", dataIndex: "bytes", render: (value: number) => `${(value / 1_024 / 1_024).toFixed(1)} MB` },
    {
      title: "",
      align: "right",
      render: (_value, item) => (
        <Button
          type="primary"
          ghost
          className="history-open-btn"
          icon={<BarChart3 size={14} />}
          onClick={() => void openRange(item.category, item.symbol, item.from, item.to)}
        >
          Открыть
        </Button>
      ),
    },
  ];

  return (
    <>
      <Button icon={<Database size={16} />} onClick={() => setOpen(true)}>История</Button>
      <Modal title="История Bybit" open={open} width={850} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <Form
          form={form}
          component={false}
          initialValues={{
            category: "linear",
            symbol: "BTCUSDT",
            range: [dayjs().subtract(30, "day"), dayjs().subtract(1, "day")],
          }}
        >
          <div className="history-form">
            <Form.Item name="category" noStyle><Select style={{ width: 105 }} options={["linear", "spot", "inverse"].map((value) => ({ value, label: value }))} /></Form.Item>
            <Form.Item name="symbol" rules={[{ required: true }]} noStyle><Input style={{ width: 130 }} placeholder="BTCUSDT" /></Form.Item>
            <Form.Item name="range" rules={[{ required: true }]} noStyle><DatePicker.RangePicker allowClear={false} /></Form.Item>
            <Button className="history-form-download" type="primary" icon={<Download size={15} />} loading={loading} onClick={() => void download()}>Загрузить</Button>
          </div>
        </Form>
        {job && !["completed", "failed"].includes(job.status) && (
          <div className="download-progress">
            <Space><RefreshCw size={15} /><b>{job.status}</b><span>{job.completedPages}/{job.totalPages} страниц · {job.candles.toLocaleString()} свечей</span></Space>
            <Progress percent={job.progress} status="active" />
          </div>
        )}
        {!catalog.length
          ? <Alert type="info" showIcon title="Локальной истории пока нет" />
          : <Table<CatalogItem> className="history-catalog-table" rowKey={(item) => `${item.category}:${item.symbol}`} dataSource={catalog} columns={columns} pagination={false} size="small" />}
      </Modal>
    </>
  );
}
