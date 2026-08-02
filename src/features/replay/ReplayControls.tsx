import { Button, Dropdown, Select, Spin } from "antd";
import { CalendarDays, ChevronRight, Clock3, Crosshair, Dices, Flag, Pause, Play, RotateCcw } from "lucide-react";
import { HistoryManager } from "../datasets/HistoryManager";
import type { Candle, Dataset } from "../../types";
import { formatDateTime } from "../../shared/lib/market";

interface ReplayControlsProps {
  selectingStart: boolean;
  playing: boolean;
  speed: number;
  currentCandle?: Candle;
  /** Позиция головы и объём датасета — считаются от его границ, а не от загруженного окна. */
  replayPosition: number;
  datasetCandleCount: number;
  startJumpPending?: boolean;
  onMarketOpen: (market: Dataset) => void;
  activeDatasetId?: string;
  onHistoryDeleted?: (datasetId: string) => void;
  onStartAction: (key: string) => void;
  onReset: () => void;
  onPlayingChange: (playing: boolean) => void;
  onStep: () => void;
  onSpeedChange: (speed: number) => void;
}

export function ReplayControls({
  selectingStart,
  playing,
  speed,
  currentCandle,
  replayPosition,
  datasetCandleCount,
  startJumpPending = false,
  onMarketOpen,
  activeDatasetId,
  onHistoryDeleted,
  onStartAction,
  onReset,
  onPlayingChange,
  onStep,
  onSpeedChange,
}: ReplayControlsProps) {
  return (
    <div className="replay">
      <div className="replayControls">
        <Dropdown
          trigger={["click"]}
          disabled={startJumpPending}
          menu={{
            onClick: ({ key }) => onStartAction(key),
            items: [
              { key: "bar", icon: <Crosshair size={15} />, label: "Выбрать свечу" },
              { key: "date", icon: <CalendarDays size={15} />, label: "Выбрать дату" },
              { key: "first", icon: <Flag size={15} />, label: "Первая доступная" },
              { key: "random", icon: <Dices size={15} />, label: "Случайная свеча" },
            ],
          }}
        >
          <Button
            className={selectingStart ? "select-start active" : "select-start"}
            icon={<Crosshair size={16} />}
            loading={startJumpPending}
          >
            {selectingStart ? "Кликните по свече" : "Выбрать старт"}
          </Button>
        </Dropdown>
        <Button type="text" aria-label="Сбросить replay" icon={<RotateCcw size={18} />} disabled={startJumpPending} onClick={onReset} />
        <Button className="play" shape="circle" aria-label={playing ? "Пауза" : "Воспроизвести"} icon={playing ? <Pause size={20} /> : <Play size={20} />} disabled={startJumpPending} onClick={() => onPlayingChange(!playing)} />
        <Button type="text" aria-label="Следующая свеча" icon={<ChevronRight size={22} />} disabled={startJumpPending} onClick={onStep} />
        <Select
          value={speed}
          disabled={startJumpPending}
          onChange={onSpeedChange}
          options={[1, 2, 3, 4, 5, 10].map((value) => ({ value, label: `${value}×` }))}
          style={{ width: 70 }}
        />
      </div>
      <div className="replayClock">
        {startJumpPending ? (
          <div className="replayStatus" role="status" aria-live="polite">
            <Spin size="small" />
            <span>Загрузка окна истории...</span>
          </div>
        ) : null}
        <div className="clock">
          <Clock3 size={15} />
          {currentCandle ? formatDateTime(currentCandle.time) : "—"}
          <span>{replayPosition.toLocaleString("ru-RU")} / {datasetCandleCount.toLocaleString("ru-RU")}</span>
        </div>
      </div>
      <div className="replayPriceScaleSlot">
        <HistoryManager onOpen={onMarketOpen} iconOnly activeDatasetId={activeDatasetId} onDeleted={onHistoryDeleted} />
      </div>
    </div>
  );
}
