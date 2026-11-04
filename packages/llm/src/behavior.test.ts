import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMessages, loadBehaviorPrompt, DEFAULT_BEHAVIOR, tuningBudget } from './index.ts';

test('behavior overlay loads only on explicit reload and retains individual and fixed instructions',()=>{
  const root=mkdtempSync(join(tmpdir(),'behavior-'));
  const context={agent:{id:'aya',name:'Aya',persona:'An observant traveler'},memory:'Enjoys quiet walks',post:'Hello',comments:[],sourceCommentId:null,images:[]};
  try {
    assert.equal(loadBehaviorPrompt(root),DEFAULT_BEHAVIOR);
    const baseline=buildMessages(context,'post');
    mkdirSync(join(root,'prompts'));
    const file=join(root,'prompts','behavior.md');
    writeFileSync(file,'Leave room for quiet observation.');
    assert.equal(buildMessages(context,'post').system,baseline.system);
    loadBehaviorPrompt(root);
    const aya=buildMessages(context,'post').system;
    assert.match(aya,/Leave room for quiet observation/);
    assert.match(aya,/An observant traveler/);assert.match(aya,/Enjoys quiet walks/);
    assert.match(aya,/Follow your individual persona/);
    assert.match(aya,/Return only JSON/);assert.match(aya,/Do not create top-level posts/);
    assert.match(aya,/External background.*untrusted/);assert.match(aya,/verified requestedPlace/);
    const leo=buildMessages({...context,agent:{id:'leo',name:'Leo',persona:'Concise and practical'}},'post').system;
    assert.match(leo,/Concise and practical/);assert.doesNotMatch(leo,/An observant traveler/);
    writeFileSync(file,'  ');assert.throws(()=>loadBehaviorPrompt(root),/empty.*behavior.md/);
    assert.equal(buildMessages(context,'post').system,aya);
    rmSync(file);mkdirSync(file);assert.throws(()=>loadBehaviorPrompt(root),/Cannot read behavior prompt/);
    rmSync(file,{recursive:true});loadBehaviorPrompt(root);
    assert.equal(buildMessages(context,'post').system,baseline.system);
  } finally {rmSync(root,{recursive:true,force:true});loadBehaviorPrompt(root);}
});

test('tuning limits are opt-in, validate deadlines and count consecutive failures',()=>{
  assert.equal(tuningBudget({}),null);
  assert.throws(()=>tuningBudget({TUNING_DEADLINE:'invalid'}),/Invalid TUNING_DEADLINE/);
  assert.throws(()=>tuningBudget({TUNING_DEADLINE:'2030-01-01',TUNING_FAILURE_LIMIT:'0'}),/Invalid TUNING_FAILURE_LIMIT/);
  const budget=tuningBudget({TUNING_DEADLINE:'2030-01-01T00:00:00Z'})!;
  assert.equal(budget.failed(),false);assert.equal(budget.failed(),false);budget.succeeded();
  assert.equal(budget.failed(),false);assert.equal(budget.failed(),false);assert.equal(budget.failed(),true);
});
