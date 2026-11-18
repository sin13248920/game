/* Bus audio: per-vehicle Web Audio profiles and effects. */
(() => {
  'use strict';
  const PROFILES = {
    'q290-euro6': {
      base: 'engine/',
      samples: [
        { file: '301idle.wav', ref: 592, points: [[0,0],[200,1],[592,1],[651,.7],[770,0]], throttle: .7 },
        { file: '301low.wav', ref: 770, points: [[192,1],[770,1],[1332,0]], throttle: .7 },
        { file: '301mid2.wav', ref: 1770, points: [[592,0],[651,.2],[770,.7],[1451,1],[3332,0]], throttle: .7 },
        { file: '301high2.wav', ref: 1800, points: [[1551,0],[1870,.7],[2451,1],[3332,1]], throttle: .7 },
        { file: '301high.wav', ref: 1800, points: [[551,0],[870,1],[1470,1.4],[1970,1],[3332,1]], throttle: .7 },
        { file: '301low2.wav', ref: 1332, points: [[770,0],[1051,.7],[1332,1],[1628,.7],[1924,0]], throttle: .6 }
      ],
    },
    'q290-euro4-5': {
      base: 'engine/',
      samples: [
        { file: 'GE11idle.22k.wav', ref: 600, points: [[0,0],[450,.35],[500,1],[525,.5],[770,0],[900,0]], throttle: .8 },
        { file: 'GE11mid.22k.wav', ref: 1200, points: [[150,0],[510,0],[600,1],[1000,1],[1700,1],[1900,1],[3000,0]], throttle: .35 },
        { file: 'GE11low.22k.wav', ref: 1600, points: [[700,0],[1200,1],[1900,2],[3000,0]], throttle: .7 },
        { file: 'GE11Vmid.22k.wav', ref: 2000, points: [[700,0],[1200,0],[1900,1],[3000,1]], throttle: .5 }
      ]
    },
    'electric-speed': {
      base: 'motor/', mode: 'speed',
      samples: [
        // E2 속도별 모터음: 저속 5km/h에서 10km/h로 자연스럽게 넘기고 이후 40/60 구간으로 연결
        { file: '5kmh.wav', refSpeed: 5, optional: true, speedPoints: [[0,0],[3,.15],[5,.3],[7,.7],[10,0]] },
        { file: '10kmh.wav', refSpeed: 10, level: 1, speedPoints: [[5,0],[7,.7],[10,1],[25,1],[30,.65],[40,0]] },
        { file: '40kmh.wav', refSpeed: 40, speedPoints: [[25,0],[30,.3],[40,.7],[55,1],[70,.7],[80,0]] },
        { file: '60kmh.wav', refSpeed: 60, speedPoints: [[45,0],[55,.35],[60,.7],[70,1],[90,.8]] }
      ]
    }
  };
  let ctx=null, master=null, active=[], profileId=null, ready=false, volume=.65, suspended=true;
  let effectBuffers={}, retarderSource=null, retarderGain=null, retarderLevel=0;
  let redzoneSource=null, redzoneGain=null, redzoneActive=false;
  let profileTask=null, effectsTask=null, activeSoundConfig=null;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function curve(points,x){
    if(x<=points[0][0]) return points[0][1];
    for(let i=1;i<points.length;i++) if(x<=points[i][0]){const [x0,y0]=points[i-1],[x1,y1]=points[i],t=(x-x0)/(x1-x0||1);return y0+(y1-y0)*t;}
    return points[points.length-1][1];
  }
  async function init(){
    if(ctx){if(ctx.state==='suspended') await ctx.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) throw new Error('이 브라우저는 Web Audio API를 지원하지 않습니다.');
    ctx=new AC();master=ctx.createGain();master.gain.value=volume;master.connect(ctx.destination);await ctx.resume();
  }
  async function fetchBuffer(path){const r=await fetch(path);if(!r.ok)throw new Error('음원 로드 실패: '+path+' ('+r.status+')');return ctx.decodeAudioData(await r.arrayBuffer());}
  async function loadEffects(soundConfig){
    const folder=soundConfig && (soundConfig.effectsFolder || soundConfig.folder);
    const paths=soundConfig && soundConfig.effects || {};
    const taskKey=folder+'|'+JSON.stringify(paths);
    if(effectsTask && effectsTask.id===taskKey) return effectsTask.promise;
    effectBuffers={};
    const loaded={};
    const promise=Promise.allSettled(Object.entries(paths).map(async([key,rel])=>{
      try{loaded[key]=await fetchBuffer('Sound/'+folder+'/'+rel);}
      catch(err){console.warn('[BusAudio] 효과음 로드 실패:',key,rel,err);}
    })).then(result=>{if(effectsTask && effectsTask.id===taskKey) effectBuffers=loaded;return result;});
    effectsTask={id:taskKey,promise}; return promise;
  }
  function stopEngine(){for(const s of active){try{s.source.stop();s.source.disconnect();s.gain.disconnect();}catch(_){}}active=[];ready=false;}
  function stopLoop(which,fade=true){
    const isRed=which==='redzone',src=isRed?redzoneSource:retarderSource,gain=isRed?redzoneGain:retarderGain;
    if(!src||!gain)return;
    const now=ctx.currentTime;gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0,now,fade?.06:.001);
    setTimeout(()=>{try{src.stop();src.disconnect();gain.disconnect();}catch(_){}},fade?350:0);
    if(isRed){redzoneSource=null;redzoneGain=null;redzoneActive=false;}else{retarderSource=null;retarderGain=null;retarderLevel=0;}
  }
  async function loadProfile(soundConfig){
    const config=typeof soundConfig==='string'?{engine:soundConfig}:soundConfig;
    const id=config && config.engine;
    if(!id||!PROFILES[id]){stopEngine();profileId=null;ready=false;activeSoundConfig=config||null;effectBuffers={};return;}
    if(profileId===id&&ready){activeSoundConfig=config;loadEffects(config);return;}
    if(profileTask)return profileTask;
    profileTask=(async()=>{
      await init();stopEngine();stopLoop('retarder',false);stopLoop('redzone',false);profileId=id;ready=false;activeSoundConfig=config;
      loadEffects(config);
      const p=PROFILES[id];
      const soundFolder=config.engineFolder||config.folder||'';
      const results=await Promise.allSettled(p.samples.map(async s=>{
        const buffer=await fetchBuffer('Sound/'+soundFolder+'/'+p.base+encodeURIComponent(s.file));
        const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;
        const gain=ctx.createGain();gain.gain.value=0;source.connect(gain);gain.connect(master);source.start();return{...s,source,gain};
      }));
      active=results.filter(x=>x.status==='fulfilled').map(x=>x.value);
      const failed=results.filter((x,i)=>x.status==='rejected'&&!p.samples[i].optional);if(failed.length)console.warn('[BusAudio] 엔진 샘플 일부 로드 실패:',failed.map(x=>x.reason));
      ready=active.length>0;if(!ready)throw new Error('엔진 샘플을 하나도 불러오지 못했습니다. 배포 경로와 Sound 폴더를 확인하세요.');
    })().finally(()=>{profileTask=null;});return profileTask;
  }
  function playEffect(key,scale=1){if(!ctx||!effectBuffers[key]||suspended)return;const src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=effectBuffers[key];g.gain.value=clamp(scale,0,1);src.connect(g);g.connect(master);src.start();src.onended=()=>{try{src.disconnect();g.disconnect();}catch(_){}};}
  function door(which,opening){playEffect((which==='rear'?'rear':'front')+(opening?'Open':'Close'),.82);}
  function setParking(engaged){playEffect(engaged?'parkingOn':'parkingOff',.8);}
  function setRetarder(level){
    if(!ctx||!effectBuffers.retarderLoop)return;const n=clamp(Number(level)||0,0,3);if(n===retarderLevel)return;
    if(n>0&&retarderLevel===0){playEffect('retarderOn',.42);retarderSource=ctx.createBufferSource();retarderSource.buffer=effectBuffers.retarderLoop;retarderSource.loop=true;retarderGain=ctx.createGain();retarderGain.gain.value=0;retarderSource.connect(retarderGain);retarderGain.connect(master);retarderSource.start();}
    else if(n===0&&retarderLevel>0){stopLoop('retarder',true);playEffect('retarderOff',.38);return;}
    if(retarderGain)retarderGain.gain.setTargetAtTime(.12+n*.075,ctx.currentTime,.12);retarderLevel=n;
  }
  function setRedzone(on){
    if(!ctx||!effectBuffers.redzone)return;on=!!on&&!suspended;
    if(on&&!redzoneActive){
      redzoneActive=true;redzoneSource=ctx.createBufferSource();redzoneSource.buffer=effectBuffers.redzone;redzoneSource.loop=true;
      redzoneGain=ctx.createGain();redzoneGain.gain.value=.48;redzoneSource.connect(redzoneGain);redzoneGain.connect(master);redzoneSource.start();
    } else if(!on&&redzoneActive){
      const src=redzoneSource,gain=redzoneGain;redzoneSource=null;redzoneGain=null;redzoneActive=false;
      try{src.stop();src.disconnect();gain.disconnect();}catch(_){}
    }
  }
  function update(rpm,throttle,dt,redline=2600,idle=650,speedKmh=0,brake=0){
    if(!ctx||!ready||suspended)return;const now=ctx.currentTime,r=Math.max(0,Number(rpm)||0),t=clamp(Number(throttle)||0,0,1),b=clamp(Number(brake)||0,0,1);
    const profile=PROFILES[profileId];
    if(profile&&profile.mode==='speed'){
      const speed=Math.abs(Number(speedKmh)||0);
      // 가속 페달로 모터 부하가 걸릴 때만 소리 출력. 브레이크 입력은 모터음에 영향을 주지 않는다.
      for(const s of active){
        const speedWeight=curve(s.speedPoints,speed);
        const hasLoad=t>=.02;
        const target=hasLoad?clamp(speedWeight*.42*t*(s.level||1),0,2.0):0;
        const speedRatio=Math.max(.01,speed/(s.refSpeed||40));
        const pitch=clamp(Math.pow(speedRatio,.32)*(.97+t*.08),.68,1.28);
        s.source.playbackRate.setTargetAtTime(pitch,now,.16);
        s.gain.gain.setTargetAtTime(target,now,hasLoad?.10:.035);
      }
      return;
    }
    for(const s of active){const rw=Math.max(0,curve(s.points,r)),tw=s.throttle+(1-s.throttle)*t,target=clamp(rw*tw*.30,0,.72),rate=clamp(r/s.ref,.72,1.55);s.source.playbackRate.setTargetAtTime(rate,now,.08);s.gain.gain.setTargetAtTime(target,now,.09);}
    const threshold=Number(activeSoundConfig&&activeSoundConfig.redzone&&activeSoundConfig.redzone.threshold);
    const hotThreshold=Number.isFinite(threshold)?clamp(threshold,0,1):.88;
    setRedzone(!!(activeSoundConfig&&activeSoundConfig.effects&&activeSoundConfig.effects.redzone&&r>idle+(redline-idle)*hotThreshold));
  }
  function setVolume(v){volume=clamp(Number(v)||0,0,1);if(master&&ctx)master.gain.setTargetAtTime(suspended?0:volume,ctx.currentTime,.04);}
  function pause(p){suspended=!!p;if(master&&ctx)master.gain.setTargetAtTime(suspended?0:volume,ctx.currentTime,.06);if(suspended){stopLoop('retarder',false);stopLoop('redzone',false);}}
  function stop(){stopEngine();stopLoop('retarder',false);stopLoop('redzone',false);profileId=null;}
  window.BusAudio={unlock:init,loadProfile,update,setVolume,pause,stop,playBell:()=>playEffect('bell',.9),door,setRetarder,setParking,profiles:Object.keys(PROFILES)};
})();
