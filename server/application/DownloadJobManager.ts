import { EventEmitter } from "node:events";
import type { DownloadRequest } from "../domain/MarketRequest.js";
import { MarketDataService } from "./MarketDataService.js";

export type JobStatus="queued"|"checking_local_data"|"downloading"|"validating"|"writing_parquet"|"completed"|"failed";
export interface DownloadJob {id:string;request:DownloadRequest;status:JobStatus;progress:number;completedPages:number;totalPages:number;candles:number;startedAt:number;finishedAt?:number;error?:string}

export class DownloadJobManager {
  private readonly jobs=new Map<string,DownloadJob>();
  private readonly events=new EventEmitter();
  constructor(private readonly service:MarketDataService){}

  create(request:DownloadRequest):DownloadJob{
    const job:DownloadJob={id:crypto.randomUUID(),request,status:"queued",progress:0,completedPages:0,totalPages:0,candles:0,startedAt:Date.now()};
    this.jobs.set(job.id,job);this.emit(job);void this.run(job);return job;
  }
  get(id:string){return this.jobs.get(id)}
  list(){return [...this.jobs.values()].sort((a,b)=>b.startedAt-a.startedAt)}
  subscribe(id:string,listener:(job:DownloadJob)=>void){const key=`job:${id}`;this.events.on(key,listener);const job=this.get(id);if(job)listener(job);return()=>this.events.off(key,listener)}
  private emit(job:DownloadJob){this.events.emit(`job:${job.id}`,{...job})}
  private async run(job:DownloadJob){
    try{
      const result=await this.service.download(job.request,(event)=>{job.status=event.stage as JobStatus;job.completedPages=event.completedPages;job.totalPages=event.totalPages;job.candles=event.candles;job.progress=event.totalPages?Math.min(95,Math.round(event.completedPages/event.totalPages*85)+(event.stage==="writing_parquet"?10:0)):event.stage==="checking_local_data"?2:0;this.emit(job)});
      Object.assign(job,{status:"completed",progress:100,candles:result.candles,finishedAt:Date.now()});this.emit(job);
    }catch(error){Object.assign(job,{status:"failed",error:error instanceof Error?error.message:String(error),finishedAt:Date.now()});this.emit(job)}
  }
}
