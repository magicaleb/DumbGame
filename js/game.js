// DumbGame - simple 2-player local fighter
// Organized into components: Game, Player, Stage, HUD, Sound

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width; const H = canvas.height;

const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const btnStart = document.getElementById('btn-start');
const btnRestart = document.getElementById('btn-restart');
const endTitle = document.getElementById('end-title');

const p1StocksEl = document.getElementById('p1-stocks');
const p2StocksEl = document.getElementById('p2-stocks');
const p1DamageEl = document.getElementById('p1-damage');
const p2DamageEl = document.getElementById('p2-damage');

let audioCtx = null;
function ensureAudio(){ if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }

// global gain node for volume control
function ensureAudioGraph(){ ensureAudio(); if(!SoundManager.master){ SoundManager.master = audioCtx.createGain(); SoundManager.master.gain.value = 0.8; SoundManager.master.connect(audioCtx.destination); } }

class SoundManager{
  static init(){ ensureAudio(); }
  static startMusic(){
    ensureAudioGraph();
    if(this._music) return;
    // richer chiptune: two oscillators + periodic arpeggio + percussion
    const lead = audioCtx.createOscillator(); const leadGain = audioCtx.createGain();
    lead.type = 'square'; lead.frequency.value = 220; leadGain.gain.value = 0.035;
    const sub = audioCtx.createOscillator(); const subGain = audioCtx.createGain();
    sub.type = 'sawtooth'; sub.frequency.value = 110; subGain.gain.value = 0.01;
    lead.connect(leadGain); leadGain.connect(SoundManager.master);
    sub.connect(subGain); subGain.connect(SoundManager.master);
    lead.start(); sub.start();
    this._music = {lead,leadGain,sub,subGain,interval:null,step:0};
    // arpeggio
    this._music.interval = setInterval(()=>{
      if(!this._music) return;
      const seq = [0,3,7,10]; // semitone offsets
      const base = 220;
      const note = seq[this._music.step % seq.length];
      const freq = base * Math.pow(2, note/12);
      lead.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
      // small percussive pluck using gain envelope on sub
      subGain.gain.cancelScheduledValues(audioCtx.currentTime);
      subGain.gain.setValueAtTime(0.01, audioCtx.currentTime);
      subGain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 0.03);
      subGain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);
      this._music.step++;
    }, 300);
  }
  static stopMusic(){ if(this._music){ try{ this._music.osc.stop(); }catch(e){} this._music=null; } }
  static beep(freq=440,dur=0.08, gain=0.08){
    ensureAudioGraph();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type='square'; o.frequency.value=freq; g.gain.value = gain;
    o.connect(g); g.connect(SoundManager.master);
    o.start(); o.stop(audioCtx.currentTime+dur);
  }
  static sfxJump(){ this.beep(880,0.06,0.06); }
  static sfxAttack(){ this.beep(520,0.05,0.06); }
  static sfxHit(){ this.beep(200,0.12,0.08); }
  static sfxKO(){ this.beep(120,0.6,0.12); }
  static sfxUI(){ this.beep(900,0.04,0.04); }
  static sfxPower(){ this.beep(700,0.12,0.06); }

  static sfxRandomPunch(){ this.beep(480 + Math.random()*120, 0.06, 0.06); }
}

// wire audio controls
const musicToggle = document.getElementById('music-toggle');
const volumeSlider = document.getElementById('volume');
if(musicToggle && volumeSlider){
  musicToggle.addEventListener('change', ()=>{
    if(!SoundManager._music){ if(musicToggle.checked) SoundManager.startMusic(); return; }
    SoundManager._music.gain.gain.value = musicToggle.checked ? 1.0 : 0.0;
  });
  volumeSlider.addEventListener('input', ()=>{
    ensureAudioGraph(); SoundManager.master.gain.value = parseFloat(volumeSlider.value);
  });
}

class Input{
  constructor(){ this.keys = {}; window.addEventListener('keydown',e=>{this.keys[e.code]=true;}); window.addEventListener('keyup',e=>{this.keys[e.code]=false;}); }
  isDown(code){return !!this.keys[code];}
}

const input = new Input();

class Stage{
  constructor(){
    this.groundY = H-120;
    this.platforms = [
      {x:W/2-160,y:this.groundY-160,w:320,h:16},
      {x:220,y:this.groundY-260,w:160,h:12},
      {x:W-380,y:this.groundY-260,w:160,h:12},
    ];
    this.ledges = []; // simplified: ledge points at platform edges
    this.spawnPoints = [{x:200,y:this.groundY-200},{x:W-200,y:this.groundY-200}];
  }
  draw(){
    // simple background
    ctx.fillStyle='#88a'; ctx.fillRect(0,0,W,H);
    // ground
    ctx.fillStyle='#553'; ctx.fillRect(0,this.groundY,W,H-this.groundY);
    // platforms
    ctx.fillStyle='#332';
    for(const p of this.platforms) ctx.fillRect(p.x,p.y,p.w,p.h);
  }
}

class Player{
  constructor(id, x,y, controls){
    this.id=id; this.x=x; this.y=y; this.w=40; this.h=60;
    this.vx=0; this.vy=0; this.onGround=false; this.onPlatform=null; this.facing=1;
    this.damage=0; this.stocks=3; this.alive=true; this.respawnTimer=0;
    this.controls=controls; this.attackCooldown=0; this.state='idle';
    this.canGrab=true; this.ledgeGrab=false; this.ledgePos=null;
    this.color = id===1? '#ffcc33' : '#33ccff';
    this.colorAccent = id===1? '#b25a00' : '#00588a';
    this.anim = {frame:0, t:0};
    this.jumpCount = 0; // for double jump
    this.hitstun = 0;
    this.invulnerable = 0;
  }
  spawn(x,y){ this.x=x; this.y=y; this.vx=0; this.vy=0; this.damage=0; this.alive=true; this.stocks=3; this.respawnTimer=0; }
  hurt(dmg, knock){ this.damage+=dmg; SoundManager.sfxHit(); this.vx += knock.x; this.vy += knock.y; }
  update(dt, stage, other){
    if(!this.alive){ this.respawnTimer -= dt; if(this.respawnTimer<=0){ this.respawn(); } return; }
    // controls
    const left = input.isDown(this.controls.left);
    const right = input.isDown(this.controls.right);
    const jump = input.isDown(this.controls.up);
    const attack = input.isDown(this.controls.attack);
    const special = input.isDown(this.controls.special);

  // horizontal
  const acc = 1400; const maxV = 420; const friction=0.85;
    if(left){ this.vx -= acc*dt; this.facing = -1; }
    if(right){ this.vx += acc*dt; this.facing = 1; }
    if(!left && !right) this.vx *= friction;
    this.vx = Math.max(-maxV, Math.min(maxV, this.vx));

  // gravity
  this.vy += 2200*dt;

    // simple jump logic: allow double-jump
    if(jump){
      if(this.onGround){ this.vy = -700; this.onGround=false; this.jumpCount=1; SoundManager.sfxJump(); particlesJump(this.x+this.w/2,this.y+this.h); }
      else if(this.jumpCount>0){ this.vy = -650; this.jumpCount=0; SoundManager.sfxJump(); particlesJump(this.x+this.w/2,this.y+this.h); }
    }

    // special: dash or projectile
  if(special && this.attackCooldown<=0 && !this.specialCooldown){ this.attackCooldown = 0.45; this.specialCooldown = 1.2; if(this.id===1) this.doFireball(); else this.doDash(); }
    // attack
    if(attack && this.attackCooldown<=0){ this.attackCooldown = 0.3; this.doAttack(other); }

    // simple ledge grab logic: if falling near platform edge, allow grab
    if(this.vy>0 && this.canGrab){
      for(const p of stage.platforms){
        // ledge positions: left and right edges
        const ledgeLeft = {x:p.x-10,y:p.y-10};
        const ledgeRight = {x:p.x+p.w-30,y:p.y-10};
        // check proximity
        const nearLeft = Math.hypot((this.x+this.w/2)-ledgeLeft.x,(this.y+this.h)-ledgeLeft.y) < 28;
        const nearRight = Math.hypot((this.x+this.w/2)-ledgeRight.x,(this.y+this.h)-ledgeRight.y) < 28;
        if((nearLeft || nearRight) && this.y > p.y-40){
          this.ledgeGrab = true; this.ledgePos = nearLeft?ledgeLeft:ledgeRight; this.vx=0; this.vy=0; this.canGrab=false; break;
        }
      }
    }

    // if grabbing, allow climb or drop
    if(this.ledgeGrab){
      if(input.isDown(this.controls.up)){ // climb
        this.y = this.ledgePos.y - this.h; this.ledgeGrab=false; this.onGround=true; this.canGrab=false; this.vy=0; }
      if(input.isDown(this.controls.down)){ // drop
        this.ledgeGrab=false; this.canGrab=false; this.vy=20; }
    }

    // position integrate
    this.x += this.vx*dt; this.y += this.vy*dt;

    // world bounds
    if(this.x < 0) this.x = 0; if(this.x+this.w>W) this.x = W-this.w;

    // collisions with ground/platforms
    this.onGround = false; this.onPlatform = null;
    // ground
    if(this.y + this.h > stage.groundY){ this.y = stage.groundY - this.h; this.vy = 0; this.onGround = true; }
    // platforms: allow jump-through from below by only colliding when above and falling
    for(const p of stage.platforms){
      if(this.x+this.w > p.x && this.x < p.x+p.w){
        const wasAbove = (this.y + this.h - this.vy*dt) <= p.y; // approx
        if(wasAbove && this.y + this.h > p.y && this.y + this.h < p.y + p.h + 200){
          // land on platform
          if(this.vy >= 0){ this.y = p.y - this.h; this.vy = 0; this.onGround=true; this.onPlatform=p; }
        }
      }
    }

  // check off-screen for KO
  if(this.y > H+300){ this.loseStock(); }

  if(this.attackCooldown>0) this.attackCooldown -= dt;
  if(this.specialCooldown>0) this.specialCooldown -= dt; else this.specialCooldown = 0;
  if(this.hitstun>0) this.hitstun -= dt;
  if(this.invulnerable>0) this.invulnerable -= dt;

    // re-enable grabbing after some frames
    if(!this.canGrab){ this.canGrab = true; }

    // animation timer
    this.anim.t += dt; if(this.anim.t > 0.12){ this.anim.t = 0; this.anim.frame = (this.anim.frame+1)%4; }
  }

  doAttack(other){
    // simple forward hitbox
    const range = 50 + Math.min(200, this.damage*0.5);
    const hx = this.facing===1 ? this.x+this.w : this.x-range;
    const hy = this.y + 20; const hw = range; const hh = 30;
    SoundManager.sfxAttack();
    // draw hit effect (transient)
    effects.push({type:'hit',x:hx,y:hy,t:0.12});
    // hit detection
    if(rectsOverlap({x:hx,y:hy,w:hw,h:hh},{x:other.x,y:other.y,w:other.w,h:other.h})){ 
      const base=6; const dmg = base; const knockFactor = 10 + other.damage*0.14;
      const kx = this.facing*knockFactor*20*(1 + other.damage*0.01);
      const ky = -380 * (1 + other.damage*0.015);
      if(other.invulnerable<=0){ other.hurt(dmg, {x:kx, y:ky}); SoundManager.sfxRandomPunch(); other.hitstun = 0.18; particlesHit(other.x+other.w/2, other.y+other.h/2); screenShake(6); other.invulnerable = 0.08; }
    }
  }

  doFireball(){
    // spawn projectile
    projectiles.push(new Projectile(this.x+this.w/2, this.y+30, this.facing*600, -40, this.id));
    SoundManager.sfxPower();
  }
  doDash(){
    this.vx += this.facing*900; SoundManager.sfxAttack();
  }

  loseStock(){ this.stocks -= 1; SoundManager.sfxKO(); this.alive=false; if(this.stocks>0){ this.respawnTimer = 2.0; } }
  respawn(){ if(this.stocks<=0){ /* out */ } else { const s = stage.spawnPoints[this.id-1]; this.x=s.x; this.y=s.y; this.vx=0; this.vy=0; this.alive=true; } }

  draw(){ if(!this.alive) return;
    const px = Math.round(this.x); const py = Math.round(this.y);
    // invulnerable flash
    const flash = this.invulnerable>0 && Math.floor(performance.now()/80)%2===0;
    // body
    ctx.fillStyle = flash ? '#fff' : this.color; ctx.fillRect(px,py+10,this.w, this.h-10);
    // head
    ctx.fillStyle = flash ? '#fff' : this.colorAccent; ctx.fillRect(px+6,py, this.w-12, 14);
    // eye
    ctx.fillStyle = '#000'; ctx.fillRect(px + (this.facing===1? this.w-14:8), py+4, 4,4);
    // damage tint
    if(this.damage>30){ ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(px,py,this.w,this.h); }
  }
}

class Projectile{
  constructor(x,y,vx,vy, owner){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.owner=owner; this.w=18; this.h=18; this.life=2.5; }
  update(dt,players){ this.vy += 1600*dt; this.x += this.vx*dt; this.y += this.vy*dt; this.life -= dt; 
    // bounds
    if(this.y > H) this.life=0;
    for(const p of players){ if(p.id !== this.owner && p.alive && rectsOverlap({x:this.x,y:this.y,w:this.w,h:this.h},{x:p.x,y:p.y,w:p.w,h:p.h})){ p.hurt(8,{x:Math.sign(this.vx)*260, y:-260}); this.life=0; SoundManager.sfxHit(); }}
  }
  draw(){ ctx.fillStyle='#ff5555'; ctx.fillRect(this.x,this.y,this.w,this.h); }
}

function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }

// Globals
const stage = new Stage();
const effects = [];
const projectiles = [];
const particles = [];
let shake = {time:0,magnitude:0};

const p1 = new Player(1, stage.spawnPoints[0].x, stage.spawnPoints[0].y, {left:'KeyA',right:'KeyD',up:'KeyW',attack:'KeyF',special:'KeyG'});
const p2 = new Player(2, stage.spawnPoints[1].x, stage.spawnPoints[1].y, {left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',attack:'KeyK',special:'KeyL'});

let last = performance.now();
let running = false;

function update(){
  const now = performance.now(); const dt = Math.min(1/30,(now-last)/1000); last = now;
  if(!running) return;
  p1.update(dt,stage,p2); p2.update(dt,stage,p1);
  for(const pr of projectiles) pr.update(dt,[p1,p2]);
  for(let i=projectiles.length-1;i>=0;i--) if(projectiles[i].life<=0) projectiles.splice(i,1);
  for(let i=effects.length-1;i>=0;i--){ effects[i].t -= dt; if(effects[i].t<=0) effects.splice(i,1); }
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.t-=dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=800*dt; p.vx*=0.99; if(p.t<=0) particles.splice(i,1); }
  if(shake.time>0){ shake.time -= dt; if(shake.time<0) shake.time=0; }

  // check KO and match end
  if(p1.stocks<=0 || p2.stocks<=0){ running=false; showEnd(); }

  // update HUD
  p1StocksEl.textContent = '❤'.repeat(Math.max(0,p1.stocks));
  p2StocksEl.textContent = '❤'.repeat(Math.max(0,p2.stocks));
  p1DamageEl.textContent = Math.round(p1.damage) + '%';
  p2DamageEl.textContent = Math.round(p2.damage) + '%';

  draw();
  drawHUD();
  requestAnimationFrame(update);
}

function draw(){ 
  // screen shake offset
  const sx = (shake.time>0)? (Math.random()*2-1)*shake.magnitude : 0;
  const sy = (shake.time>0)? (Math.random()*2-1)*shake.magnitude : 0;
  ctx.save(); ctx.clearRect(0,0,W,H); ctx.translate(sx,sy);
  stage.draw(); p1.draw(); p2.draw(); for(const pr of projectiles) pr.draw(); for(const e of effects){ if(e.type==='hit'){ ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillRect(e.x,e.y,30,8);} }
  // particles
  for(const p of particles){ ctx.fillStyle=p.col; ctx.fillRect(p.x,p.y,Math.max(2,p.s),Math.max(2,p.s)); }
  ctx.restore();
}

function showStart(){ startScreen.classList.remove('hidden'); endScreen.classList.add('hidden'); }
function startMatch(){ startScreen.classList.add('hidden'); endScreen.classList.add('hidden'); running=true; last=performance.now(); SoundManager.init(); requestAnimationFrame(update); }
function showEnd(){ endScreen.classList.remove('hidden'); startScreen.classList.add('hidden'); endTitle.textContent = p1.stocks>p2.stocks ? 'Player 1 Wins!' : 'Player 2 Wins!'; }

btnStart.addEventListener('click', ()=>{ p1.spawn(stage.spawnPoints[0].x,stage.spawnPoints[0].y); p2.spawn(stage.spawnPoints[1].x,stage.spawnPoints[1].y); SoundManager.startMusic(); SoundManager.sfxUI(); startMatch(); });
btnRestart.addEventListener('click', ()=>{ p1.stocks=3; p2.stocks=3; p1.damage=0; p2.damage=0; p1.alive=true; p2.alive=true; SoundManager.sfxUI(); startMatch(); });

// visual tweak: draw HUD stocks as small squares near players
function drawHUD(){
  // subtle background for HUD
  ctx.save(); ctx.globalAlpha = 0.9;
  // draw small stock boxes
  for(let i=0;i<p1.stocks;i++){ ctx.fillStyle = p1.color; ctx.fillRect(16+i*14,52,12,12); }
  for(let i=0;i<p2.stocks;i++){ ctx.fillStyle = p2.color; ctx.fillRect(W-120+i*14,52,12,12); }
  // draw special cooldown bars
  if(p1.specialCooldown>0){ const w = Math.max(0, Math.min(80, (p1.specialCooldown/1.2)*80)); ctx.fillStyle='#222'; ctx.fillRect(16,70,80,8); ctx.fillStyle='#ffcc33'; ctx.fillRect(16,70,w,8); }
  else { ctx.fillStyle='#223'; ctx.fillRect(16,70,80,8); }
  if(p2.specialCooldown>0){ const w2 = Math.max(0, Math.min(80, (p2.specialCooldown/1.2)*80)); ctx.fillStyle='#222'; ctx.fillRect(W-120,70,80,8); ctx.fillStyle='#33ccff'; ctx.fillRect(W-120,70,w2,8); }
  else { ctx.fillStyle='#223'; ctx.fillRect(W-120,70,80,8); }
  ctx.restore();
}

function particlesHit(x,y){ for(let i=0;i<10;i++){ particles.push({x:x + (Math.random()*24-12), y:y + (Math.random()*24-12), vx:(Math.random()*300-150), vy:(Math.random()*-200), t:0.45 + Math.random()*0.2, col:'#fff', s:2+Math.random()*3}); } }
function particlesJump(x,y){ for(let i=0;i<6;i++){ particles.push({x:x + (Math.random()*20-10), y:y, vx:(Math.random()*80-40), vy:(Math.random()*-200-60), t:0.4 + Math.random()*0.2, col:'#ccf', s:2}); } }
function screenShake(mag){ shake.time = Math.max(shake.time,0.12); shake.magnitude = Math.max(shake.magnitude, mag); }

// initial
showStart();
// stop music when leaving
window.addEventListener('blur', ()=>{ if(SoundManager._music){ SoundManager._music.gain.gain.value = 0; } });

