import assert from 'node:assert/strict';
import { Character } from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';
import { useSessionAction,sessionState,advanceTurn } from '../app/js/model/session.js';
import { effectiveAction } from '../app/js/model/action-features.js';
import { executeChainAction,followupChoices,previewChainUse,dismissFollowup,unfold } from '../app/js/model/session-chains.js';
import { sessionRollSpec } from '../app/js/model/session-rolls.js';
import { rollText } from '../app/js/roll20.js';
import { renderSessionBoard } from '../app/js/ui/panels/session.js';
// A follow-up offered after the Use, as a link was before routines.
const link = l => ({id:'l1',after:'',when:'after',...l});
const m = new Character(blankDocument({name:'Chains',level:5}));
m.trackers.push({id:'power',name:'Power',current:0,max:8,maxFormula:'8',min:0,minFormula:'0',source:'player'});
m.set('progression.actionFeatures', [{id:'music',className:'Warlord',title:'Infernal Musician',type:'standard',resource:'power',cost:'1',damageFormula:'2d6',steps:[link({target:'card:totems',action:'free',note:'Granted by a feat',required:false})]},
  {id:'finish',className:'Warlord',title:'Finish',type:'swift',steps:[]}]);
m.set('session.cards',[
  {id:'music-card',source:'class-feature:music',type:'standard'},
  {id:'totems',kind:'choice',title:'Totems',type:'standard'},
  {id:'fire',title:'Fire totem',type:'standard',groupId:'totems',resource:'power',cost:'2',steps:[link({target:'feature:finish',action:'free',required:true})]},
  {id:'ice',title:'Ice totem',type:'standard',groupId:'totems',resource:'power',cost:'3'}]);
const card = id=>m.data.session.cards.find(c=>c.id===id);
assert.equal(effectiveAction(m,card('music-card')).damageFormula,'2d6');
m.set('progression.actionFeatures.0.damageFormula','3d6');
assert.equal(effectiveAction(m,card('music-card')).damageFormula,'3d6','source updates shortcut');
assert.equal(useSessionAction(m,card('music-card')),'');
assert.equal(m.trackers.find(t=>t.id==='power').current,1);
assert.equal(m.data.session.spent.standard,1);
assert.match(useSessionAction(m,{type:'free'}),/pending chain/);
let p = m.data.session.pendingFollowups[0];
assert.equal(followupChoices(m,p).length,2);
assert.equal(previewChainUse(m,card('fire'),p.id).error,'');
assert.equal(executeChainAction(m,card('fire'),p.id),'');
assert.equal(m.trackers.find(t=>t.id==='power').current,3,'free action retains resource cost');
assert.equal(card('fire').type,'standard','override is not permanent');
assert.equal(m.data.session.spent.standard,1);
assert.equal(m.data.session.cards.find(c=>c.id==='totems').selectedId,'fire');
p = m.data.session.pendingFollowups[0];
assert.equal(dismissFollowup(m,p.id),false,'required link cannot skip');
const saved = new Character(JSON.parse(JSON.stringify(m.toJSON())));
assert.deepEqual(sessionState(saved),sessionState(m));
const turn = m.data.session.turn;
advanceTurn(m,true); assert.equal(m.data.session.turn,turn,'pending chain blocks next turn');
assert.equal(executeChainAction(m,followupChoices(m,p)[0],p.id),'');
assert.equal(m.data.session.pendingFollowups.length,0);
m.undo(); assert.equal(m.data.session.pendingFollowups.length,1,'undo restores consumed offer');
m.undo(); assert.equal(m.trackers.find(t=>t.id==='power').current,1,'undo restores followup resource cost');
p=m.data.session.pendingFollowups[0];
assert.equal(dismissFollowup(m,p.id),true);
advanceTurn(m,true);
m.set('progression.actionFeatures.0.steps',[link({target:'card:music-card',action:'free'})]);
assert.equal(useSessionAction(m,card('music-card')),'');
p=m.data.session.pendingFollowups[0];
assert.match(previewChainUse(m,card('music-card'),p.id).error,/Cycle/);
const before=m.trackers.find(t=>t.id==='power').current;
assert.match(executeChainAction(m,card('music-card'),p.id),/Cycle/);
assert.equal(m.trackers.find(t=>t.id==='power').current,before);
assert.ok(renderSessionBoard(m).includes('Cycle stopped'));
m.set('session.pendingFollowups',[]);advanceTurn(m,true);
m.set('progression.actionFeatures.0.steps',[link({target:'card:ice',action:'free',waiveResource:true})]);
useSessionAction(m,card('music-card'));p=m.data.session.pendingFollowups[0];
const cost=m.trackers.find(t=>t.id==='power').current;
assert.equal(executeChainAction(m,card('ice'),p.id),'');assert.equal(m.trackers.find(t=>t.id==='power').current,cost);
assert.ok(renderSessionBoard(m).includes('session-width-2'),'linked cards grow automatically');
console.log('Ability chains: class sources, multi-step groups, one-use overrides, resources, undo, cycles and persistence passed');

// A blender's full attack is one card whose `then` steps run with it: two
// claws (the second at -5) and a kinetic blast, Rend on a claw's hit, and a
// free blast on Rend's crit.
{
  const r = new Character(blankDocument({name:'Blender',level:8}));
  r.trackers.push({id:'burn',name:'Burn',current:0,max:10,maxFormula:'10',min:0,minFormula:'0',source:'player'});
  const step = (id,after,when,target,more={}) => ({id,after,when,target,...more});
  r.set('session.cards',[
    {id:'claw',title:'Claw',type:'standard',attackFormula:'10',damageFormula:'1d6+4'},
    {id:'blast',title:'Kinetic blast',type:'standard',attackFormula:'12',damageFormula:'4d6',resource:'burn',cost:'1'},
    {id:'rend',title:'Rend',type:'standard',damageFormula:'2d6+6'},
    {id:'full',title:'Full attack',type:'full',steps:[
      step('a','','then','card:claw'), step('b','','then','card:claw',{attackModifier:'-5'}), step('c','','then','card:blast'),
      step('d','a','hit','card:rend',{action:'free'}), step('e','d','crit','card:blast',{action:'free',waiveResource:true})]}]);
  const card = id=>r.data.session.cards.find(c=>c.id===id), index = id=>r.data.session.cards.indexOf(card(id));
  const run = unfold(r,card('full'));
  assert.deepEqual(run.parts.map(p=>p.title),['Full attack','Claw','Claw','Kinetic blast'],'then steps run in order, the same card twice');
  assert.deepEqual(run.offers.map(o=>[o.step.id,o.from]),[['d','Claw']],'a branch is offered after the step it hangs from');

  const lines = rollText(sessionRollSpec(r,`${index('full')}:routine`),'template').split('\n');
  assert.equal(lines.length,4,'a message per step with rolls, then the branches');
  assert.match(lines[1],/1d20\+5\]\]/,'the second claw takes its own modifier');
  assert.match(lines[3],/\{\{On a hit after Claw=\[Rend\]\(!%NEWLINE%/,'Rend is a button under the claw');
  assert.match(lines[3],/\{\{On a crit after Rend=\[Kinetic blast\]\(!%NEWLINE%/,'and a branch of a branch joins the same card');
  assert.match(renderSessionBoard(r),/data-roll="session\|3:routine"/,'the card offers the routine copy');

  // Two steps that each fit can still overdraw a resource together; then nothing is spent.
  r.data.session.cards[3].steps.push(step('c2','','then','card:blast'));
  r.trackers.find(t=>t.id==='burn').current = 9;
  assert.match(useSessionAction(r,card('full')),/Not enough Burn/);
  assert.equal(r.trackers.find(t=>t.id==='burn').current,9);
  assert.equal(r.data.session.spent?.standard || 0,0,'and no action either');
  r.data.session.cards[3].steps.pop();

  assert.equal(useSessionAction(r,card('full')),'');
  assert.equal(r.trackers.find(t=>t.id==='burn').current,10,'the blast step pays its burn');
  assert.deepEqual([r.data.session.spent.standard,r.data.session.spent.move],[1,1],'under the card’s one full-round action');
  let p = r.data.session.pendingFollowups[0];
  assert.deepEqual([p.when,p.from],['hit','Claw']);
  assert.equal(executeChainAction(r,followupChoices(r,p)[0],p.id),'');
  p = r.data.session.pendingFollowups[0];
  assert.deepEqual([p.when,p.from,p.step],['crit','Rend','e'],'Rend brings the step under it');
  assert.equal(executeChainAction(r,followupChoices(r,p)[0],p.id),'','the waived blast needs no burn');
  assert.equal(r.trackers.find(t=>t.id==='burn').current,10);
  assert.equal(r.data.session.pendingFollowups.length,0);

  // A `then` step that leads back to its own card stops before anything is spent.
  r.set('session.cards.0.steps',[step('x','','then','card:full')]);
  advanceTurn(r,true);
  assert.match(previewChainUse(r,card('full')).error,/Cycle/);
  assert.match(useSessionAction(r,card('full')),/Cycle/);
  assert.equal(r.data.session.spent.standard || 0,0);
}

// Links saved before routines load as `after` steps, the same on every load.
{
  const doc = blankDocument({name:'Old links',level:3});
  doc.progression = {...doc.progression, actionFeatures:[{id:'f',className:'Monk',title:'Strike',type:'standard',links:[{target:'card:x',action:'free',required:true,note:'Feat'}]}]};
  doc.session = {cards:[{id:'x',title:'X',type:'standard',links:[{target:'feature:f'}]},{id:'y',title:'Y',type:'standard'}]};
  const old = new Character(doc);
  assert.deepEqual(old.data.progression.actionFeatures[0].steps.map(s=>[s.id,s.after,s.when,s.target,s.action,s.required,s.note]),[['link1','','after','card:x','free',true,'Feat']]);
  assert.equal('links' in old.data.session.cards[0],false);
  assert.equal(old.data.session.cards[0].steps[0].target,'feature:f');
  assert.equal('steps' in old.data.session.cards[1],false,'a card that had no links gains nothing');
  assert.deepEqual(new Character(JSON.parse(JSON.stringify(old.toJSON()))).toJSON(),old.toJSON());
}
console.log('Routines: then steps, shared costs, nested branches, the Roll20 copy, cycles and the links migration passed');
