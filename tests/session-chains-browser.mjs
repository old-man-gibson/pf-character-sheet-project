import '../app/js/sheet-element.js';
import { blankDocument } from '../app/js/convert.js';
import { forget } from '../app/js/history.js';
const assert=(v,m)=>{if(!v)throw new Error(m);};
const pause=()=>new Promise(r=>setTimeout(r,40));
document.querySelector('#run').onclick=async()=>{
  const doc=blankDocument({name:'Ability chain checks',level:5});
  doc.id=`chain-browser-${Date.now()}`;
  doc.classes=[{name:'Warlord',level:5}];
  doc.uiPrefs={viewMode:'build'};
  doc.session={cards:[{id:'totems',kind:'choice',title:'Totems',type:'standard'},
    {id:'fire',groupId:'totems',title:'Fire totem',type:'standard',damageFormula:'2d6',links:[{target:'card:finish',action:'free',required:true}]},
    {id:'ice',groupId:'totems',title:'Ice totem',type:'standard'},
    {id:'finish',title:'Finish',type:'swift'}]};
  const sheet=document.createElement('character-sheet');
  document.querySelector('#mount').replaceChildren(sheet);sheet.character=doc;await sheet.whenReady();
  const find=s=>sheet.shadowRoot.querySelector(s);
  const click=async s=>{assert(find(s),`Missing ${s}`);find(s).click();await pause();};
  const change=async(s,v)=>{assert(find(s),`Missing ${s}`);find(s).value=v;find(s).dispatchEvent(new Event('change'));await pause();};
  const test=async(name,fn)=>{await fn();const li=document.createElement('li');li.textContent=`PASS: ${name}`;document.querySelector('#results').append(li);};
  try {
    await test('Class feature editor creates, links and pins an ability',async()=>{
      await click('[data-tabkey="progression"]');
      await click('[data-feature-add="Warlord"]');
      await change('[data-feature-field="title"]','Infernal Musician');
      await change('[data-feature-field="damageFormula"]','3d6');
      await click('[data-link-add="feature:0"]');
      await change('[data-link-field="target"]','card:totems');
      await change('[data-link-field="action"]','free');
      await click('[data-feature-pin="0"]');
      assert(sheet.model.data.session.cards.at(-1).source.startsWith('class-feature:'),'Not linked');
    });
    await test('Pinned feature displays live values and adjustable width',async()=>{
      sheet.model.set('uiPrefs.viewMode','session');
      await click('[data-tabkey="overview"]');
      const card=find('[data-session-command="use"][data-index="4"]').closest('.session-option');
      assert(card.textContent.includes('Infernal Musician')&&card.textContent.includes('3d6'),'Missing feature values');
      assert(card.classList.contains('session-width-2'),'Automatic width missing');
      await change('[data-session-field="cards.4.width"]','3');
      assert(find('[data-session-command="use"][data-index="4"]').closest('.session-option').classList.contains('session-width-3'),'Width override missing');
    });
    await test('Card spans adapt to three, two and one available columns',async()=>{
      const board=find('.session-board');
      for(const [width,span] of [[900,3],[700,2],[420,1]]) {
        board.style.width=`${width}px`;await pause();
        const card=find('[data-session-command="use"][data-index="4"]').closest('.session-option');
        assert(getComputedStyle(card).gridColumn.includes(`span ${span}`),`Wrong span at ${width}px`);
      }
      board.style.width='';
    });
    await test('Using the parent presents choices and blocks a new turn',async()=>{
      await click('[data-session-command="use"][data-index="4"]');
      assert(find('[data-chain-card="fire"]')&&find('[data-chain-card="ice"]'),'Missing follow-up choices');
      assert(find('[data-session-command="next"]').disabled,'Turn not blocked');
      assert(sheet.model.data.session.spent.standard===1,'Parent action not spent');
    });
    await test('Free choice opens its own required follow-up',async()=>{
      await click('[data-chain-card="fire"]');
      assert(find('[data-chain-card="finish"]'),'Next link missing');
      assert(!find('[data-chain-skip]'),'Required step is skippable');
      assert(sheet.model.data.session.spent.standard===1,'Free choice spent another standard');
      await click('[data-chain-card="finish"]');
      assert(!find('.session-chain-pending'),'Chain did not finish');
      assert(!find('[data-session-command="next"]').disabled,'Turn not released');
    });
    document.querySelector('#status').textContent='All ability chain browser checks passed';
  }catch(e){document.querySelector('#status').textContent=`FAIL: ${e.message}`;}
  finally {await forget(doc.id);}
};
