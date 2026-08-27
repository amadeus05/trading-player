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
import { BarChart3, Database, Download, RefreshCw, Trash2 } from "lucide-react";
import type { Dataset } from "../../types";
import { useConfirmDelete } from "../../shared/ui/useConfirmDelete";
import { fetchMarketInstruments, marketDatasetName, type MarketInstrument } from "../../shared/api/marketDataApi";

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

interface HistoryFormValues {
  category: string;
  symbol: string;
  range: [Dayjs, Dayjs];
}

interface HistoryManagerProps {
  onOpen: (market: Dataset) => void;
  iconOnly?: boolean;
  /** Открытый сейчас датасет — чтобы предупредить, что удаляют историю под плеером. */
  activeDatasetId?: string;
  onDeleted?: (datasetId: string) => void;
}

const formatDate = (milliseconds: number) => dayjs(milliseconds).format("YYYY-MM-DD");

const CATEGORIES = ["linear", "spot", "inverse", "forex"] as const;

/** Символ по умолчанию при смене категории: у форекса свои инструменты. */
const DEFAULT_SYMBOL: Record<string, string> = { forex: "EURUSD" };

/** Короткие диапазоны весят десятки килобайт и в мегабайтах выглядели как «0.0 MB». */
const formatBytes = (bytes: number) => bytes < 1_024 * 1_024
  ? `${Math.max(1, Math.round(bytes / 1_024))} KB`
  : `${(bytes / 1_024 / 1_024).toFixed(1)} MB`;

const readError = async (response: Response) => {
  const payload = await response.json() as { error?: string };
  return payload.error ?? `HTTP ${response.status}`;
};

export function HistoryManager({ onOpen, iconOnly = false, activeDatasetId, onDeleted }: HistoryManagerProps) {
  const { message } = AntApp.useApp();
  const confirmDelete = useConfirmDelete();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [instruments, setInstruments] = useState<Record<string, MarketInstrument[]>>({});
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [form] = Form.useForm<HistoryFormValues>();
  const category = Form.useWatch("category", form) ?? "linear";
  const listedInstruments = instruments[category] ?? [];

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

  useEffect(() => {
    if (!open) return;
    fetchMarketInstruments().then(setInstruments).catch(() => setInstruments({}));
  }, [open]);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  /**
   * Открывает рынок, ничего не скачивая: свечи подтянет useActiveMarketCandles
   * окном, как и при выборе монеты в тулбаре.
   *
   * Раньше кнопка тащила весь датасет — от первой свечи до последней. На ETH это
   * 70 МБ и 2.3 с ответа плюс разбор полумиллиона объектов в браузере, отсюда и
   * задержка в несколько секунд против мгновенного переключения в тулбаре.
   * Кнопка просто старше оконной загрузки: когда её писали, иначе было никак.
   */
  const openMarket = (category: string, symbol: string) => {
    onOpen({ id: `market:${category}:${symbol}`, name: marketDatasetName(category, symbol), candles: [] });
    setOpen(false);
  };

  const removeHistory = async (item: CatalogItem) => {
    const datasetId = `market:${item.category}:${item.symbol}`;
    setRemoving(datasetId);
    try {
      const response = await fetch(`/api/market/history/${item.category}/${item.symbol}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      void message.success(`История ${item.symbol} удалена`);
      onDeleted?.(datasetId);
      await refresh();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(null);
    }
  };

  const askRemoveHistory = (item: CatalogItem) => {
    const datasetId = `market:${item.category}:${item.symbol}`;
    const size = formatBytes(item.bytes);
    const span = `${formatDate(item.from)} — ${formatDate(item.to - 1)}`;
    confirmDelete({
      title: `Удалить историю ${item.symbol}?`,
      content: datasetId === activeDatasetId
        ? `${span}, ${item.candles.toLocaleString()} свечей, ${size}. Этот рынок сейчас открыт в плеере — догрузка свечей перестанет работать. Скачать заново можно в любой момент.`
        : `${span}, ${item.candles.toLocaleString()} свечей, ${size}. Скачать заново можно в любой момент.`,
      okText: "Удалить",
      onConfirm: () => void removeHistory(item),
    });
  };

  /**
   * Тикер одной категории в другой не существует, поэтому при переходе между
   * криптой и форексом он заменяется. Внутри крипты выбор остаётся: linear,
   * spot и inverse делят одни и те же символы.
   */
  const changeCategory = (next: string) => {
    const listed = instruments[next] ?? [];
    const symbol = String(form.getFieldValue("symbol") ?? "").toUpperCase();
    if (listed.length) {
      if (!listed.some((item) => item.symbol === symbol)) {
        form.setFieldValue("symbol", DEFAULT_SYMBOL[next] ?? listed[0].symbol);
      }
      return;
    }
    if (Object.values(instruments).some((list) => list.some((item) => item.symbol === symbol))) {
      form.setFieldValue("symbol", "BTCUSDT");
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
          openMarket(values.category, symbol);
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
        void message.error("Соединение загрузки истории прервано");
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
    { title: "Свечей (1m)", dataIndex: "candles", render: (value: number) => value.toLocaleString() },
    { title: "Размер", dataIndex: "bytes", render: formatBytes },
    {
      title: "",
      align: "right",
      render: (_value, item) => (
        <Space size={6}>
          <Button
            type="primary"
            ghost
            className="history-open-btn"
            icon={<BarChart3 size={14} />}
            onClick={() => openMarket(item.category, item.symbol)}
          >
            Открыть
          </Button>
          <Button
            danger
            type="text"
            aria-label={`Удалить историю ${item.symbol}`}
            icon={<Trash2 size={15} />}
            loading={removing === `market:${item.category}:${item.symbol}`}
            onClick={() => askRemoveHistory(item)}
          />
        </Space>
      ),
    },
  ];

  return (
    <>
      <Button
        className={iconOnly ? "historyIconBtn" : undefined}
        icon={<Database size={16} />}
        aria-label="История"
        onClick={() => setOpen(true)}
      >
        {iconOnly ? null : "История"}
      </Button>
      <Modal title="Локальная история" open={open} width={850} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
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
            <Form.Item name="category" noStyle>
              <Select
                style={{ width: 105 }}
                onChange={changeCategory}
                options={CATEGORIES.map((value) => ({ value, label: value }))}
              />
            </Form.Item>
            <Form.Item name="symbol" rules={[{ required: true }]} noStyle>
              {listedInstruments.length
                ? (
                  <Select
                    style={{ width: 235 }}
                    showSearch
                    optionFilterProp="label"
                    options={listedInstruments.map((item) => ({
                      value: item.symbol,
                      label: `${item.symbol} · ${item.title}`,
                    }))}
                  />
                )
                : <Input style={{ width: 130 }} placeholder="BTCUSDT" />}
            </Form.Item>
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
