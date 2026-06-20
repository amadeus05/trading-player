import { useEffect, useState } from "react";
import { Alert, App as AntApp, Button, DatePicker, Form, Input, Modal, Progress, Select, Space, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { Database, Download, RefreshCw } from "lucide-react";
import type { Candle } from "./types";

type CatalogItem={category:string;symbol:string;from:number;to:number;candles:number;bytes:number};
type Job={id:string;status:string;progress:number;completedPages:number;totalPages:number;candles:number;error?:string};
const date=(ms:number)=>dayjs(ms).format("YYYY-MM-DD");

export function HistoryManager({onOpen}:{onOpen:(market:{id:string;name:string;candles:Candle[]})=>void}){
  const {message}=AntApp.useApp();
  const [open,setOpen]=useState(false),[catalog,setCatalog]=useState<CatalogItem[]>([]),[job,setJob]=useState<Job|null>(null),[loading,setLoading]=useState(false);
  const [form]=Form.useForm<{category:string;symbol:string;range:[Dayjs,Dayjs]}>();
  const refresh=()=>fetch("/api/market/catalog").then(r=>r.json()).then(setCatalog).catch(()=>message.error("Не удалось прочитать каталог"));
  useEffect(()=>{if(open)refresh()},[open]);
  const openRange=async(category:string,symbol:string,from:number,to:number)=>{setLoading(true);try{const params=new URLSearchParams({category,symbol,timeframe:"5m",from:String(from),to:String(to)});const response=await fetch(`/api/market/candles?${params}`);if(!response.ok)throw new Error((await response.json()).error);const rows=await response.json();const candles:Candle[]=rows.map((r:any)=>({time:Number(r.openTime??r.open_time)/1000,open:+r.open,high:+r.high,low:+r.low,close:+r.close,volume:+r.volume}));onOpen({id:`market:${category}:${symbol}`,name:`${symbol} · Bybit`,candles});setOpen(false);message.success(`Открыто ${candles.length} свечей`)}catch(e){message.error(e instanceof Error?e.message:String(e))}finally{setLoading(false)}};
  const download=async()=>{const values=await form.validateFields();const from=values.range[0].startOf("day").valueOf(),to=values.range[1].add(1,"day").startOf("day").valueOf();setLoading(true);try{const response=await fetch("/api/market/download",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({category:values.category,symbol:values.symbol.toUpperCase(),from,to})});const created=await response.json();if(!response.ok)throw new Error(created.error);setJob(created);const source=new EventSource(`/api/market/jobs/${created.id}/events`);source.onmessage=(event)=>{const next=JSON.parse(event.data) as Job;setJob(next);if(next.status==="completed"){source.close();setLoading(false);refresh();void openRange(values.category,values.symbol.toUpperCase(),from,to)}else if(next.status==="failed"){source.close();setLoading(false);message.error(next.error||"Ошибка загрузки")}};source.onerror=()=>{source.close();setLoading(false)}}catch(e){setLoading(false);message.error(e instanceof Error?e.message:String(e))}};
  const columns=[{title:"Рынок",render:(_:unknown,r:CatalogItem)=><><b>{r.symbol}</b> <Tag>{r.category}</Tag></>},{title:"Покрытие",render:(_:unknown,r:CatalogItem)=>`${date(r.from)} — ${date(r.to-1)}`},{title:"5m свечей",dataIndex:"candles",render:(v:number)=>v.toLocaleString()},{title:"Размер",dataIndex:"bytes",render:(v:number)=>`${(v/1024/1024).toFixed(1)} MB`},{title:"",render:(_:unknown,r:CatalogItem)=><Button size="small" onClick={()=>openRange(r.category,r.symbol,Math.max(r.from,r.to-30*86400000),r.to)}>Открыть 30 дней</Button>}];
  return <><Button icon={<Database size={16}/>} onClick={()=>setOpen(true)}>История</Button><Modal title="История Bybit" open={open} width={850} onCancel={()=>setOpen(false)} footer={null} destroyOnHidden>
    <Form form={form} layout="inline" initialValues={{category:"linear",symbol:"BTCUSDT",range:[dayjs().subtract(30,"day"),dayjs().subtract(1,"day")]}} className="history-form">
      <Form.Item name="category"><Select style={{width:105}} options={["linear","spot","inverse"].map(value=>({value,label:value}))}/></Form.Item>
      <Form.Item name="symbol" rules={[{required:true}]}><Input style={{width:130}} placeholder="BTCUSDT"/></Form.Item>
      <Form.Item name="range" rules={[{required:true}]}><DatePicker.RangePicker allowClear={false}/></Form.Item>
      <Form.Item><Button type="primary" icon={<Download size={15}/>} loading={loading} onClick={download}>Загрузить</Button></Form.Item>
    </Form>
    {job&&!["completed","failed"].includes(job.status)&&<div className="download-progress"><Space><RefreshCw size={15}/><b>{job.status}</b><span>{job.completedPages}/{job.totalPages} страниц · {job.candles.toLocaleString()} свечей</span></Space><Progress percent={job.progress} status="active"/></div>}
    {!catalog.length?<Alert type="info" showIcon title="Локальной истории пока нет"/>:<Table rowKey={r=>`${r.category}:${r.symbol}`} dataSource={catalog} columns={columns} pagination={false} size="small"/>}
  </Modal></>;
}
