export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
export type Trade={id:string;side:'LONG'|'SHORT';entryTime:number;createdTime?:number;entry:number;size:number;sl:number;tp:number;exitTime?:number;exit?:number;result?:number;status:'PENDING'|'OPEN'|'CLOSED';orderType?:'MARKET'|'LIMIT';leverage?:number;inputUnit?:'USDT'|'COIN';inputValue?:number;comment:string;outcome?:'TP'|'SL'|'TIMEOUT'|'MANUAL'};
export type Barrier={id:string;entryTime:number;upper:number;lower:number;timeLimit:number;outcome?:'TP'|'SL'|'TIMEOUT'};
export type Persisted={datasets:{id:string;name:string;candles:Candle[]}[];trades:Trade[];annotations:Barrier[]};
