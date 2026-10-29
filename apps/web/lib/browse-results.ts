export type BrowseResult = {
  queuedCount:number;
  pendingCount:number;
  runningCount:number;
  completedCount:number;
  failedBeforeReadCount:number;
  failedAfterReadCount:number;
  visits:{postId:number;postText:string;postImageId:string|null;visitedAt:number}[];
};

export function summarizeBrowseResult(run:BrowseResult) {
  const failed=run.failedBeforeReadCount+run.failedAfterReadCount;
  const visited=run.visits.length;
  const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
  if(run.queuedCount===0) return {state:'completed',label:'Completed',summary:'No new content · no eligible threads to check',detail:''};
  if(run.pendingCount===run.queuedCount) return {state:'pending',label:'Pending',summary:`${plural(run.queuedCount,'thread')} queued · waiting to start`,detail:''};
  if(run.pendingCount+run.runningCount>0) {
    const checked=run.completedCount+run.failedAfterReadCount;
    const remaining=[run.runningCount?`${plural(run.runningCount,'thread')} running`:null,run.pendingCount?`${plural(run.pendingCount,'thread')} queued`:null].filter(Boolean).join(' · ');
    return {state:'progress',label:'In progress',summary:`Checking ${plural(run.queuedCount,'thread')}`,detail:`${checked} checked · ${remaining}${run.failedBeforeReadCount?` · ${plural(run.failedBeforeReadCount,'failure')} before reading`:''}`};
  }
  if(failed) return {state:visited>0||run.completedCount>0?'partial':'failed',label:visited>0||run.completedCount>0?'Partly failed':'Failed',summary:`${visited} visited · ${run.failedBeforeReadCount} failed before reading${run.failedAfterReadCount?` · ${run.failedAfterReadCount} failed after reading`:''}`,detail:visited?'Failed threads have no completed visit result.':'No completed thread visit to open.'};
  return {state:'completed',label:'Completed',summary:visited?`Visited ${plural(visited,'thread')}`:'No completed thread visit recorded',detail:''};
}
