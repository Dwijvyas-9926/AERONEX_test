
(()=>{
const $=id=>document.getElementById(id);
const V3=THREE.Vector3, clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp;
THREE.ColorManagement.legacyMode=false;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- renderer / scene ---------- */
const canvas=$('view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const SKY=new THREE.Color('#9b8fbf');
scene.background=SKY; scene.fog=new THREE.Fog(SKY,180,760);
const pmrem=new THREE.PMREMGenerator(renderer);
const ENV=pmrem.fromScene(new THREE.RoomEnvironment(),0.04).texture;

const camera=new THREE.PerspectiveCamera(55,1,0.05,3000);
const controls=new THREE.OrbitControls(camera,canvas);
controls.enableDamping=true; controls.dampingFactor=.08; controls.enabled=false;

const hemi=new THREE.HemisphereLight('#e8e0ff','#4a3a2c',0.55); scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff1dc',1.6); sun.position.set(-60,120,40);
sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:1,far:300});
sun.shadow.bias=-0.0004; sun.shadow.normalBias=0.02;
scene.add(sun,sun.target);
// wide, soft shadows for terrain props
const sun2=new THREE.DirectionalLight('#fff1dc',0.35); sun2.position.set(-60,120,40); scene.add(sun2);

/* ---------- terrain: Rasuwa-style flood valley ---------- */
function hash(x,z){const s=Math.sin(x*127.1+z*311.7)*43758.5453;return s-Math.floor(s)}
function vnoise(x,z){const xi=Math.floor(x),zi=Math.floor(z),xf=x-xi,zf=z-zi;const u=xf*xf*(3-2*xf),v=zf*zf*(3-2*zf);
  return lerp(lerp(hash(xi,zi),hash(xi+1,zi),u),lerp(hash(xi,zi+1),hash(xi+1,zi+1),u),v)}
function fbm(x,z){let a=0,f=1,s=.5;for(let i=0;i<5;i++){a+=s*vnoise(x*f,z*f);f*=2.03;s*=.5}return a}
const riverZ=x=>60*Math.sin(x/110)+20*Math.sin(x/37);
const HOME=new V3(-260,0,riverZ(-260)+52), VILLAGE=new V3(250,0,riverZ(250)-54), BRIDGE_X=0;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
function rawH(x,z){
  const d=Math.abs(z-riverZ(x));
  let h=d<28? -2.5+d*0.07 : -0.6+(d-28)*0.42;
  h=Math.min(h,85+fbm(x*.01,z*.01)*30);
  h+=(fbm(x*.018+7,z*.018)-.5)*26*smooth(20,90,d)+(fbm(x*.08,z*.08)-.5)*2.2;
  return h;
}
function groundH(x,z){
  let h=rawH(x,z);
  for(const [c,r,lev] of [[HOME,24,5],[VILLAGE,30,6]]){
    const d=Math.hypot(x-c.x,z-c.z); const w=1-smooth(r*.6,r,d); h=lerp(h,lev,w);
  }
  return h;
}
HOME.y=groundH(HOME.x,HOME.z); VILLAGE.y=groundH(VILLAGE.x,VILLAGE.z);
const WATER=0.9;
{
  const SIZE=900,SEG=170;
  const g=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG).rotateX(-Math.PI/2).toNonIndexed();
  const p=g.attributes.position,col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++)p.setY(i,groundH(p.getX(i),p.getZ(i)));
  const cA=new THREE.Color('#6f6448'),cB=new THREE.Color('#5d7a4a'),cC=new THREE.Color('#47603f'),cD=new THREE.Color('#8b8279'),cE=new THREE.Color('#e9e4ef'),c=new THREE.Color();
  for(let i=0;i<p.count;i+=3){
    const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
    const ax=p.getX(i+1)-p.getX(i),ay=p.getY(i+1)-p.getY(i),az=p.getZ(i+1)-p.getZ(i),bx=p.getX(i+2)-p.getX(i),by=p.getY(i+2)-p.getY(i),bz=p.getZ(i+2)-p.getZ(i);
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx; const slope=1-Math.abs(ny)/Math.hypot(nx,ny,nz);
    if(y<2.2)c.copy(cA); else if(y<30)c.copy(cB).lerp(cC,smooth(5,30,y)); else c.copy(cC).lerp(cD,smooth(30,75,y));
    if(slope>.45)c.lerp(cD,.6); if(y>95)c.lerp(cE,smooth(95,115,y));
    c.convertSRGBToLinear();const j=.94+hash(i,3)*.1; for(let k=0;k<3;k++){col[(i+k)*3]=c.r*j;col[(i+k)*3+1]=c.g*j;col[(i+k)*3+2]=c.b*j}
  }
  g.setAttribute('color',new THREE.BufferAttribute(col,3)); g.computeVertexNormals();
  const t=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.95,metalness:0}));
  t.receiveShadow=true; scene.add(t);
  // flood water
  const wg=new THREE.PlaneGeometry(SIZE,SIZE,60,60).rotateX(-Math.PI/2);
  const wm=new THREE.MeshStandardMaterial({color:'#8a7a5c',roughness:.15,metalness:.05,transparent:true,opacity:.88,flatShading:true,envMap:ENV,envMapIntensity:.35});
  const water=new THREE.Mesh(wg,wm); water.position.y=WATER; water.receiveShadow=true; scene.add(water);
  scene.userData.water=water;
}
// trees (instanced, on slopes)
{
  const geo=new THREE.ConeGeometry(1.6,5,6); geo.translate(0,2.5,0);
  const mat=new THREE.MeshStandardMaterial({color:'#3c5a3a',flatShading:true,roughness:1});
  const N=900,im=new THREE.InstancedMesh(geo,mat,N); const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new V3();let n=0;
  for(let i=0;i<4000&&n<N;i++){const x=(hash(i,1)-.5)*860,z=(hash(i,2)-.5)*860,h=groundH(x,z);
    if(h<6||h>70)continue; if(Math.hypot(x-HOME.x,z-HOME.z)<30||Math.hypot(x-VILLAGE.x,z-VILLAGE.z)<36)continue;
    const k=.7+hash(i,5)*.9; s.set(k,k*(.8+hash(i,6)*.6),k); m.compose(new V3(x,h-.3,z),q,s); im.setMatrixAt(n++,m)}
  im.count=n; scene.add(im);
}
// bridge (broken)
{
  const mat=new THREE.MeshStandardMaterial({color:'#9a9086',roughness:.9,flatShading:true});
  const zc=riverZ(BRIDGE_X); const g=new THREE.Group();
  const deck=(z0,z1,tilt)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(6,.8,Math.abs(z1-z0)),mat);m.position.set(BRIDGE_X,4.2,(z0+z1)/2);m.rotation.x=tilt;m.castShadow=true;g.add(m)};
  deck(zc-34,zc-14,0.06); deck(zc+14,zc+34,-0.08);
  const debris=new THREE.Mesh(new THREE.BoxGeometry(6,.8,10),mat);debris.position.set(BRIDGE_X+4,WATER+.1,zc+2);debris.rotation.set(.3,.5,.15);g.add(debris);
  for(const z of[zc-22,zc+22]){const p=new THREE.Mesh(new THREE.BoxGeometry(2,8,2),mat);p.position.set(BRIDGE_X,0,z);g.add(p)}
  scene.add(g);
}
// base camp & village
function hut(x,z,col,s=1){const g=new THREE.Group();const y=groundH(x,z);
  const b=new THREE.Mesh(new THREE.BoxGeometry(4*s,2.6*s,3.4*s),new THREE.MeshStandardMaterial({color:col,flatShading:true,roughness:.9}));b.position.y=1.3*s;
  const r=new THREE.Mesh(new THREE.ConeGeometry(3.4*s,1.8*s,4),new THREE.MeshStandardMaterial({color:'#6b4a3a',flatShading:true}));r.position.y=3.5*s;r.rotation.y=Math.PI/4;
  g.add(b,r);g.position.set(x,y,z);g.rotation.y=hash(x,z)*3;scene.add(g)}
function tent(x,z,col){const y=groundH(x,z);const t=new THREE.Mesh(new THREE.ConeGeometry(2.6,2.6,4),new THREE.MeshStandardMaterial({color:col,flatShading:true}));t.position.set(x,y+1.3,z);t.rotation.y=Math.PI/4+hash(x,z);scene.add(t)}
[[8,6],[-9,8],[11,-7],[-6,-10]].forEach(([dx,dz],i)=>tent(HOME.x+dx,HOME.z+dz,i%2?'#3F9A93':'#E8B04E'));
[[14,8],[-15,6],[9,-15],[-12,-13],[20,-3],[-4,17]].forEach(([dx,dz],i)=>hut(VILLAGE.x+dx,VILLAGE.z+dz,['#cdbfa6','#bfae95','#d9cdb7'][i%3]));
function pad(c,color,label){
  const g=new THREE.Group();g.position.copy(c);g.position.y+=.05;
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.2,2.7,48).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color}));
  const disk=new THREE.Mesh(new THREE.CircleGeometry(2.2,48).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#3a3242',roughness:.9}));disk.receiveShadow=true;
  g.add(disk,ring);scene.add(g);return g}
pad(HOME,'#F1C84B'); const dropPad=pad(VILLAGE,'#5CC2B8');
// target lock ring
const lockRing=new THREE.Mesh(new THREE.RingGeometry(3.4,3.8,64).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#F1C84B',transparent:true,opacity:0,depthWrite:false}));
lockRing.position.copy(VILLAGE);lockRing.position.y+=.12;scene.add(lockRing);
// route
const CRUISE=48;
const route=[HOME.clone(),new V3(-150,0,riverZ(-150)),new V3(-60,0,riverZ(-60)),new V3(BRIDGE_X,0,riverZ(BRIDGE_X)),new V3(90,0,riverZ(90)),new V3(175,0,riverZ(175)-20),VILLAGE.clone()];
route.forEach(p=>p.y=CRUISE+Math.max(0,groundH(p.x,p.z)));
{
  const pts=[];for(let i=0;i<route.length-1;i++)for(let t=0;t<1;t+=.05)pts.push(route[i].clone().lerp(route[i+1],t));pts.push(route.at(-1));
  const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:'#F1C84B',dashSize:4,gapSize:3,transparent:true,opacity:.75}));
  l.computeLineDistances();scene.add(l);
  route.slice(1,-1).forEach(p=>{const m=new THREE.Mesh(new THREE.OctahedronGeometry(1.1),new THREE.MeshBasicMaterial({color:'#F1C84B',wireframe:true}));m.position.copy(p);scene.add(m)});
}

/* ---------- drone ---------- */
const drone=new THREE.Group(); scene.add(drone);
const body=new THREE.Group(); drone.add(body); // body handles attitude
const parts=[]; const props=[]; const discs=[];
const CAT={
  tube:{label:'Carbon-fibre tubes',color:'#1c1b22',desc:'Square and 8 mm round carbon-fibre tubes: lateral rails, straight and cross members, and the landing-leg tubes. Carbon fibre is about 40% less dense than aluminium.',mat:{roughness:.32,metalness:.25,clearcoat:1,clearcoatRoughness:.25}},
  node:{label:'Printed joint nodes',color:'#2C9C93',desc:'Custom 3D-printed T-mounts and L-mounts that join the carbon tubes. A broken node is re-printed from the CAD file in the field.',mat:{roughness:.55}},
  plate:{label:'Bottom plate',color:'#EDE9F2',desc:'Printed bottom plate that ties the centre frame together and carries the payload release.',mat:{roughness:.6}},
  rail:{label:'Rail plates',color:'#EDE9F2',desc:'Front and rear rail plates that carry the camera mount and GPS mast.',mat:{roughness:.6}},
  pod:{label:'Avionics pod',color:'#2C9C93',desc:'Printed pod that shields the flight stack. The pod reads "TEAM AVION".',mat:{roughness:.5}},
  avionics:{label:'Avionics tray',color:null,desc:'Tray holding the Pixhawk 2.4.8 flight controller and the Raspberry Pi 4 companion computer.',mat:{roughness:.5,metalness:.2}},
  camera:{label:'Depth camera',color:null,desc:'Intel RealSense D455 on a printed clamp mount, angled to see the drop zone ahead and below.',mat:{roughness:.45,metalness:.3}},
  gps:{label:'GPS mast',color:'#F1C84B',desc:'GPS/GNSS module on a printed mast mount, raised clear of the power wiring.',mat:{roughness:.5}},
  motor:{label:'Motors',color:'#26252c',desc:'Four 5010 750 KV brushless outrunner motors (FlyCat).',mat:{roughness:.28,metalness:.85}},
  prop:{label:'Propellers',color:'#111014',desc:'Four 10-inch propellers in counter-rotating pairs.',mat:{roughness:.4,metalness:.1}},
  guard:{label:'Prop guards',color:'#F4F1F7',desc:'Printed guard ring, collar and posts at each corner to protect people and props near the drop zone.',mat:{roughness:.55}},
  foot:{label:'Landing feet',color:'#F1C84B',desc:'Printed landing feet at the end of each leg tube.',mat:{roughness:.6}},
};
const SPEC={motor:[['KV','750'],['Size','5010'],['Count','4']],prop:[['Diameter','10 in'],['Pairs','CW / CCW']],camera:[['Model','D455'],['Use','Drop-zone depth']],avionics:[['FC','Pixhawk 2.4.8'],['Companion','Raspberry Pi 4']],tube:[['Material','Carbon fibre'],['Frame','40 × 40 cm X']],gps:[['Module','GPS / GNSS']]};
// payload
const parcel=new THREE.Group();
{const b=new THREE.Mesh(new THREE.BoxGeometry(.2,.14,.2),new THREE.MeshStandardMaterial({color:'#E9DCC2',roughness:.8}));b.castShadow=true;
 const band=new THREE.Mesh(new THREE.BoxGeometry(.205,.03,.205),new THREE.MeshStandardMaterial({color:'#2C9C93'}));
 parcel.add(b,band);}
const chute=new THREE.Mesh(new THREE.SphereGeometry(.7,16,8,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:'#F1C84B',side:THREE.DoubleSide,roughness:.7}));
chute.visible=false; scene.add(chute);
// scanning cone from D455
const scanCone=new THREE.Mesh(new THREE.ConeGeometry(9,18,32,1,true),new THREE.MeshBasicMaterial({color:'#5CC2B8',transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
scanCone.geometry.translate(0,-9,0); scene.add(scanCone);

/* ---------- load the CAD-derived GLB ---------- */
const loader=new THREE.GLTFLoader();
const onModel=gltf=>{
  const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o)});
  for(const o of meshes){
    const name=o.name||o.parent.name; const cat=(name.split('_')[0]in CAT)?name.split('_')[0]:'plate';
    const c=CAT[cat]; const opts=Object.assign({},c.mat);
    if(c.color){opts.color=new THREE.Color(c.color)}else{opts.vertexColors=true}
    opts.envMap=ENV;opts.envMapIntensity=.9;const m=new THREE.MeshPhysicalMaterial(opts);
    o.material=m; o.castShadow=true; o.receiveShadow=true;
    o.geometry.computeBoundingBox(); if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();
    const wp=new V3();o.getWorldPosition(wp);
    const center=o.geometry.boundingBox.getCenter(new V3()).add(wp);
    if(cat==='prop')center.copy(wp);
    body.attach(o);
    const rec={mesh:o,cat,name,base:o.position.clone(),center};
    parts.push(rec);
    if(cat==='prop'){rec.dir=(Math.sign(wp.x)*Math.sign(wp.z))>0?1:-1;props.push(rec);
      const d=new THREE.Mesh(new THREE.CircleGeometry(.128,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#2a2633',transparent:true,opacity:0,depthWrite:false}));
      d.position.copy(o.position).add(new V3(0,.006,0));body.add(d);discs.push(d);rec.disc=d}
  }
  body.add(parcel); parcel.position.set(0,-.17,0);
  buildPartsList(); reset(); hideLoading();
};
/* Load the model: the Avion app posts raw geometry parts; the twin rebuilds them with its own three.js and re-materialises by name. Falls back to the baked model. */
(function(){
  let done=false;
  function loadBaked(){ if(done)return; done=true; try{
    const b64=AVION_GLB.slice(AVION_GLB.indexOf(',')+1),bin=atob(b64),u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    $('loadBar').style.width='60%';
    loader.parse(u8.buffer,'',m=>{$('loadBar').style.width='100%';onModel(m)},err=>{$('loadTxt').textContent='The CAD model could not load: '+(err&&err.message||err);console.error(err)});
  }catch(err){$('loadTxt').textContent='The CAD model could not load: '+err.message;console.error(err)} }
  function loadParts(parts){ if(done)return; done=true; try{
    const g=new THREE.Group();
    for(const pt of parts){ const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(pt.position,3));
      if(pt.normal)geo.setAttribute('normal',new THREE.BufferAttribute(pt.normal,3)); else geo.computeVertexNormals();
      if(pt.index)geo.setIndex(new THREE.BufferAttribute(pt.index,1));
      const mesh=new THREE.Mesh(geo); mesh.name=pt.name||'plate'; g.add(mesh); }
    $('loadBar').style.width='100%'; onModel({scene:g});
  }catch(err){console.error('part build failed',err); done=false; loadBaked();} }
  window.addEventListener('message',ev=>{ if(ev.origin!==location.origin||ev.source!==window.parent)return; const d=ev.data; if(!d||d.type!=='avion:model'||done)return;
    if(d.parts&&d.parts.length){ loadParts(d.parts); } else { loadBaked(); } });
  const embedded = !!(window.parent&&window.parent!==window);
  if(embedded){ try{ window.parent.postMessage({type:'avion:ready'},'/'); }catch(e){}
    setTimeout(()=>{ if(!done) loadBaked(); }, 5000); }
  else { setTimeout(loadBaked,50); }
})();
function hideLoading(){const l=$('loading');l.style.opacity=0;setTimeout(()=>l.hidden=true,650)}

/* ---------- simulation state ---------- */
const G=9.81, HOVER=.47, VMAX=9, VZMAX=3, AMAX=4.2, MOTOR_R=new V3(.199,0,.199).length();
const S={};
function reset(){
  Object.assign(S,{t:0,armed:false,phase:'PREFLIGHT',stage:0,wp:0,p:HOME.clone().setY(HOME.y+.115),v:new V3(),a:new V3(),yaw:Math.atan2(-(route[1].x-HOME.x),-(route[1].z-HOME.z)),
    pitch:0,roll:0,thr:0,motors:[0,0,0,0],batt:1,hold:false,manual:false,parcelState:'attached',pv:new V3(),scanT:0,confirmT:0,landedT:0,gust:new V3(),sats:16,lowWarned:false,doneStages:new Set()});
  if(parcel.parent!==body){body.add(parcel)} parcel.position.set(0,-.17,0);parcel.rotation.set(0,0,0);chute.visible=false;
  lockRing.material.opacity=0; scanCone.material.opacity=0; $('lock').textContent='SEARCHING';
  $('logList').innerHTML=''; log('Twin ready. Avion on the base-camp pad, payload attached.','ok');
  log('Pre-flight: GNSS 3D fix, 16 sats. Battery 6S at 25.2 V.');
  setMode('mission',true); updateButtons(); updatePhases();
  drone.position.copy(S.p); if(typeof camYaw!=='undefined')camYaw=S.yaw;
}
function log(msg,cls=''){const li=document.createElement('li');if(cls)li.className=cls;
  const t=Math.floor(S.t||0);li.innerHTML=`<b>T+${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}</b>`;li.append(msg);
  const ol=$('logList');ol.prepend(li);while(ol.children.length>40)ol.lastChild.remove()}
function setPhase(ph,stage){S.phase=ph;if(stage!=null){for(let i=1;i<stage;i++)S.doneStages.add(i);S.stage=stage}updatePhases();updateButtons()}
function updatePhases(){document.querySelectorAll('#phases li').forEach(li=>{const n=+li.dataset.p;li.classList.toggle('on',n===S.stage&&!['LANDED','PREFLIGHT'].includes(S.phase));li.classList.toggle('done',S.doneStages.has(n))});
  const map={PREFLIGHT:['PREFLIGHT · DISARMED',''],TAKEOFF:['TAKEOFF','ok'],ROUTE:['ROUTE · WP '+S.wp+'/'+(route.length-1),'ok'],SCAN:['PERCEPTION · SCANNING','ok'],CONFIRM:['AWAITING OPERATOR','warn'],DROP:['PAYLOAD RELEASE','ok'],RTL:['RETURN TO LAUNCH','ok'],LAND:['LANDING','ok'],LANDED:['LANDED · DISARMED',''],HOLD:['HOLD · LOITER','warn'],MANUAL:['MANUAL · POSITION HOLD','warn']};
  const [t,c]=map[S.phase]||[S.phase,'']; $('phaseTxt').textContent=t; $('phaseDot').className='dot '+c}
function updateButtons(){
  const air=S.armed&&!['LANDED','PREFLIGHT'].includes(S.phase);
  $('bLaunch').disabled=S.armed; $('bLaunch').textContent=S.phase==='LANDED'?'Reset to fly again':'Arm & launch'; if(S.phase==='LANDED')$('bLaunch').disabled=false;
  $('bConfirm').disabled=S.phase!=='CONFIRM'; $('bConfirm').classList.toggle('confirm',S.phase==='CONFIRM');
  $('bHold').disabled=!air; $('bHold').textContent=S.phase==='HOLD'?'Resume':'Hold';
  $('bRTL').disabled=!air||['RTL','LAND'].includes(S.phase); $('bLowBatt').disabled=!air||S.batt<.3;
}

/* ---------- input ---------- */
const keys=new Set();
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;keys.add(e.code);if(S.manual&&/Key[WASDQERF]|Arrow|Space|Shift/.test(e.code))e.preventDefault()});
addEventListener('keyup',e=>keys.delete(e.code));
document.querySelectorAll('#pad button').forEach(b=>{const k=b.dataset.k;
  b.addEventListener('pointerdown',e=>{e.preventDefault();keys.add(k);b.setPointerCapture(e.pointerId)});
  ['pointerup','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>keys.delete(k)))});

$('bLaunch').onclick=()=>{
  if(S.phase==='LANDED'){reset();return}
  S.armed=true; S.manual=false; log('Armed. Motors spinning up.','ok'); log('Autonomous takeoff to '+CRUISE+' m cruise altitude.');
  setPhase('TAKEOFF',1); S.wp=1;
};
$('bConfirm').onclick=()=>{if(S.phase!=='CONFIRM')return;log('Operator confirmed the drop.','ok');setPhase('DROP',4);release()};
$('bHold').onclick=()=>{
  if(S.phase==='HOLD'){setPhase(S.resume||'ROUTE');log('Mission resumed.');return}
  S.resume=S.phase==='MANUAL'?'RTL':S.phase; S.holdP=S.p.clone(); setPhase('HOLD'); log('Hold: loitering in place.','warn')};
$('bRTL').onclick=()=>startRTL('Operator commanded return to launch.');
$('bLowBatt').onclick=()=>{S.batt=Math.min(S.batt,.24);log('Test: battery forced to 24%.','warn')};
$('bReset').onclick=reset;
$('autoConfirm').onchange=()=>{};
const SPEEDS=[1,2,4,8];
$('speed').oninput=e=>$('speedV').textContent=SPEEDS[e.target.value]+'×';
$('wind').oninput=e=>$('windV').textContent=e.target.value+' m/s';

function startRTL(msg){
  if(!S.armed)return; log(msg,'warn');
  if(S.parcelState==='attached'&&['SCAN','CONFIRM'].includes(S.phase))log('Payload kept on board.');
  setPhase('RTL',5); S.manual=false;
  // return along the route, starting from the nearest waypoint
  let best=0,bd=1e9;route.forEach((r,i)=>{const d=r.distanceTo(S.p);if(d<bd){bd=d;best=i}});
  S.rtlPath=route.slice(0,best+1).reverse().map(p=>p.clone()); S.rtlPath[0].y=Math.max(S.p.y,S.rtlPath[0].y); S.rtlI=0;
}
function release(){
  S.parcelState='falling'; const wp=new V3();parcel.getWorldPosition(wp);scene.attach(parcel);parcel.position.copy(wp);
  S.pv.copy(S.v); S.dropT=S.t; log('Payload released.','ok');
}

/* ---------- modes & cameras ---------- */
let mode='mission', cam='chase';
function setMode(m,silent){
  mode=m;['mMission','mManual','mInspect'].forEach(id=>$(id).setAttribute('aria-pressed',String(id==='m'+m[0].toUpperCase()+m.slice(1))));
  const ins=m==='inspect';
  $('inspect').hidden=!ins;$('partinfo').hidden=!ins;$('left').hidden=ins;$('right').hidden=ins;$('keys').hidden=m!=='manual';
  $('pad').style.display=m==='manual'?'grid':'none';
  if(m==='manual'){
    if(!S.armed){if(S.phase==='LANDED'){S.doneStages.clear();S.stage=0}S.armed=true;setPhase('TAKEOFF',1);S.manualAfterTO=true;log('Manual flight: auto takeoff to 10 m, then you have control.','warn')}
    else{S.manual=true;setPhase('MANUAL');log('Operator took manual control.','warn')}
    canvas.focus({preventScroll:true});
  } else if(S.manual&&m==='mission'){S.manual=false;startRTL('Manual control released. Returning home.')}
  if(ins){setCam('orbit');controls.minDistance=.4;controls.target.copy(drone.position);camera.position.copy(drone.position).add(new V3(1.1,.7,1.3))}
  else{controls.minDistance=1; if(!silent)setCam(cam==='orbit'?'chase':cam)}
  if(!ins){applyExplode(0);$('explode').value=0;$('explodeV').textContent='0%';selectPart(null)}
}
$('mMission').onclick=()=>setMode('mission');$('mManual').onclick=()=>setMode('manual');$('mInspect').onclick=()=>setMode('inspect');
function setCam(c){cam=c;document.querySelectorAll('#camSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cam===c)));
  controls.enabled=c==='orbit'; if(c==='orbit'){controls.target.copy(drone.position);if(camera.position.distanceTo(drone.position)>40)camera.position.copy(drone.position).add(new V3(3,2,4))}}
document.querySelectorAll('#camSeg button').forEach(b=>b.onclick=()=>setCam(b.dataset.cam));

/* ---------- inspect: parts ---------- */
const groupsOrder=['tube','node','plate','rail','pod','avionics','camera','gps','motor','prop','guard','foot'];
let selected=null;
function buildPartsList(){
  const el=$('parts');el.innerHTML='';$('partCount').textContent=parts.length+' BODIES';
  for(const k of groupsOrder){const n=parts.filter(p=>p.cat===k).length;if(!n)continue;
    const b=document.createElement('button');b.setAttribute('aria-pressed','true');b.dataset.cat=k;
    b.innerHTML=`<span class="sw" style="background:${CAT[k].color||'linear-gradient(135deg,#0c0ea4,#0a8a0a)'}"></span><span>${CAT[k].label}</span><span class="mono" style="font-size:11px;color:var(--muted)">${n}</span>`;
    b.onclick=e=>{ if(e.altKey||e.shiftKey){toggleVis(k,b);return} selectPart(k)};
    b.ondblclick=()=>toggleVis(k,b);
    el.append(b)}
  const hint=document.createElement('div');hint.className='note';hint.textContent='Double-click a group to hide or show it.';el.append(hint);
}
function toggleVis(k,b){const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(on));parts.filter(p=>p.cat===k).forEach(p=>{p.mesh.visible=on;if(p.disc)p.disc.visible=on})}
function selectPart(cat,partName){
  selected=cat;parts.forEach(p=>{p.mesh.material.emissive.set(p.cat===cat?'#3d2d66':'#000');p.mesh.material.emissiveIntensity=p.cat===cat?1:0});
  document.querySelectorAll('#parts button').forEach(b=>b.classList.toggle('sel',b.dataset.cat===cat));
  if(!cat){$('piCat').textContent='Select a part';$('piName').textContent='Click any part on the drone';$('piDesc').textContent='The model is the team\'s full STEP assembly, converted to a mesh: 263,000 triangles across '+parts.length+' bodies.';$('piKv').innerHTML='';return}
  const c=CAT[cat];const n=parts.filter(p=>p.cat===cat).length;
  $('piCat').textContent=c.label+' · '+n+(n>1?' bodies':' body');$('piName').textContent=partName||c.label;$('piDesc').textContent=c.desc;
  $('piKv').innerHTML=(SPEC[cat]||[]).map(([k,v])=>`<div><span class="lbl">${k}</span><b style="font-size:14px">${v}</b></div>`).join('');
}
function applyExplode(f){
  for(const p of parts){
    const c=p.center; const dir=new V3(c.x,0,c.z); const r=dir.length();
    const lift={prop:.32,guard:.2,motor:.12,gps:.08,camera:.04,avionics:.22,pod:.36,foot:-.22,tube:0,node:.02,plate:-.08,rail:-.04}[p.cat]||0;
    const out=dir.multiplyScalar(p.cat==='avionics'||p.cat==='pod'?0:.55);
    p.mesh.position.copy(p.base).addScaledVector(out,f).add(new V3(0,lift*f,0));
    if(p.disc)p.disc.position.copy(p.mesh.position).add(new V3(0,.006,0));
  }
  if(parcel.parent===body)parcel.position.set(0,-.17-.25*f,0);
}
$('explode').oninput=e=>{const f=e.target.value/100;$('explodeV').textContent=e.target.value+'%';applyExplode(f)};
// click-to-pick
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();let downAt=null;
canvas.addEventListener('pointerdown',e=>downAt=[e.clientX,e.clientY]);
canvas.addEventListener('pointerup',e=>{
  if(mode!=='inspect'||!downAt||Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>5)return;
  const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera);
  const hit=ray.intersectObjects(parts.filter(p=>p.mesh.visible).map(p=>p.mesh),false)[0];
  if(!hit){selectPart(null);return} const p=parts.find(q=>q.mesh===hit.object);selectPart(p.cat);
});

/* ---------- physics step ---------- */
const tmp=new V3(),tgt=new V3(),dv=new V3();
function agl(){return S.p.y-groundH(S.p.x,S.p.z)-.115}
function guide(target,vmax=VMAX,stopR=0){ // returns desired velocity toward a target
  tmp.subVectors(target,S.p); const dh=Math.hypot(tmp.x,tmp.z);
  const sp=Math.min(vmax,Math.sqrt(2*2.2*Math.max(0,dh-stopR))); const hv=dh>1e-3?sp/dh:0;
  dv.set(tmp.x*hv,clamp(tmp.y*.8,-VZMAX,VZMAX),tmp.z*hv); return dh;
}
function step(dt){
  S.t+=dt;
  const windSp=+$('wind').value;
  // gusts: slowly varying noise
  const tt=S.t*.35; S.gust.set((vnoise(tt,1)-.5)*2,(vnoise(tt,7)-.5)*.4,(vnoise(tt,13)-.5)*2).multiplyScalar(windSp*.6);
  const wind=new V3(windSp*.8,0,windSp*.6).add(S.gust);
  dv.set(0,0,0); let yawCmd=null;
  if(S.armed){
    switch(S.phase){
      case 'TAKEOFF':{
        const alt=S.manualAfterTO?10:CRUISE*.5; dv.set(0,agl()<alt?2.5:0,0);
        if(agl()>=alt-.3){ if(S.manualAfterTO){S.manualAfterTO=false;S.manual=true;setPhase('MANUAL');log('At 10 m. Manual control active.','ok')} else {setPhase('ROUTE',2);log('Climbing out. Route execution: '+(route.length-2)+' waypoints.')} }
        break}
      case 'ROUTE':{
        const T=route[S.wp]; const last=S.wp===route.length-1;
        const tg=last?tgt.copy(T).setY(VILLAGE.y+15):T;
        const dh=guide(tg,VMAX,0);
        if(!last&&dh<6){S.wp++;updatePhases();log(S.wp===route.length-1?'Final leg to the cut-off village.':S.wp===4?'Passed the broken bridge.':'Waypoint '+(S.wp-1)+' reached.')}
        if(last&&dh<.6&&Math.abs(S.p.y-tg.y)<1){setPhase('SCAN',3);S.scanT=0;log('Over the village. D455 scanning for a drop zone.')}
        break}
      case 'SCAN':{
        guide(tgt.copy(VILLAGE).setY(VILLAGE.y+15),2); S.scanT+=dt; yawCmd=S.yaw+dt*1.0;
        if(S.scanT>6.3){setPhase('CONFIRM',4);$('lock').textContent='LOCKED · 15.0 m';log('Drop zone locked: clear pad, 15 m below.','ok');
          if($('autoConfirm').checked){log('Auto-confirm is on.');setTimeout(()=>{if(S.phase==='CONFIRM'){setPhase('DROP',4);release()}},1200)} else log('Waiting for the operator to confirm the drop.','warn')}
        break}
      case 'CONFIRM': guide(tgt.copy(VILLAGE).setY(VILLAGE.y+15),2); break;
      case 'DROP':{guide(tgt.copy(VILLAGE).setY(VILLAGE.y+15),2);
        if(S.parcelState==='landed'){S.doneStages.add(4);startRTL('Delivery complete. Returning to launch.')}
        break}
      case 'RTL':{
        const path=S.rtlPath; const T=path[S.rtlI]; const last=S.rtlI===path.length-1;
        const tg=last?tgt.copy(HOME).setY(Math.max(S.p.y,HOME.y+CRUISE*.5)):T;
        const dh=guide(tg,VMAX,0);
        if(!last&&dh<6)S.rtlI++;
        if(last&&dh<.5){setPhase('LAND',5);log('Over home pad. Landing.')}
        break}
      case 'LAND':{
        guide(tgt.copy(HOME).setY(S.p.y),1.5); const a=agl(); dv.y=a>6?-2.2:a>1.5?-1:-.45;
        if(a<.02){S.v.set(0,0,0);S.doneStages.add(5);setPhase('LANDED');S.stage=0;updatePhases();S.armed=false;log('Touchdown. Motors disarmed. Mission complete.','ok');updateButtons()}
        break}
      case 'HOLD': guide(S.holdP,3); break;
      case 'MANUAL':{
        const fw=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
        const rt=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
        const up=(keys.has('KeyR')||keys.has('Space')?1:0)-(keys.has('KeyF')||keys.has('ShiftLeft')||keys.has('ShiftRight')?1:0); const yr=(keys.has('KeyQ')?1:0)-(keys.has('KeyE')?1:0);
        const f=new V3(-Math.sin(S.yaw),0,-Math.cos(S.yaw)),r=new V3(Math.cos(S.yaw),0,-Math.sin(S.yaw));
        dv.copy(f).multiplyScalar(fw*7).addScaledVector(r,rt*5); dv.y=up*2.5; yawCmd=S.yaw+yr*1.6*dt;
        if(agl()<1.2&&dv.y<0)dv.y=0;
        break}
    }
    // battery failsafe
    if(S.batt<.25&&!S.lowWarned){S.lowWarned=true;log('Battery below 25%.','crit');if(!['RTL','LAND','LANDED'].includes(S.phase))startRTL('Low-battery failsafe: returning to launch.')}
  }
  // controller: velocity loop -> acceleration, compensate wind drag
  const air=S.armed&&S.phase!=='LANDED';
  const drag=.35;
  if(air){
    S.a.subVectors(dv,S.v).multiplyScalar(1.6);
    const ah=Math.hypot(S.a.x,S.a.z); if(ah>AMAX){S.a.x*=AMAX/ah;S.a.z*=AMAX/ah} S.a.y=clamp(S.a.y,-3,3);
    // disturbance from wind (relative airspeed drag) partly rejected by the controller
    const rel=tmp.subVectors(wind,S.v); const dist=rel.multiplyScalar(drag*.25);
    S.v.addScaledVector(S.a,dt).addScaledVector(dist,dt);
  } else S.v.multiplyScalar(.8);
  S.p.addScaledVector(S.v,dt);
  const gh=groundH(S.p.x,S.p.z)+.115; if(S.p.y<gh){S.p.y=gh;if(S.v.y<0)S.v.y=0;S.v.x*=.9;S.v.z*=.9}
  // attitude: tilt to produce horizontal force (a + drag compensation)
  const need=new V3(S.a.x,0,S.a.z).addScaledVector(new V3(S.v.x-wind.x,0,S.v.z-wind.z),air?drag*.25:0);
  if(!air)need.set(0,0,0);
  const hs=Math.hypot(S.v.x,S.v.z);
  if(yawCmd!==null)S.yaw=yawCmd; else if(air&&hs>1.5&&!S.manual){let ty=Math.atan2(-S.v.x,-S.v.z),d=ty-S.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));S.yaw+=clamp(d,-1.2*dt,1.2*dt)}
  const f=new V3(-Math.sin(S.yaw),0,-Math.cos(S.yaw)),r=new V3(Math.cos(S.yaw),0,-Math.sin(S.yaw));
  const tp=clamp(-need.dot(f)/G,-.5,.5),tr=clamp(-need.dot(r)/G,-.5,.5);
  S.pitch=lerp(S.pitch,tp,1-Math.exp(-dt*6)); S.roll=lerp(S.roll,tr,1-Math.exp(-dt*6));
  // throttle & motors
  const thrTarget=air?clamp(HOVER*(1+S.a.y/G)/Math.cos(Math.hypot(S.pitch,S.roll)),.08,1):S.armed?.12:0;
  S.thr=lerp(S.thr,thrTarget,1-Math.exp(-dt*8));
  const mp=[[1,-1],[-1,-1],[1,1],[-1,1]]; // x,z sign per motor slot
  for(let i=0;i<4;i++){const [mx,mz]=mp[i];const fwd=-mz,rgt=mx;
    S.motors[i]=clamp(S.thr*(1+.35*(-S.pitch*fwd*-1)+.35*(S.roll*rgt))+(Math.random()-.5)*.01*S.thr,0,1)}
  // battery: simple placeholder model
  if(S.armed)S.batt=Math.max(0,S.batt-dt*.0011*Math.pow(S.thr/HOVER,1.5));
  // payload
  if(S.parcelState==='falling'){
    const age=S.t-S.dropT; const open=age>.8; chute.visible=open;
    if(open){S.pv.y=lerp(S.pv.y,-3,1-Math.exp(-dt*3));S.pv.x=lerp(S.pv.x,wind.x*.4,dt);S.pv.z=lerp(S.pv.z,wind.z*.4,dt)} else S.pv.y-=G*dt;
    parcel.position.addScaledVector(S.pv,dt); parcel.rotation.z=Math.sin(S.t*2)*.12;
    chute.position.copy(parcel.position).add(new V3(0,1.3,0)); chute.scale.setScalar(Math.min(1,(age-.8)*2.5)); chute.rotation.z=parcel.rotation.z;
    const gy=groundH(parcel.position.x,parcel.position.z)+.07;
    if(parcel.position.y<=gy){parcel.position.y=gy;S.parcelState='landed';chute.visible=false;parcel.rotation.set(0,0,0);
      const off=Math.hypot(parcel.position.x-VILLAGE.x,parcel.position.z-VILLAGE.z);log('Payload on the ground, '+off.toFixed(1)+' m from the pad centre (simulated).','ok')}
  }
}

/* ---------- views ---------- */
const att=$('att'),actx=att.getContext('2d'),mapC=$('map'),mctx=mapC.getContext('2d');
const MAPW=900; const mapBg=document.createElement('canvas');mapBg.width=mapBg.height=230;
{const c=mapBg.getContext('2d'),N=230,img=c.createImageData(N,N);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=(i/N-.5)*MAPW,z=(j/N-.5)*MAPW,h=groundH(x,z),hx=groundH(x+4,z)-h;
    let r,g,b; if(h<WATER){r=110;g=96;b=72}else if(h<30){r=78;g=104;b=70}else{r=110;g=105;b=110}
    const sh=clamp(1-hx*.08,.6,1.3),k=(j*N+i)*4;img.data[k]=r*sh;img.data[k+1]=g*sh;img.data[k+2]=b*sh;img.data[k+3]=255}
  c.putImageData(img,0,0)}
const mpx=(x)=>(x/MAPW+.5)*mapC.width, mpz=(z)=>(z/MAPW+.5)*mapC.height;
function drawMap(){
  const W=mapC.width;mctx.drawImage(mapBg,0,0,W,W);
  mctx.lineWidth=3;mctx.setLineDash([10,7]);mctx.strokeStyle='#F1C84B';mctx.beginPath();route.forEach((p,i)=>i?mctx.lineTo(mpx(p.x),mpz(p.z)):mctx.moveTo(mpx(p.x),mpz(p.z)));mctx.stroke();mctx.setLineDash([]);
  const dotLbl=(p,c,t)=>{mctx.fillStyle=c;mctx.beginPath();mctx.arc(mpx(p.x),mpz(p.z),8,0,7);mctx.fill();mctx.fillStyle='#fff';mctx.font='600 20px "IBM Plex Mono",monospace';mctx.fillText(t,mpx(p.x)+12,mpz(p.z)+7)};
  dotLbl(HOME,'#F1C84B','BASE');dotLbl(VILLAGE,'#5CC2B8','VILLAGE');
  mctx.strokeStyle='#E07A98';mctx.lineWidth=4;const bz=riverZ(BRIDGE_X);mctx.beginPath();mctx.moveTo(mpx(-6),mpz(bz-10));mctx.lineTo(mpx(6),mpz(bz+10));mctx.moveTo(mpx(6),mpz(bz-10));mctx.lineTo(mpx(-6),mpz(bz+10));mctx.stroke();
  if(S.parcelState!=='attached'){mctx.fillStyle='#E9DCC2';mctx.fillRect(mpx(parcel.position.x)-5,mpz(parcel.position.z)-5,10,10)}
  mctx.save();mctx.translate(mpx(S.p.x),mpz(S.p.z));mctx.rotate(-S.yaw);mctx.fillStyle='#fff';mctx.strokeStyle='#4A2B66';mctx.lineWidth=3;
  mctx.beginPath();mctx.moveTo(0,-16);mctx.lineTo(11,12);mctx.lineTo(0,6);mctx.lineTo(-11,12);mctx.closePath();mctx.stroke();mctx.fill();mctx.restore();
}
function drawAtt(){
  const W=att.width,H=att.height,c=actx;c.save();c.clearRect(0,0,W,H);
  c.translate(W/2,H/2);c.rotate(-S.roll);const py=S.pitch*H*1.4;
  c.fillStyle='#8f82bd';c.fillRect(-W,-H*2+py,W*2,H*2);c.fillStyle='#6b5642';c.fillRect(-W,py,W*2,H*2);
  c.strokeStyle='rgba(255,255,255,.85)';c.lineWidth=2;c.beginPath();c.moveTo(-W,py);c.lineTo(W,py);c.stroke();
  c.font='500 16px "IBM Plex Mono",monospace';c.fillStyle='rgba(255,255,255,.8)';c.textAlign='left';
  for(let d=-30;d<=30;d+=10){if(!d)continue;const y=py-d/57.3*H*1.4;c.beginPath();c.moveTo(-30,y);c.lineTo(30,y);c.stroke();c.fillText(Math.abs(d),36,y+5)}
  c.restore();
  c.strokeStyle='#F1C84B';c.lineWidth=5;c.beginPath();c.moveTo(W/2-70,H/2);c.lineTo(W/2-22,H/2);c.lineTo(W/2-10,H/2+12);c.moveTo(W/2+70,H/2);c.lineTo(W/2+22,H/2);c.lineTo(W/2+10,H/2+12);c.stroke();
  c.fillStyle='#F1C84B';c.beginPath();c.arc(W/2,H/2,5,0,7);c.fill();
  // heading tape
  c.fillStyle='rgba(20,14,28,.6)';c.fillRect(0,0,W,30);c.fillStyle='#fff';c.font='600 16px "IBM Plex Mono",monospace';c.textAlign='center';
  const hd=hdg();for(let d=-40;d<=40;d+=10){const v=Math.round(hd/10)*10+d;const x=W/2+(v-hd)*4;const lab=((v%360)+360)%360;c.fillText(lab===0?'N':lab===90?'E':lab===180?'S':lab===270?'W':String(lab).padStart(3,'0'),x,21)}
}
function hdg(){return ((-S.yaw*57.2958)%360+360)%360} // 0 = -Z (north)
const motorEls=[];
{const m=$('motors');for(let i=0;i<4;i++){const d=document.createElement('div');d.className='motor';d.innerHTML=`<div class="bar"><span></span></div><em>M${i+1}</em><em class="rpm">0</em>`;m.append(d);motorEls.push(d)}}
let uiT=0;
function updateUI(){
  const a=Math.max(0,agl()); $('tAlt').firstChild.nodeValue=a.toFixed(1); $('tGs').firstChild.nodeValue=Math.hypot(S.v.x,S.v.z).toFixed(1);
  $('tVs').firstChild.nodeValue=(S.v.y>=0?'+':'')+S.v.y.toFixed(1); $('tHdg').firstChild.nodeValue=String(Math.round(hdg())%360).padStart(3,'0');
  $('tHome').firstChild.nodeValue=Math.round(Math.hypot(S.p.x-HOME.x,S.p.z-HOME.z)); $('tThr').firstChild.nodeValue=Math.round(S.thr*100);
  const cell=3.5+.7*Math.pow(S.batt,.8)-.12*S.thr, volt=cell*6; $('tBatt').textContent=Math.round(S.batt*100)+'% · '+volt.toFixed(1)+' V';
  const bb=$('battBar');bb.style.width=(S.batt*100)+'%';bb.style.background=S.batt<.25?'var(--crit)':S.batt<.45?'var(--warn)':'var(--ok)';
  $('tArm').textContent=S.armed?'ARMED':'DISARMED';$('tArm').style.color=S.armed?'var(--ok)':'var(--muted)';
  motorEls.forEach((d,i)=>{const t=S.motors[i];d.querySelector('span').style.height=(t*100)+'%';d.querySelector('.rpm').textContent=Math.round(750*volt*t*.82)});
  if(Math.random()<.02)S.sats=clamp(S.sats+(Math.random()<.5?-1:1),13,19); $('tSat').firstChild.nodeValue=S.sats;
  $('tLink').firstChild.nodeValue='−'+Math.round(42+20*Math.log10(1+S.p.distanceTo(HOME)));
  const t=Math.floor(S.t);$('clock').textContent=`T+${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  if(!['SCAN','CONFIRM','DROP'].includes(S.phase))$('lock').textContent=S.armed?'SEARCHING':'STANDBY';
  else if(S.phase==='SCAN')$('lock').textContent='SCANNING '+Math.min(100,Math.round(S.scanT/6.3*100))+'%';
  drawAtt();drawMap();
}

/* depth camera (D455) render with false-colour depth */
const depthCam=new THREE.PerspectiveCamera(65,16/10,.2,200);
const depthMat=new THREE.ShaderMaterial({uniforms:{far:{value:60}},vertexShader:`varying float vD;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);
  #ifdef USE_INSTANCING
  mv=modelViewMatrix*instanceMatrix*vec4(position,1.);
  #endif
  vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform float far;varying float vD;vec3 turbo(float x){x=clamp(x,0.,1.);return clamp(vec3(.13572138+x*(4.6153926+x*(-42.66032258+x*(132.13108234+x*(-152.94239396+x*59.28637943)))),.09140261+x*(2.19418839+x*(4.84296658+x*(-14.18503333+x*(4.27729857+x*2.82956604)))),.1066733+x*(12.64194608+x*(-60.58204836+x*(110.36276771+x*(-89.90310912+x*27.34824973))))),0.,1.);}
  void main(){float d=vD/far;gl_FragColor=vec4(d>1.?vec3(.04):turbo(1.-d),1.);}`});
const depthEl=$('depth');const DW=320,DH=200;const depthRT=new THREE.WebGLRenderTarget(DW,DH);depthRT.texture.encoding=THREE.LinearEncoding;
const depthBuf=new Uint8Array(DW*DH*4),dctx=$('depthC').getContext('2d'),depthImg=dctx.createImageData(DW,DH);let depthTick=0;

/* camera follow */
const camPos=new V3(),camLook=new V3();let firstFrame=true,camYaw=0;
function updateCamera(dt){
  const dp=drone.position; {let d=S.yaw-camYaw;d=Math.atan2(Math.sin(d),Math.cos(d));camYaw+=d*(1-Math.exp(-dt*3))}
  const f=new V3(-Math.sin(camYaw),0,-Math.cos(camYaw));
  if(cam==='orbit'){controls.target.lerp(dp,1-Math.exp(-dt*10));controls.update();return}
  let want,look;
  if(cam==='chase'){const air=S.armed;want=dp.clone().addScaledVector(f,-(air?3.2:2.2)).add(new V3(0,air?1.15:.9,0));look=dp.clone().addScaledVector(f,1.5).add(new V3(0,.05,0))}
  else if(cam==='top'){want=dp.clone().add(new V3(-55,75,85));look=dp.clone()}
  else{ // FPV from the camera mount
    want=new V3(0,.0,-.27).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion())).add(dp);look=want.clone().add(new V3(0,-.35,-1).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion())))}
  const k=cam==='top'?1-Math.exp(-dt*2):1;
  if(firstFrame){camPos.copy(want);camLook.copy(look);firstFrame=false}
  camPos.lerp(want,k);camLook.lerp(look,cam==='top'?1-Math.exp(-dt*4):1);
  const g=groundH(camPos.x,camPos.z)+.6;if(camPos.y<g)camPos.y=g;
  camera.position.copy(camPos);camera.lookAt(camLook);
}

/* ---------- main loop ---------- */
function resize(){const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}
new ResizeObserver(resize).observe(canvas);resize();
let last=performance.now(),acc=0,spinA=0;const DT=1/120;
function frame(now){
  requestAnimationFrame(frame);
  let dt=Math.min(.05,(now-last)/1000);last=now;
  if(!parts.length){renderer.render(scene,camera);return}
  const sp=SPEEDS[$('speed').value];acc+=dt*sp;let n=0;while(acc>=DT&&n<480){step(DT);acc-=DT;n++}
  // pose
  drone.position.copy(S.p); body.rotation.set(S.pitch,S.yaw,S.roll,'YXZ');
  // props
  const test=mode==='inspect'&&$('spinTest').checked;
  props.forEach((p,i)=>{const rpm=test?.5:S.motors[i];const w=rpm*95*(reduce?.2:1);p.mesh.rotation.y+=p.dir*w*dt;p.disc.material.opacity=clamp((rpm-.05)*1.1,0,.55)});
  // environment animation
  const w=scene.userData.water;w.position.y=WATER+Math.sin(now*.0006)*.08;
  lockRing.material.opacity=['CONFIRM','DROP'].includes(S.phase)?.55+.35*Math.sin(now*.006):S.phase==='SCAN'?.25:0;
  lockRing.scale.setScalar(S.phase==='SCAN'?1.6-Math.min(.6,S.scanT/6.3*.6):1);
  scanCone.material.opacity=S.phase==='SCAN'?.10+.05*Math.sin(now*.01):0;scanCone.position.copy(drone.position);scanCone.rotation.y=S.yaw;
  sun.position.copy(drone.position).add(new V3(-24,48,16));sun.target.position.copy(drone.position);
  updateCamera(dt);
  renderer.setScissorTest(false);renderer.render(scene,camera);
  // depth inset (rendered off-screen, copied into the D455 panel)
  depthTick++;
  if(mode!=='inspect'&&depthTick%3===0&&depthEl.offsetParent){
    const q=body.getWorldQuaternion(new THREE.Quaternion());depthCam.position.copy(new V3(0,0,-.3).applyQuaternion(q).add(drone.position));
    depthCam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1,0,0),-.62));
    const bg=scene.background,fog=scene.fog;scene.background=new THREE.Color('#0a0a0a');scene.fog=null;scene.overrideMaterial=depthMat;drone.visible=false;scanCone.visible=false;chute.visible&&(chute.userData.v=1);
    renderer.setRenderTarget(depthRT);renderer.render(scene,depthCam);renderer.readRenderTargetPixels(depthRT,0,0,DW,DH,depthBuf);renderer.setRenderTarget(null);
    scene.overrideMaterial=null;scene.background=bg;scene.fog=fog;drone.visible=true;scanCone.visible=true;
    for(let y=0;y<DH;y++)depthImg.data.set(depthBuf.subarray((DH-1-y)*DW*4,(DH-y)*DW*4),y*DW*4);
    dctx.putImageData(depthImg,0,0);
  }
  uiT+=dt;if(uiT>.08){uiT=0;updateUI()}
}
requestAnimationFrame(frame);
})();
