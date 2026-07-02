import { Button, Dropdown, Select } from "antd";
import { CalendarDays, ChevronRight, Clock3, Crosshair, Dices, Flag, Pause, Play, RotateCcw } from "lucide-react";
import { HistoryManager } from "../datasets/HistoryManager";
import type { Candle, Dataset } from "../../types";
import { formatDateTime } from "../../shared/lib/market";

interface ReplayControlsProps {
  selectingStart: boolean;
  playing: boolean;
  speed: number;
  currentCandle?: Candle;
  replayIndex: number;
  candleCount: number;
  onMarketOpen: (market: Dataset) => void;
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
  replayIndex,
  candleCount,
  onMarketOpen,
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
          <Button className={selectingStart ? "select-start active" : "select-start"} icon={<Crosshair size={16} />}>
            {selectingStart ? "Кликните по свече" : "Выбрать старт"}
          </Button>
        </Dropdown>
        <Button type="text" aria-label="Сбросить replay" icon={<RotateCcw size={18} />} onClick={onReset} />
        <Button className="play" shape="circle" aria-label={playing ? "Пауза" : "Воспроизвести"} icon={playing ? <Pause size={20} /> : <Play size={20} />} onClick={() => onPlayingChange(!playing)} />
        <Button type="text" aria-label="Следующая свеча" icon={<ChevronRight size={22} />} onClick={onStep} />
        <Select
          value={speed}
          onChange={onSpeedChange}
          options={[1, 5, 10].map((value) => ({ value, label: `${value}×` }))}
          style={{ width: 70 }}
        />
      </div>
      <div className="replayClock">
        <div className="clock">
          <Clock3 size={15} />
          {currentCandle ? formatDateTime(currentCandle.time) : "—"}
          <span>{replayIndex + 1} / {candleCount}</span>
        </div>
      </div>
      <div className="replayPriceScaleSlot">
        <HistoryManager onOpen={onMarketOpen} iconOnly />
      </div>
    </div>
  );
}
