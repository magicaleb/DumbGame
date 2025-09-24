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
    // If we already generated a music buffer, use it. Otherwise create one.
    const playBuffer = (buf)=>{
      const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; src.connect(SoundManager.master);
      src.start();
      this._music = {source: src, buffer: buf};
    };
    if(this.musicBuffer){ playBuffer(this.musicBuffer); }
    else {
      // generate a 30s chiptune buffer (synchronous but reasonably fast)
      const buf = SoundManager._generateChiptuneBuffer(30);
      this.musicBuffer = buf;
      playBuffer(buf);
    }
  }
  static stopMusic(){ if(this._music){ try{ if(this._music.source) this._music.source.stop(); }catch(e){} if(this._music.interval) clearInterval(this._music.interval); this._music=null; } }

  // Procedural chiptune generator: returns an AudioBuffer of given seconds
  static _generateChiptuneBuffer(seconds=30, sampleRate=44100){
    ensureAudio();
    const sr = sampleRate; const len = Math.floor(seconds * sr);
    const channels = 2;
    const buf = audioCtx.createBuffer(channels, len, sr);
    // simple instruments: square melody, triangle bass, noise percussion
    const melodySeq = [0,3,7,10,7,3,0,-2]; // a phrase
    const bpm = 120; const beatSec = 60/bpm; const ticks = Math.floor(seconds / (beatSec/2));
    // helper waveform generators
    function square(sampleRate, freq, t){ return Math.sign(Math.sin(2*Math.PI*freq*t)); }
    function triangle(sampleRate, freq, t){ return 2*Math.abs(2*((t*freq)%1)-1)-1; }
    function noise(){ return Math.random()*2-1; }

    const ch0 = buf.getChannelData(0); const ch1 = buf.getChannelData(1);
    for(let i=0;i<len;i++){
      const t = i/sr;
      // melody: change every 0.5s
      const step = Math.floor(t/0.5) % melodySeq.length;
      const note = melodySeq[step];
      const base = 220; const freq = base * Math.pow(2, note/12);
      const mel = 0.25 * square(sr,freq,t) * (0.6 + 0.4*Math.sin(0.5*t));
      // bass on quarter notes
      const bassStep = Math.floor(t/1.0)%4; const bassNote = [-12,-12,-5,-7][bassStep];
      const bassFreq = 110 * Math.pow(2, bassNote/12);
      const b = 0.12 * triangle(sr,bassFreq,t);
      // percussion: simple click on every beat
      const isBeat = (Math.floor(t/beatSec) !== Math.floor((t-1/sr)/beatSec));
      const perc = ((Math.floor(t/beatSec*2) % 2)===0) ? (0.08 * (Math.random()*2-1) * Math.exp(-6*(t%beatSec))) : 0;
      // small arpeggio overlay
      const arp = 0.06 * square(sr, freq*2, t) * (0.4 + 0.6*Math.cos(1.5*t));
      const s = mel + b + perc + arp;
      // soft stereo panning
      ch0[i] = Math.tanh(s * 1.0) * (0.95);
      ch1[i] = Math.tanh(s * 1.0) * (0.95);
    }
    return buf;
  }
  static _cleanupMusic(){ if(this._music){ try{ if(this._music.lead) this._music.lead.stop(); if(this._music.sub) this._music.sub.stop(); }catch(e){} if(this._music.interval) clearInterval(this._music.interval); this._music=null; } }
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
    if(musicToggle.checked){ SoundManager.startMusic(); }
    else { SoundManager.stopMusic(); }
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
    
    // New enhanced combat system
    this.specialType = id===1 ? 'fireball' : 'dash';
    this.stats = {speed: 1.0, power: 1.0, defense: 1.0, agility: 1.0};
    this.ultimate = 0; // 0-100 charge
    this.ultimateCooldown = 0;
    this.specialCooldown = 0; // Add missing property
    this.specialEffects = {}; // for temporary effects like shields, berserker mode
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

  // Apply stat modifiers and special effects
  let speedMod = this.stats.speed;
  let frozen = !!this.specialEffects.frozen;
  if(this.specialEffects.berserker) speedMod *= 1.5;
  if(frozen) speedMod *= 0.1;

  // horizontal movement
  const acc = 1400 * speedMod; const maxV = 420 * speedMod; const friction=0.85;
    if(left && !frozen){ this.vx -= acc*dt; this.facing = -1; }
    if(right && !frozen){ this.vx += acc*dt; this.facing = 1; }
    if(!left && !right) this.vx *= friction;
    this.vx = Math.max(-maxV, Math.min(maxV, this.vx));

  // gravity
  this.vy += 2200*dt;

    // simple jump logic: allow double-jump
    if(jump){
      if(this.onGround){ this.vy = -700; this.onGround=false; this.jumpCount=1; SoundManager.sfxJump(); particlesJump(this.x+this.w/2,this.y+this.h); }
      else if(this.jumpCount>0){ this.vy = -650; this.jumpCount=0; SoundManager.sfxJump(); particlesJump(this.x+this.w/2,this.y+this.h); }
    }

    // special ability with directional input
    if(special && this.attackCooldown<=0 && !this.specialCooldown){ 
      this.attackCooldown = 0.3; 
      this.specialCooldown = 0.8; // Reduced cooldown for more fun
      
      // Detect direction for special
      let direction = 'neutral';
      if(jump) direction = 'up';
      else if(input.isDown(this.controls.down)) direction = 'down';
      
      this.doSpecial(direction); 
    }
    
    // ultimate ability (new key binding)
    const ultimate = input.isDown(this.controls.ultimate);
    if(ultimate && this.ultimate >= 100 && this.ultimateCooldown <= 0){
      this.ultimateCooldown = 3.0;
      this.doUltimate();
    }
    
    // attack with directional input
    if(attack && this.attackCooldown<=0 && this.hitstun <= 0){ 
      this.attackCooldown = 0.25 / this.stats.speed; // Speed affects attack speed
      
      // Detect direction for attack
      let attackDirection = 'neutral';
      if(jump) attackDirection = 'up';
      else if(input.isDown(this.controls.down)) attackDirection = 'down';
      
      this.doAttack(other, attackDirection); 
    }

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

  // check off-screen for KO or 175% damage
  if(this.y > H+300 || this.damage >= 175){ this.loseStock(); }

    // Update timers
    if(this.attackCooldown>0) this.attackCooldown -= dt;
    if(this.specialCooldown>0) this.specialCooldown -= dt; else this.specialCooldown = 0;
    if(this.ultimateCooldown>0) this.ultimateCooldown -= dt;
    if(this.hitstun>0) this.hitstun -= dt;
    if(this.invulnerable>0) this.invulnerable -= dt;
    
    // Update special effects
    Object.keys(this.specialEffects).forEach(effect => {
      if(this.specialEffects[effect] > 0) {
        this.specialEffects[effect] -= dt;
        if(this.specialEffects[effect] <= 0) delete this.specialEffects[effect];
      }
    });
    
    // Ultimate charging - charge from dealing/taking damage and combat activity
    if(this.ultimate < 100) {
      this.ultimate += dt * 8; // Passive charge
      this.ultimate = Math.min(100, this.ultimate);
    }    // re-enable grabbing after some frames
    if(!this.canGrab){ this.canGrab = true; }

    // animation timer
    this.anim.t += dt; if(this.anim.t > 0.12){ this.anim.t = 0; this.anim.frame = (this.anim.frame+1)%4; }
  }

  doAttack(other, direction = 'neutral'){
    // Enhanced attack with stat scaling and directional variants
    let range = (50 + Math.min(200, this.damage*0.5)) * this.stats.power;
    let hx, hy, hw, hh;
    let knockModifierX = 1, knockModifierY = 1;
    let damageModifier = 1;
    
    // Directional attack variants
    if(direction === 'up') {
      // Upward attack - anti-air
      hx = this.x - 10;
      hy = this.y - 40;
      hw = this.w + 20;
      hh = 50;
      knockModifierY = 2; // Strong upward knockback
      damageModifier = 1.2; // Stronger damage
    } else if(direction === 'down') {
      // Downward attack - spike
      hx = this.x - 5;
      hy = this.y + this.h - 10;
      hw = this.w + 10;
      hh = 30;
      knockModifierY = -1; // Downward spike
      damageModifier = 1.3; // Very strong spike
    } else {
      // Normal horizontal attack
      hx = this.facing===1 ? this.x+this.w : this.x-range;
      hy = this.y + 20;
      hw = range;
      hh = 30;
    }
    
    SoundManager.sfxAttack();
    
    // Check for special dash attack
    const isDashAttack = !!this.specialEffects.dashAttack;
    
    // draw hit effect
    effects.push({type:'hit',x:hx,y:hy,t:0.15,size:isDashAttack?2:1});
    
    // hit detection
    if(rectsOverlap({x:hx,y:hy,w:hw,h:hh},{x:other.x,y:other.y,w:other.w,h:other.h})){ 
      // Check for counter
      if(other.specialEffects.counter) {
        // Counter attack!
        other.specialEffects.counter = 0;
        this.hurt(8, {x: -this.facing*400, y: -300});
        SoundManager.beep(800, 0.1, 0.08);
        return;
      }
      
      // Check for shield
      if(other.specialEffects.shield) {
        other.specialEffects.shield -= 1.0;
        SoundManager.beep(900, 0.05, 0.04);
        screenShake(3);
        return;
      }
      
      const baseDmg = (isDashAttack ? 10 : 8) * damageModifier;
      const dmg = baseDmg * this.stats.power * (this.specialEffects.berserker ? 1.4 : 1);
      const knockFactor = (12 + other.damage*0.12) * this.stats.power;
      const defenseReduction = 1 / other.stats.defense;
      
      const kx = this.facing*knockFactor*25*defenseReduction*(1 + other.damage*0.008)*knockModifierX;
      const ky = -420*defenseReduction*(1 + other.damage*0.012)*knockModifierY;
      
      if(other.invulnerable<=0){ 
        other.hurt(dmg*defenseReduction, {x:kx, y:ky}); 
        SoundManager.sfxRandomPunch(); 
        other.hitstun = 0.2 / other.stats.speed; 
        particlesHit(other.x+other.w/2, other.y+other.h/2); 
        screenShake(isDashAttack ? 10 : 7); 
        other.invulnerable = 0.1;
        
        // Charge ultimate from successful hits
        this.ultimate = Math.min(100, this.ultimate + (isDashAttack ? 15 : 8));
      }
    }
  }

  doSpecial(direction = 'neutral'){
    const specials = {
      // Shared specials for both players (now only 5)
      fireball: () => {
        const speed = 500 * this.stats.power;
        let vx = this.facing * speed;
        let vy = -20;
        
        // Directional variants
        if(direction === 'up') vy = -400; // Upward fireball
        if(direction === 'down') vy = 200; // Downward fireball
        
        projectiles.push(new Projectile(this.x+this.w/2, this.y+30, vx, vy, this.id, 'fireball'));
        SoundManager.sfxPower();
      },
      lightning: () => {
        // Lightning strike with directional control
        let strikeX = this.x + this.w/2 + this.facing * 100;
        let strikeY = 0;
        
        if(direction === 'up') strikeY = this.y - 200; // Lightning above
        else if(direction === 'down') strikeY = this.y + 100; // Lightning below
        
        projectiles.push(new Projectile(strikeX, strikeY, 0, 800, this.id, 'lightning'));
        SoundManager.beep(1200, 0.1, 0.08);
        screenShake(8);
      },
      shield: () => {
        let shieldDuration = 3.0;
        if(direction === 'up') shieldDuration = 5.0; // Stronger overhead shield
        if(direction === 'down') shieldDuration = 2.0; // Quick ground shield
        
        this.specialEffects.shield = shieldDuration;
        SoundManager.beep(600, 0.2, 0.06);
        particlesHit(this.x+this.w/2, this.y+this.h/2);
      },
      teleport: () => {
        let newX = this.x;
        let newY = this.y;
        
        if(direction === 'up') {
          newY = Math.max(50, this.y - 150); // Teleport up
        } else if(direction === 'down') {
          newY = Math.min(H-200, this.y + 100); // Teleport down
        } else {
          // Teleport behind opponent
          const target = this.id === 1 ? p2 : p1;
          newX = target.x + (target.facing * -60);
          newY = target.y;
        }
        
        this.x = Math.max(0, Math.min(W-this.w, newX));
        this.y = newY;
        this.invulnerable = 0.3;
        particlesJump(this.x+this.w/2, this.y+this.h);
        SoundManager.beep(800, 0.15, 0.06);
      },
      dash: () => {
        if(direction === 'up') {
          this.vy = -700; // Dash upward
          this.vx = this.facing * 600 * this.stats.speed * 0.7;
        } else if(direction === 'down') {
          this.vy = 400; // Slam downward
          this.specialEffects.slamAttack = 1.0;
        } else {
          this.vx = this.facing * 800 * this.stats.speed; // Horizontal dash
        }
        
        this.specialEffects.dashAttack = 0.5;
        SoundManager.sfxAttack();
        particlesJump(this.x, this.y+this.h);
      }
    };
    
    if(specials[this.specialType]) {
      specials[this.specialType].call(this);
    }
  }
  
  doUltimate(){
    const ultimates = {
      // Devastating screen-clearing attacks
      fireball: () => {
        for(let i = 0; i < 5; i++){
          setTimeout(() => {
            const angle = (i - 2) * 0.3;
            const vx = Math.cos(angle) * 700 * this.facing;
            const vy = Math.sin(angle) * 700;
            projectiles.push(new Projectile(this.x+this.w/2, this.y+30, vx, vy, this.id, 'ultimate'));
          }, i * 100);
        }
        SoundManager.beep(150, 0.8, 0.12);
        screenShake(15);
      },
      dash: () => {
        // Energy Wave Ultimate - creates expanding shockwave
        this.specialEffects.energyWave = 2.0; // Duration of wave effect
        
        // Create multiple wave projectiles in all directions
        for(let angle = 0; angle < 360; angle += 30) {
          const radian = (angle * Math.PI) / 180;
          const speed = 400;
          const vx = Math.cos(radian) * speed;
          const vy = Math.sin(radian) * speed;
          
          setTimeout(() => {
            projectiles.push(new Projectile(this.x+this.w/2, this.y+this.h/2, vx, vy, this.id, 'ultimate'));
          }, angle * 2); // Stagger the waves
        }
        
        // Add screen-clearing effect and massive knockback resistance
        this.invulnerable = 0.5;
        screenShake(20);
        SoundManager.beep(100, 0.8, 0.15);
        
        // Visual effect
        for(let i = 0; i < 20; i++) {
          particlesHit(this.x + this.w/2 + (Math.random()-0.5)*100, this.y + this.h/2 + (Math.random()-0.5)*100);
        }
      }
    };
    
    const baseUlt = this.id === 1 ? 'fireball' : 'dash';
    if(ultimates[baseUlt]) {
      ultimates[baseUlt].call(this);
      this.ultimate = 0; // reset charge
    }
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
  constructor(x,y,vx,vy, owner, type='fireball'){ 
    this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.owner=owner; this.type=type; this.life=2.5;
    
    // Type-specific properties
    if(type === 'fireball') {
      this.w=18; this.h=18; this.damage=8; this.knockback=260; this.color='#ff5555';
    } else if(type === 'lightning') {
      this.w=12; this.h=40; this.damage=10; this.knockback=200; this.color='#ffff55';
      this.life = 0.3; this.vy = 0; // Lightning doesn't fall
    } else if(type === 'ultimate') {
      this.w=40; this.h=40; this.damage=25; this.knockback=500; this.color='#ff00ff';
      this.life = 1.8;
    }
  }
  
  update(dt,players){ 
    if(this.type !== 'lightning') this.vy += 1600*dt; 
    this.x += this.vx*dt; 
    this.y += this.vy*dt; 
    this.life -= dt; 
    
    // bounds
    if(this.y > H || this.x < -50 || this.x > W+50) this.life=0;
    
    // Hit detection
    for(const p of players){ 
      if(p.id !== this.owner && p.alive && p.invulnerable <= 0 && rectsOverlap({x:this.x,y:this.y,w:this.w,h:this.h},{x:p.x,y:p.y,w:p.w,h:p.h})){
        // Check for shields
        if(p.specialEffects.shield && this.type !== 'ultimate') {
          p.specialEffects.shield -= 1.0;
          SoundManager.beep(900, 0.05, 0.04);
          this.life = 0;
          return;
        }
        
        const knockX = Math.sign(this.vx) * this.knockback;
        const knockY = this.type === 'ultimate' ? -400 : -260;
        p.hurt(this.damage, {x:knockX, y:knockY}); 
        this.life=0; 
        SoundManager.sfxHit(); 
        particlesHit(p.x+p.w/2, p.y+p.h/2);
        screenShake(this.type === 'ultimate' ? 12 : 6);
        p.invulnerable = this.type === 'ultimate' ? 0.3 : 0.1;
      }
    }
  }
  
  draw(){ 
    ctx.fillStyle = this.color; 
    if(this.type === 'lightning') {
      // Draw lightning bolt effect
      ctx.fillRect(this.x-2, this.y, 4, this.h);
      ctx.fillRect(this.x-6, this.y+10, 12, 4);
      ctx.fillRect(this.x-4, this.y+20, 8, 4);
    } else {
      ctx.fillRect(this.x,this.y,this.w,this.h); 
      if(this.type === 'ultimate') {
        // Glowing effect for ultimates
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(this.x+5,this.y+5,this.w-10,this.h-10);
      }
    }
  }
}

function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }

// Globals
const stage = new Stage();
const effects = [];
const projectiles = [];
const particles = [];
let shake = {time:0,magnitude:0};

const p1 = new Player(1, stage.spawnPoints[0].x, stage.spawnPoints[0].y, {left:'KeyA',right:'KeyD',up:'KeyW',down:'KeyS',attack:'KeyF',special:'KeyG',ultimate:'KeyH'});
const p2 = new Player(2, stage.spawnPoints[1].x, stage.spawnPoints[1].y, {left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown',attack:'KeyK',special:'KeyL',ultimate:'Semicolon'});
let cpuEnabled = false; let cpuDifficulty = 'med';

// basic CPU controller for p2 when enabled
function updateCPU(dt){
  if(!cpuEnabled) return;
  const ai = p2; const target = p1;
  if(!ai.alive) return;
  // movement: approach target
  const dx = (target.x - ai.x);
  if(Math.abs(dx) > 60){ if(dx<0) ai.vx -= 1200*dt; else ai.vx += 1200*dt; }
  // jump if player is above and close
  if(target.y + 20 < ai.y && Math.abs(dx) < 160 && Math.random() < (cpuDifficulty==='hard'?0.1:0.04)){
    if(ai.onGround) { ai.vy = -720; ai.onGround=false; SoundManager.sfxJump(); }
  }
  // attack if close
  if(Math.abs(dx) < 80 && Math.random() < (cpuDifficulty==='hard'?0.12:0.06)){
    if(ai.attackCooldown<=0){ ai.attackCooldown = 0.3; ai.doAttack(p1); }
  }
  // special occasionally
  if(Math.abs(dx) > 200 && Math.random() < 0.02 && ai.specialCooldown<=0){ ai.specialCooldown = 1.2; ai.doSpecial(); }
  
  // ultimate if charged and close
  if(ai.ultimate >= 100 && Math.abs(dx) < 120 && Math.random() < 0.08 && ai.ultimateCooldown <= 0){
    ai.ultimateCooldown = 3.0; ai.doUltimate();
  }
}

let last = performance.now();
let running = false;

function update(){
  const now = performance.now(); const dt = Math.min(1/30,(now-last)/1000); last = now;
  if(!running) return;
  p1.update(dt,stage,p2); p2.update(dt,stage,p1);
  updateCPU(dt);
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
function startMatch(){ 
  applyCharacterCustomization();
  startScreen.classList.add('hidden'); 
  endScreen.classList.add('hidden'); 
  running=true; 
  last=performance.now(); 
  SoundManager.init(); 
  requestAnimationFrame(update); 
}
function showEnd(){ endScreen.classList.remove('hidden'); startScreen.classList.add('hidden'); endTitle.textContent = p1.stocks>p2.stocks ? 'Player 1 Wins!' : 'Player 2 Wins!'; }

btnStart.addEventListener('click', ()=>{
  // read options
  const stocks = parseInt(document.getElementById('opt-stocks').value || '3',10);
  const stageOpt = document.getElementById('opt-stage').value || 'default';
  cpuEnabled = !!document.getElementById('opt-cpu').checked;
  cpuDifficulty = document.getElementById('opt-diff').value || 'med';
  // apply stocks
  p1.stocks = stocks; p2.stocks = stocks;
  // apply stage presets
  if(stageOpt==='small'){
    stage.platforms = [ {x:W/2-110,y:stage.groundY-120,w:220,h:16} ];
  } else if(stageOpt==='wide'){
    stage.platforms = [ {x:W/2-220,y:stage.groundY-200,w:440,h:16}, {x:220,y:stage.groundY-260,w:160,h:12} ];
  } else {
    stage.platforms = [ {x:W/2-160,y:stage.groundY-160,w:320,h:16}, {x:220,y:stage.groundY-260,w:160,h:12}, {x:W-380,y:stage.groundY-260,w:160,h:12} ];
  }
  p1.spawn(stage.spawnPoints[0].x,stage.spawnPoints[0].y); p2.spawn(stage.spawnPoints[1].x,stage.spawnPoints[1].y);
  SoundManager.startMusic(); SoundManager.sfxUI(); startMatch();
});
btnRestart.addEventListener('click', ()=>{ p1.stocks=3; p2.stocks=3; p1.damage=0; p2.damage=0; p1.alive=true; p2.alive=true; SoundManager.sfxUI(); startMatch(); });

// Function to apply character customization
function applyCharacterCustomization() {
  // Apply Player 1 settings
  const p1SpecialEl = document.querySelector('input[name="p1-special"]:checked');
  if(p1SpecialEl) p1.specialType = p1SpecialEl.value;
  
  p1.stats.speed = parseFloat(document.getElementById('p1-speed').value);
  p1.stats.power = parseFloat(document.getElementById('p1-power').value);
  p1.stats.defense = parseFloat(document.getElementById('p1-defense').value);
  
  // Apply Player 2 settings
  const p2SpecialEl = document.querySelector('input[name="p2-special"]:checked');
  if(p2SpecialEl) p2.specialType = p2SpecialEl.value;
  
  p2.stats.speed = parseFloat(document.getElementById('p2-speed').value);
  p2.stats.power = parseFloat(document.getElementById('p2-power').value);
  p2.stats.defense = parseFloat(document.getElementById('p2-defense').value);
  
  console.log('Character customization applied:', {
    p1: {special: p1.specialType, stats: p1.stats},
    p2: {special: p2.specialType, stats: p2.stats}
  });
}

// visual tweak: draw HUD stocks as small squares near players
function drawHUD(){
  // subtle background for HUD
  ctx.save(); ctx.globalAlpha = 0.9;
  
  // draw small stock boxes
  for(let i=0;i<p1.stocks;i++){ ctx.fillStyle = p1.color; ctx.fillRect(16+i*14,52,12,12); }
  for(let i=0;i<p2.stocks;i++){ ctx.fillStyle = p2.color; ctx.fillRect(W-120+i*14,52,12,12); }
  
  // draw special cooldown bars
  if(p1.specialCooldown>0){ 
    const w = Math.max(0, Math.min(80, (p1.specialCooldown/1.2)*80)); 
    ctx.fillStyle='#222'; ctx.fillRect(16,70,80,8); 
    ctx.fillStyle='#ffcc33'; ctx.fillRect(16,70,w,8); 
  } else { 
    ctx.fillStyle='#223'; ctx.fillRect(16,70,80,8); 
  }
  
  if(p2.specialCooldown>0){ 
    const w2 = Math.max(0, Math.min(80, (p2.specialCooldown/1.2)*80)); 
    ctx.fillStyle='#222'; ctx.fillRect(W-120,70,80,8); 
    ctx.fillStyle='#33ccff'; ctx.fillRect(W-120,70,w2,8); 
  } else { 
    ctx.fillStyle='#223'; ctx.fillRect(W-120,70,80,8); 
  }
  
  // Draw ultimate meters
  const ultBarWidth = 100;
  const ultBarHeight = 12;
  
  // Player 1 Ultimate Bar
  const ult1Width = (p1.ultimate / 100) * ultBarWidth;
  ctx.fillStyle = '#333'; ctx.fillRect(16, 82, ultBarWidth, ultBarHeight); // Background
  ctx.fillStyle = p1.ultimate >= 100 ? '#ff00ff' : '#ffcc33'; 
  ctx.fillRect(16, 82, ult1Width, ultBarHeight); // Charge
  if(p1.ultimate >= 100) {
    // Pulsing effect when ready
    ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(performance.now() * 0.01)})`;
    ctx.fillRect(16, 82, ultBarWidth, ultBarHeight);
  }
  
  // Player 2 Ultimate Bar  
  const ult2Width = (p2.ultimate / 100) * ultBarWidth;
  ctx.fillStyle = '#333'; ctx.fillRect(W-120, 82, ultBarWidth, ultBarHeight); // Background
  ctx.fillStyle = p2.ultimate >= 100 ? '#ff00ff' : '#33ccff'; 
  ctx.fillRect(W-120, 82, ult2Width, ultBarHeight); // Charge
  if(p2.ultimate >= 100) {
    // Pulsing effect when ready
    ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(performance.now() * 0.01)})`;
    ctx.fillRect(W-120, 82, ultBarWidth, ultBarHeight);
  }
  
  ctx.restore();
}

function particlesHit(x,y){ for(let i=0;i<10;i++){ particles.push({x:x + (Math.random()*24-12), y:y + (Math.random()*24-12), vx:(Math.random()*300-150), vy:(Math.random()*-200), t:0.45 + Math.random()*0.2, col:'#fff', s:2+Math.random()*3}); } }
function particlesJump(x,y){ for(let i=0;i<6;i++){ particles.push({x:x + (Math.random()*20-10), y:y, vx:(Math.random()*80-40), vy:(Math.random()*-200-60), t:0.4 + Math.random()*0.2, col:'#ccf', s:2}); } }
function screenShake(mag){ shake.time = Math.max(shake.time,0.12); shake.magnitude = Math.max(shake.magnitude, mag); }

// initial
showStart();
// stop music when leaving
window.addEventListener('blur', ()=>{ if(SoundManager.master) SoundManager.master.gain.value = 0.06; });
window.addEventListener('focus', ()=>{ if(SoundManager.master) SoundManager.master.gain.value = parseFloat(document.getElementById('volume')?.value || 0.8); });

