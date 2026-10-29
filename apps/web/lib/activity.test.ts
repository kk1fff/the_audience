import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { organizePostActivity } from './activity.ts';

test('completed reactions lead by activity time while no-action records stay counted', () => {
  const event = (id:number, outcome:string|null, status='done', completedAt:number|null=null, dueAt=1) => ({id,postId:7,source:id===6?'feed':'notification',outcome,status,completedAt,discoveredAt:null,dueAt});
  const records = [
    event(1,'not_selected','not_selected'),
    event(2,'liked','done',20,5),
    event(3,'missed','done',15),
    event(4,'commented','done',30,4),
    event(5,null,'pending',null,40),
    event(6,'liked_and_commented','done',50,2),
  ];
  const result = organizePostActivity(records);
  assert.deepEqual(result.reactions.map(item => item.id), [6,4,2]);
  assert.deepEqual(result.other.map(item => item.id), [5,3,1]);
  assert.deepEqual([...result.counts], [['pending',1],['missed',1],['not selected',1]]);
  assert.equal(result.reactions[0].source, 'feed');
});
