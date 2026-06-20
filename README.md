# Candle Lab

Локальный replay-терминал для тренировки торговли без доступа к будущим свечам.

## Запуск

```powershell
npm install
npm run dev
```

Откройте `http://localhost:5173`. Встроен демонстрационный набор BTCUSDT. Для своих данных загрузите CSV с колонками `time, open, high, low, close, volume`; `time` должен быть ISO-датой или timestamp, распознаваемым JavaScript.

Сделки, разметка и импортированные наборы сохраняются локально в `data/state.json`.
