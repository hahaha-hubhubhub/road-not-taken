import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { generateStory } from '../dist/llm/generate.js';
import { checkStoryQuality } from '../dist/llm/quality.js';
import { StorySchema, normalizeStory } from '../dist/llm/schema.js';
import { pickDemoCase } from '../dist/llm/demoCases.js';
import { buildUserPrompt, createNarrativeDirection } from '../dist/llm/prompt.js';
import { checkInput } from '../dist/llm/safety.js';

const input='如果当时没有学计算机，而是去上海学设计，我想做自己的作品，但又舍不得家里。';
const captions=[
'你在上海的第一堂设计课上，把纸折成了想象中的小书。老师没有先问就业，而是让你解释为什么选这个颜色。你拍下那页草稿发回家，消息发出去后才发现自己手上还有铅笔灰。走出教室时，你第一次盼着下次课来得快一点。',
'半年后，设计展前的一次修改让你忙了一整晚。你舍不得删去最喜欢的那页，却发现读者看不懂；回家吃饭的车票也因布展换了日期。你给家里打电话，一边解释展览，一边把那页折好的小书摊开，试着重画它的开头。',
'第三年，你在上海一间小工作室里重新翻到那本纸做的小书。新作品更清楚，却还留着当年偏爱的那一点颜色。家里的人来参观时没问卖了多少，只认出了那张发过照片的草稿。你给他们搬来凳子，终于能慢慢讲完这件事。',
];
const valid={title:'另一条路上的小书',anchors:['上海','设计'],scenes:captions.map((detail,i)=>({heading:['这页，我想留着。','不删？那就再改。','你慢慢讲，我们听。'][i],detail,caption:detail.slice(0,65),image_prompt:'黑白线描：同一位穿深色外套的成年人在桌前折纸，桌面草稿与铅笔'})),ending:'那一点颜色，还在。',letter:'我在另一条时间线里，去了上海学设计。你发给家里的那张照片，在这里是一张手上带着铅笔灰的草稿。我也曾舍不得把最喜欢的那页删掉，后来给来看展的家人搬凳子时，才明白原来作品也可以成为解释自己的方式。\n\n这条路不是一张没有改过的稿纸，家里的牵挂也没有因此消失。我不知道你的那份遗憾今天有多重，只想把那本小书折起来寄给你。你可以暂时没有答案，我们都还在过自己的日子。',disclaimer:'虚构'};

test('rich schema stays compatible with legacy stories; normalizes new fields',()=>{
 assert.equal(StorySchema.safeParse(valid).success,true);
 const {letter,anchors,...old}=valid; old.scenes=old.scenes.map(({detail,heading,...scene})=>scene); assert.equal(StorySchema.safeParse(old).success,true);
 assert.equal(normalizeStory(valid).letter,valid.letter);
 assert.equal(normalizeStory(valid).scenes[0].heading,valid.scenes[0].heading);
 assert.deepEqual(checkStoryQuality(input,valid),[]);
});
test('rejects invented anchors, anchors only in title, missing letter and repeated acts',()=>{
 const bad={...valid,anchors:['巴黎'],letter:undefined,scenes:[valid.scenes[0],valid.scenes[0],valid.scenes[0]]};
 const errors=checkStoryQuality(input,bad).join(' ');
 assert.match(errors,/原文/);assert.match(errors,/兑现/);assert.match(errors,/来信/);assert.match(errors,/重复/);
 assert.ok(checkStoryQuality(input,{...valid,anchors:['当时']}).length);
});
test('demonstrations match explicit topics instead of hashing unrelated input',()=>{
 assert.equal(pickDemoCase('如果我去了大理开咖啡店').id,'dali');
 assert.equal(pickDemoCase('如果我当时没有和他分手').id,'stay');
 assert.equal(pickDemoCase('如果我当时去巴黎学习建筑').id,'generic');
 assert.equal(pickDemoCase('如果我当时和他分手').id,'generic');
});
test('input preserves constraints and longer context; variation is in narrative framing',()=>{
 assert.match(buildUserPrompt(input,'一个清晨'),/没有学计算机/);
 assert.match(buildUserPrompt(input,'一个清晨'),/一个清晨/);
 assert.ok(new Set(Array.from({length:60},createNarrativeDirection)).size>1);
 assert.equal(checkInput('如果当时'+ '去学设计'.repeat(50)).safe,true);
 assert.equal(checkInput('想死').reason,'crisis');
});
test('model pipeline retries bad grounding with same direction; safety routes without call',async()=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push(JSON.parse(body));
  const story=requests.length===1?{...valid,anchors:['巴黎']}:valid;
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({id:'local-fixture',object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(story)}}],usage:{completion_tokens:500}}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const base=`http://127.0.0.1:${server.address().port}/v1`;
  const result=await generateStory(input,'local-test-key','fixture-model',base);
  assert.equal(result.kind,'story');assert.equal(result.attempts,2);assert.equal(result.story.letter,valid.letter);
  const prompts=requests.map(r=>r.messages[1].content);
  const direction=p=>p.split('本次创作方向：')[1].split('\n')[0];
  assert.equal(direction(prompts[0]),direction(prompts[1]));
  assert.match(prompts[1],/校验问题/);
  assert.ok(requests[0].response_format.json_schema.schema.required.includes('letter'));
  const care=await generateStory('想死','local-test-key','fixture-model',base);
  assert.equal(care.kind,'care');assert.equal(requests.length,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
