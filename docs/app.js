const $ = (id) => document.getElementById(id);
const LOCAL = ['localhost','127.0.0.1'].includes(window.location.hostname) && window.location.port === '8765';
const state = {gpu:null, selected:'auto', effective:'cloud', duration:5, busy:false, space:localStorage.getItem('frameforge_space')||''};
const modeInputs = [...document.querySelectorAll('input[name=mode]')];
const video = $('video');

function msg(title, desc, progress=0, stateLabel='대기'){
  $('status-title').textContent=title;
  $('status-message').textContent=desc;
  $('progress').style.width=`${Math.min(100,Math.max(0,progress))}%`;
  $('result-pill').textContent=stateLabel;
}
function resetVideo(){video.hidden=true;video.pause();video.removeAttribute('src');video.load();$('placeholder').hidden=false;$('download').classList.add('disabled');$('download').setAttribute('aria-disabled','true');$('download').removeAttribute('href');}
function showVideo(url){video.src=url;video.hidden=false;$('placeholder').hidden=true;$('download').href=url;$('download').classList.remove('disabled');$('download').setAttribute('aria-disabled','false');}
function setBusy(value){state.busy=value;$('generate').disabled=value;$('generate').innerHTML=value?'영상 생성 중…':'<span>✦</span> 영상 생성하기 <span class="arrow">↗</span>';}
function isGoodLocal(){return LOCAL && state.gpu?.connected===true && state.gpu.local_supported===true;}
function refreshEngine(){
  state.selected=document.querySelector('input[name=mode]:checked').value;
  state.effective=state.selected==='auto' ? (isGoodLocal()?'local':'cloud') : state.selected;
  $('engine-pill').textContent=state.effective==='local'?'내 GPU 선택됨':'클라우드 선택됨';
  if(state.gpu?.connected){
    const g=state.gpu;
    $('gpu-name').textContent=g.name;
    $('gpu-detail').textContent=`VRAM ${g.vram_gb}GB · 사용 ${g.used_vram_gb}GB · 남음 ${g.free_vram_gb}GB`;
    $('gpu-usage').textContent=(g.util_percent??'—')+'% 사용률';
    $('gauge-fill').style.width=(g.util_percent??0)+'%';
  }else{
    $('gpu-name').textContent=LOCAL?'NVIDIA GPU를 확인할 수 없음':'로컬 실행 프로그램이 연결되지 않음';
    $('gpu-detail').textContent=LOCAL?'NVIDIA 드라이버 또는 nvidia-smi를 확인해 줘.':'GPU 확인은 로컬 실행 프로그램을 켜야 가능해.';
    $('gpu-usage').textContent='—';$('gauge-fill').style.width='0%';
  }
  const text = (state.selected==='auto') ?
    (isGoodLocal()?'로컬 GPU의 VRAM이 10GB 이상이므로 내 GPU를 선택했어.':'로컬 GPU를 사용할 수 없거나 VRAM이 10GB 미만이어서 클라우드를 선택했어.') :
    (state.effective==='local' ? (LOCAL?'내 GPU로 생성해. VRAM 10GB 이상이 필요해.':'내 GPU 모드는 로컬 실행 프로그램이 제공하는 웹 주소에서만 사용할 수 있어.'):'Space ID로 연결한 ZeroGPU 서버에서 생성해. 무료 사용량 제한이 있어.');
  $('engine-reason').textContent=text;
  $('selected-mode-note').textContent=state.effective==='local'?'선택 모드: 내 컴퓨터 GPU (로컬 웹 앱 필요)':'선택 모드: Hugging Face ZeroGPU (Space 연결 필요)';
}
async function checkGPU(){
  if(!LOCAL){refreshEngine();msg('서버 연결 대기','클라우드 Space ID를 등록한 뒤 생성할 수 있어. 내 GPU는 로컬 프로그램을 실행해 연결해 줘.');return;}
  try{let r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error();state.gpu=await r.json();refreshEngine();msg('로컬 프로그램 연결 완료','GPU 상태를 확인했어. 영상을 만들 준비가 됐어.');}
  catch{state.gpu=null;refreshEngine();msg('로컬 서버 연결 실패','로컬 실행 프로그램을 다시 시작해 줘.');}
}
async function cloudGeneration(payload){
  const id=state.space.trim();
  if(!/^[\w.-]+\/[\w.-]+$/.test(id))throw Error('Space ID가 없어. 오른쪽에서 `아이디/Space이름` 형식으로 저장해 줘.');
  msg('클라우드 연결 중',`${id} 서버의 영상 생성 API에 연결하고 있어.`,7,'연결 중');
  const {Client}=await import('https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js');
  const app=await Client.connect(id);
  msg('클라우드 영상 생성 중','ZeroGPU 대기열과 GPU 할당이 적용돼. 페이지를 닫지 말아 줘.',18,'생성 중');
  const prediction=await app.predict('/generate_video', [payload.prompt,payload.negative_prompt,payload.duration,payload.steps,payload.seed]);
  const data=prediction?.data||[];
  const file=data[0];
  const url=typeof file==='string'?file:(file?.url||file?.path);
  if(!url)throw Error('서버가 MP4 주소를 보내지 않았어. Space의 /generate_video API 출력 형식을 확인해 줘.');
  return {url, message: typeof data[2]==='string'?data[2]:'클라우드 영상 생성 완료!'};
}
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function localGeneration(payload){
  if(!LOCAL)throw Error('내 GPU를 이용하려면 컴퓨터에서 start_local_windows.bat을 실행한 후 http://127.0.0.1:8765 주소에서 생성해 줘.');
  const resp=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!resp.ok){const e=await resp.json().catch(()=>null);throw Error(e?.detail||'로컬 생성 요청에 실패했어.');}
  const {id}=await resp.json();
  for(let t=0;t<1800;t++){
    await sleep(1500);
    const r=await fetch('/api/jobs/'+encodeURIComponent(id),{cache:'no-store'});
    if(!r.ok)throw Error('영상 작업의 상태를 확인할 수 없어.');
    const job=await r.json();
    if(job.state==='done')return {url:job.video_url,message:`로컬 영상 생성 완료! ${job.elapsed_seconds}초 소요`};
    if(job.state==='error')throw Error(job.error||'로컬 영상 생성 실패');
    const p=(job.stage==='model')?8:(job.stage==='saving'?95:Math.round(10+75*(job.progress||0)/100));
    msg('로컬 영상 생성 중', job.stage==='model'?'처음 실행이라 AI 모델을 다운로드하거나 불러오는 중이야.':`장면 생성 중 (${job.progress||0}%)`,p,'생성 중');
  }
  throw Error('오랜 시간 응답이 없어서 상태 확인을 종료했어. 로컬 프로그램을 확인해 줘.');
}
async function run(){
  if(state.busy)return;
  const prompt=$('prompt').value.trim();
  const seed=Number($('seed').value);
  if(!prompt){msg('문장이 필요해','생성할 영상을 설명해 줘.',0,'입력 확인');return;}
  if(!Number.isInteger(seed)||seed<0||seed>2147483647){msg('시드 확인','0 이상 2147483647 이하의 정수를 입력해 줘.',0,'입력 확인');return;}
  resetVideo();setBusy(true);
  const payload={prompt,negative_prompt:$('negative').value.trim(),duration:state.duration,steps:Number($('steps').value),seed};
  const t=Date.now();
  try{
    if(state.effective==='local' && !LOCAL)throw Error('먼저 로컬 실행 프로그램을 설치하고 실행한 뒤 http://127.0.0.1:8765에서 열어 줘.');
    if(state.effective==='local' && !isGoodLocal())throw Error('이 PC의 GPU VRAM이 10GB 미만이거나 연결되지 않았어. 클라우드 모드를 사용해 줘.');
    const result=state.effective==='local'?await localGeneration(payload):await cloudGeneration(payload);
    showVideo(result.url);msg('영상 생성 완료',`${result.message} · 총 ${Math.round((Date.now()-t)/1000)}초 소요`,100,'완료');
  }catch(e){msg('생성할 수 없어요',(e?.message||String(e))+' (서버 설정·GPU 할당량·API 상태를 확인해 줘.)',0,'오류');}
  finally{setBusy(false);}
}
for(const input of modeInputs)input.addEventListener('change',refreshEngine);
for(const button of document.querySelectorAll('button[data-duration]'))button.addEventListener('click',()=>{state.duration=Number(button.dataset.duration);document.querySelectorAll('button[data-duration]').forEach(el=>el.classList.toggle('selected',el===button));});
for(const button of document.querySelectorAll('button[data-prompt]'))button.addEventListener('click',()=>{$('prompt').value=button.dataset.prompt;setCount();});
function setCount(){$('chars').textContent=`${$('prompt').value.length} / 1,500`;}
$('prompt').addEventListener('input',setCount);
$('steps').addEventListener('input',()=>{$('steps-value').textContent=$('steps').value;});
function refreshSpaceLink(){const link=$('direct-space'); if(/^[\w.-]+\/[\w.-]+$/.test(state.space)){link.href='https://huggingface.co/spaces/'+state.space;link.hidden=false;}else{link.hidden=true;link.removeAttribute('href');}}
$('space-id').value=state.space; refreshSpaceLink();
$('save-space').addEventListener('click',()=>{const id=$('space-id').value.trim();if(!/^[\w.-]+\/[\w.-]+$/.test(id)){$('space-saved').textContent='아이디/Space이름 형식으로 입력해 줘.';return;}state.space=id;localStorage.setItem('frameforge_space',id);refreshSpaceLink();$('space-saved').textContent=`저장 완료: ${id} /generate_video`;});
$('generate').addEventListener('click',run);
setCount();checkGPU();
