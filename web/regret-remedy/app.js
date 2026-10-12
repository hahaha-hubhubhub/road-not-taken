const $=id=>document.getElementById(id);
const screens=['home','pill-screen','input-screen','swallowing','story-screen','envelope-screen','letter-screen'];
let act=0, input='', story=null, busy=false, transitionTimer=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const stories={
 career:{titles:['你真的出发了。','自由，也有星期一。','你慢慢有了自己的节奏。'],scenes:['第一天，你把旧工牌收进抽屉。\n新的日程还很空，窗外的天很亮。\n这一次，你想试试由自己安排生活。','后来，没人替你决定方向，\n也没人替你确认每一步。\n你会兴奋，也会在普通的周一犹豫。','有一天，你不再急着证明当初选得对。\n你只是做完手里的事，出门走了一会儿。\n那条路，终于从想象变成了日常。'],letter:'我走了你一直想试试的那条路。\n有喜欢的清晨，也有拿不准的晚上。\n\n我没法替你证明，哪一个选择更好。\n但你想要的那种生活，不必只存在于当年。'},
 study:{titles:['你坐进了另一间教室。','热爱，也有改了又改的草稿。','你留下了自己的作品。'],scenes:['第一节课，你翻开一本空白笔记。\n老师写下题目，你没有急着找答案。\n原来，期待上课也是一种感觉。','后来，你也会对着草稿发呆，\n把同一个想法改了又改。\n喜欢没有让一切变容易，却让你想再试一次。','几年后的一个下午，你整理旧作业。\n有些笨拙，有些连自己都惊讶。\n你看见了一个一直在尝试的自己。'],letter:'在这里，我学了你当时想学的东西。\n我没有每天都开心，也没有每天都后悔。\n\n你可以惦记这条路。\n如果那份喜欢还在，也许今天还能给它一点时间。'},
 relationship:{titles:['那句话，你说出口了。','故事没有停在那一刻。','后来，你们都有了新的日常。'],scenes:['你终于把那句话说了出来。\n对方安静地听着，杯子里的水还温着。\n这一刻，没有你想象中的背景音乐。','你们有过靠近，也有过没能说清楚的时候。\n一句话打开了可能，\n却没有替你们写好往后的每一天。','后来，你记住的不只有那个选择。\n还有一次散步、一句普通的问候。\n日子比当初那个瞬间，长了很多。'],letter:'在我的时间线里，那句话说出口了。\n但它也没有让所有问题自动消失。\n\n你可以想念那个人，也可以想念当时的自己。\n不用今天就把这份遗憾整理成一个答案。'},
 other:{titles:['那个如果，发生了。','另一条路，也慢慢成了日常。','你走到一个新的下午。'],scenes:['那一天，你做了另一个选择。\n没有盛大的开场，只是走出了熟悉的门。\n你开始发现，生活还可以有另一种样子。','新鲜感过去以后，你也有过迟疑。\n有一些意外的好，也有没预料到的难。\n你一点点学会在这里生活。','某个普通的下午，你停下来望向窗外。\n你没有成为完美的自己。\n你只是又认真过了一天。'],letter:'我替你走了一次那个「如果」。\n这里也有好天气，也有没想明白的事。\n\n我不能替你宣布，当年的选择是对还是错。\n只是想告诉你：你还可以继续写自己的故事。'}
};
function show(id){screens.forEach(s=>$(s).hidden=s!==id);$('reset').hidden=id==='home';window.scrollTo({top:0,behavior:'instant'});const title=$(id).querySelector('h1,h2');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}
function reset(){clearTimeout(transitionTimer);busy=false;act=0;$('bottle').classList.remove('uncap');$('bottle').disabled=false;$('regret-form').reset();$('counter').textContent='0 / 300';$('error').hidden=true;$('saved').hidden=true;show('home');}
$('bottle').onclick=()=>{if(busy)return;busy=true;$('bottle').disabled=true;$('bottle').classList.add('uncap');transitionTimer=setTimeout(()=>{show('pill-screen');busy=false;},reduced?10:700)};
$('pill').onclick=()=>show('input-screen');
$('regret').oninput=()=>{$('counter').textContent=`${$('regret').value.length} / 300`;$('error').hidden=true};
document.querySelector('[data-back]').onclick=()=>show('pill-screen');
$('regret-form').onsubmit=e=>{e.preventDefault();input=$('regret').value.trim();if(input.length<5){$('error').textContent='再多说一点吧，至少写 5 个字。';$('error').hidden=false;$('regret').focus();return;}
const category=/分手|恋爱|结婚|表白|爱人|感情|那句话/.test(input)?'relationship':/专业|学校|学[习美艺建设]|大学|读书|画画|设计|计算机/.test(input)?'study':/辞职|工作|城市|北京|上海|杭州|大理|出国|创业|搬|离开/.test(input)?'career':'other';story=stories[category];act=0;show('swallowing');transitionTimer=setTimeout(renderAct,reduced?300:2300)};
function renderAct(){$('chapter').textContent=['第一幕 · 开始','第二幕 · 日常','第三幕 · 后来'][act];document.querySelectorAll('.progress i').forEach((e,i)=>e.classList.toggle('current',i<=act));$('origin').textContent=`你说：「${input}」`;$('story-title').textContent=story.titles[act];$('narrative').textContent=story.scenes[act];$('scene').dataset.act=act;$('next').innerHTML=act===2?'旅程结束了吗？ <span>↗</span>':'看看后来 <span>→</span>';$('prev').hidden=act===0;show('story-screen');}
$('next').onclick=()=>{if(act<2){act++;renderAct()}else show('envelope-screen')};$('prev').onclick=()=>{if(act>0){act--;renderAct()}};
$('open-letter').onclick=()=>{$('letter-body').replaceChildren();const p=document.createElement('p');p.textContent=story.letter;$('letter-body').append(p);show('letter-screen')};
$('save').onclick=()=>{const text=`给现在的我：\n\n关于你写下的「${input}」\n\n${story.letter}\n\n另一个你\n\n此信来自虚构的平行人生体验。当前为设计演示，未调用模型。`;const blob=new Blob([text],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='另一个你寄来的信.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('saved').textContent='信已保存。留给某个想再读一遍的日子。';$('saved').hidden=false;};
$('again').onclick=reset;$('reset').onclick=reset;
