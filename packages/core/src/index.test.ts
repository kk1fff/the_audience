import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { pickAgents, validText, validMessage, shouldMiss, delayMs } from './index.ts';
test('text limits',()=>{ assert.equal(validText('hello'),true);assert.equal(validText('  '),false);assert.equal(validText('x'.repeat(281)),false); });
test('agent selection stays in bounds without duplicates',()=>{ for(const n of [0,1,2,3,8]) { const chosen=pickAgents(Array.from({length:n},(_,i)=>i),()=>0.5);assert.equal(new Set(chosen).size,chosen.length);assert.ok(chosen.length>=Math.min(2,n)&&chosen.length<=Math.min(4,n)); } });
test('delays stay in expected windows',()=>{ assert.equal(delayMs('post',()=>0),5000);assert.equal(delayMs('reply',()=>0),15000); });

test('image-only messages are valid',()=>{assert.equal(validMessage('',1),true);assert.equal(validMessage('',0),false);assert.equal(validMessage('x'.repeat(281),1),false);assert.equal(validMessage('',5),false);});

test('mock misses are deterministic; live misses use chance',()=>{assert.equal(shouldMiss('mock',true,()=>1),true);assert.equal(shouldMiss('mock',false,()=>0),false);assert.equal(shouldMiss('ollama',false,()=>0.1),true);assert.equal(shouldMiss('ollama',true,()=>0.5),false);});
