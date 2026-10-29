import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {summarizeBrowseResult,type BrowseResult} from './browse-results.ts';
const base:BrowseResult={queuedCount:2,pendingCount:0,runningCount:0,completedCount:0,failedBeforeReadCount:0,failedAfterReadCount:0,visits:[]};
test('browse summaries distinguish queued, running, completed, empty, and failed visits',()=>{
  assert.deepEqual(summarizeBrowseResult({...base,queuedCount:0}),{state:'completed',label:'Completed',summary:'No new content · no eligible threads to check',detail:''});
  assert.equal(summarizeBrowseResult({...base,pendingCount:2}).label,'Pending');
  const progress=summarizeBrowseResult({...base,pendingCount:1,completedCount:1,visits:[{postId:9,postText:'A post',postImageId:null,visitedAt:1}]});
  assert.equal(progress.label,'In progress');assert.match(progress.detail,/1 checked/);assert.match(progress.detail,/1 thread queued/);
  const visit={postId:9,postText:'A post',postImageId:null,visitedAt:1};
  assert.equal(summarizeBrowseResult({...base,completedCount:2,visits:[visit,{...visit,postId:10}]}).summary,'Visited 2 threads');
  const partial=summarizeBrowseResult({...base,completedCount:1,failedBeforeReadCount:1,visits:[visit]});
  assert.equal(partial.label,'Partly failed');assert.match(partial.summary,/1 failed before reading/);
  const failed=summarizeBrowseResult({...base,failedAfterReadCount:2});assert.equal(failed.label,'Failed');assert.match(failed.summary,/2 failed after reading/);
  assert.equal(failed.detail,'No completed thread visit to open.');
});
