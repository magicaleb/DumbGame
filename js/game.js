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
    // Enhanced background with depth
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2a3f5f');
    grad.addColorStop(0.4, '#1e2a40');
    grad.addColorStop(1, '#0f1419');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    
    // Background elements for depth
    ctx.fillStyle = 'rgba(100,120,140,0.3)';
    for(let i = 0; i < 8; i++) {
      const x = (i * 160) + Math.sin(performance.now() * 0.001 + i) * 20;
      const y = 100 + Math.sin(i * 0.5) * 30;
      ctx.fillRect(x, y, 80, 6);
    }
    
    // ground with texture
    const groundGrad = ctx.createLinearGradient(0, this.groundY, 0, H);
    groundGrad.addColorStop(0, '#4a5c3a');
    groundGrad.addColorStop(0.3, '#3d4f2d');
    groundGrad.addColorStop(1, '#2a3320');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, this.groundY, W, H-this.groundY);
    
    // Ground edge highlight
    ctx.fillStyle = '#5a6c4a';
    ctx.fillRect(0, this.groundY, W, 4);
    
    // platforms with improved look
    for(const p of this.platforms) {
      // Platform shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(p.x+2, p.y+2, p.w, p.h);
      
      // Platform gradient
      const platGrad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      platGrad.addColorStop(0, '#4a4a4a');
      platGrad.addColorStop(0.5, '#333333');
      platGrad.addColorStop(1, '#222222');
      ctx.fillStyle = platGrad;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      
      // Platform highlight
      ctx.fillStyle = '#555555';
      ctx.fillRect(p.x, p.y, p.w, 2);
    }
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
    this.coyoteTime = 0; // Grace period for jumping after leaving ground
    this.jumpBufferTime = 0; // Buffer for jump input
    
    // New enhanced combat system
    this.specialType = id===1 ? 'fireball' : 'dash';
    this.stats = {speed: 1.0, power: 1.0, defense: 1.0, agility: 1.0};
    this.ultimate = 0; // 0-100 charge
    this.ultimateCooldown = 0;
    this.specialCooldown = 0; // Add missing property
    this.specialEffects = {}; // for temporary effects like shields, berserker mode
  }
  spawn(x,y){ this.x=x; this.y=y; this.vx=0; this.vy=0; this.damage=0; this.alive=true; this.stocks=3; this.respawnTimer=0; }
  hurt(dmg, knock){ 
    this.damage += dmg; 
    SoundManager.sfxHit(); 
    this.vx += knock.x; 
    this.vy += knock.y; 
    
    // Add floating damage number
    damageNumbers.push({
      x: this.x + this.w/2, 
      y: this.y, 
      damage: Math.round(dmg), 
      t: 1.0, 
      vy: -100
    });
  }
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

  // horizontal movement with improved air control
  const acc = this.onGround ? 1400 * speedMod : 800 * speedMod; // Less air control 
  const maxV = 420 * speedMod; 
  const friction = this.onGround ? 0.85 : 0.95; // Less friction in air
  
    if(left && !frozen){ this.vx -= acc*dt; this.facing = -1; }
    if(right && !frozen){ this.vx += acc*dt; this.facing = 1; }
    if(!left && !right) this.vx *= friction;
    this.vx = Math.max(-maxV, Math.min(maxV, this.vx));

  // gravity with variable jump height
  this.vy += 2200*dt;

    // Coyote time - allow jumping briefly after leaving ground
    if(this.onGround) {
      this.coyoteTime = 0.1; // 100ms grace period
    } else {
      this.coyoteTime = Math.max(0, this.coyoteTime - dt);
    }
    
    // Jump buffer - remember jump input briefly
    if(jump) {
      this.jumpBufferTime = 0.1; // 100ms buffer
    } else {
      this.jumpBufferTime = Math.max(0, this.jumpBufferTime - dt);
    }
    
    // Improved jump logic with coyote time and jump buffering
    if(this.jumpBufferTime > 0){
      if(this.onGround || this.coyoteTime > 0){ 
        this.vy = -700; 
        this.onGround=false; 
        this.coyoteTime = 0;
        this.jumpBufferTime = 0;
        this.jumpCount=1; 
        SoundManager.sfxJump(); 
        particlesJump(this.x+this.w/2,this.y+this.h); 
      }
      else if(this.jumpCount>0){ 
        this.vy = -650; 
        this.jumpCount=0; 
        this.jumpBufferTime = 0;
        SoundManager.sfxJump(); 
        particlesJump(this.x+this.w/2,this.y+this.h); 
      }
    }

    // special ability
    if(special && this.attackCooldown<=0 && !this.specialCooldown){ 
      this.attackCooldown = 0.3; 
      this.specialCooldown = 0.8; // Reduced cooldown for more fun
      this.doSpecial(); 
    }
    
    // ultimate ability (new key binding)
    const ultimate = input.isDown(this.controls.ultimate);
    if(ultimate && this.ultimate >= 100 && this.ultimateCooldown <= 0){
      this.ultimateCooldown = 3.0;
      this.doUltimate();
    }
    
    // attack
    if(attack && this.attackCooldown<=0 && this.hitstun <= 0){ 
      this.attackCooldown = 0.25 / this.stats.speed; // Speed affects attack speed
      this.doAttack(other); 
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

  // check off-screen for KO
  if(this.y > H+300){ this.loseStock(); }

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

  doAttack(other){
    // Enhanced attack with stat scaling
    const range = (50 + Math.min(200, this.damage*0.5)) * this.stats.power;
    const hx = this.facing===1 ? this.x+this.w : this.x-range;
    const hy = this.y + 20; const hw = range; const hh = 30;
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
      
      const baseDmg = isDashAttack ? 12 : 10; // Slightly increased base damage
      const dmg = baseDmg * this.stats.power * (this.specialEffects.berserker ? 1.4 : 1);
      const knockFactor = (10 + other.damage*0.1) * this.stats.power; // Slightly reduced knockback scaling
      const defenseReduction = 1 / other.stats.defense;
      
      const kx = this.facing*knockFactor*20*defenseReduction*(1 + other.damage*0.006); // Reduced knockback
      const ky = -350*defenseReduction*(1 + other.damage*0.01); // Reduced vertical knockback
      
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

  doSpecial(){
    const specials = {
      // Player 1 specials
      fireball: () => {
        const speed = 500 * this.stats.power;
        projectiles.push(new Projectile(this.x+this.w/2, this.y+30, this.facing*speed, -20, this.id, 'fireball'));
        SoundManager.sfxPower();
        // Add muzzle flash effect
        effects.push({type:'muzzleFlash', x: this.x + (this.facing > 0 ? this.w : 0), y: this.y+25, t: 0.1});
      },
      lightning: () => {
        // Instant hit across screen
        const target = this.id === 1 ? p2 : p1;
        if(Math.abs(target.x - this.x) < W/2) {
          target.hurt(12 * this.stats.power, {x: this.facing*300, y: -200});
          effects.push({type:'lightning', x: this.x, y: this.y, t: 0.3});
          SoundManager.beep(1200, 0.1, 0.08);
          // Add screen flash
          effects.push({type:'screenFlash', t: 0.1});
        }
      },
      shield: () => {
        this.specialEffects.shield = 3.0; // 3 second shield
        SoundManager.beep(600, 0.2, 0.06);
        // Add shield activation effect
        for(let i = 0; i < 20; i++) {
          const angle = (i / 20) * Math.PI * 2;
          particles.push({
            x: this.x + this.w/2 + Math.cos(angle) * 30,
            y: this.y + this.h/2 + Math.sin(angle) * 30,
            vx: Math.cos(angle) * 50,
            vy: Math.sin(angle) * 50,
            t: 0.6,
            col: '#4af',
            s: 3
          });
        }
      },
      teleport: () => {
        const target = this.id === 1 ? p2 : p1;
        // Teleport out effect
        for(let i = 0; i < 15; i++) {
          particles.push({
            x: this.x + this.w/2,
            y: this.y + this.h/2,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200,
            t: 0.5,
            col: '#f4f',
            s: 2
          });
        }
        
        const behindX = target.x + (target.facing * -60);
        this.x = Math.max(0, Math.min(W-this.w, behindX));
        this.y = target.y;
        
        // Teleport in effect
        for(let i = 0; i < 15; i++) {
          particles.push({
            x: this.x + this.w/2,
            y: this.y + this.h/2,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200,
            t: 0.5,
            col: '#f4f',
            s: 2
          });
        }
        
        particlesJump(this.x+this.w/2, this.y+this.h);
        SoundManager.beep(800, 0.15, 0.06);
      },
      multi: () => {
        // 3-hit combo
        for(let i = 0; i < 3; i++){
          setTimeout(() => {
            const target = this.id === 1 ? p2 : p1;
            if(Math.abs(target.x - this.x) < 100 && Math.abs(target.y - this.y) < 80){
              target.hurt(4 * this.stats.power, {x: this.facing*150*(i+1), y: -100*(i+1)});
              particlesHit(target.x+target.w/2, target.y+target.h/2);
              SoundManager.sfxRandomPunch();
            }
          }, i * 200);
        }
      },
      
      // Player 2 specials  
      dash: () => {
        this.vx += this.facing * 800 * this.stats.speed;
        this.specialEffects.dashAttack = 0.5; // damage on contact for 0.5s
        SoundManager.sfxAttack();
        // Add dash trail effect
        for(let i = 0; i < 8; i++) {
          particles.push({
            x: this.x + this.w/2,
            y: this.y + this.h/2,
            vx: -this.facing * 100 + (Math.random() - 0.5) * 50,
            vy: (Math.random() - 0.5) * 100,
            t: 0.4,
            col: this.color,
            s: 3
          });
        }
      },
      slam: () => {
        this.vy = -300;
        this.specialEffects.slamming = true;
        SoundManager.beep(300, 0.2, 0.08);
        // Add slam charge effect
        for(let i = 0; i < 10; i++) {
          particles.push({
            x: this.x + this.w/2,
            y: this.y + this.h,
            vx: (Math.random() - 0.5) * 100,
            vy: Math.random() * -200,
            t: 0.6,
            col: '#fa4',
            s: 2
          });
        }
      },
      counter: () => {
        this.specialEffects.counter = 2.0; // counter window
        SoundManager.beep(700, 0.1, 0.05);
      },
      freeze: () => {
        const target = this.id === 1 ? p2 : p1;
        target.specialEffects.frozen = 2.0;
        SoundManager.beep(400, 0.3, 0.06);
      },
      berserker: () => {
        this.specialEffects.berserker = 5.0; // 5 seconds of enhanced stats
        SoundManager.beep(200, 0.4, 0.08);
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
        // Super dash with invincibility
        this.vx = this.facing * 1200;
        this.invulnerable = 1.0;
        this.specialEffects.ultimateDash = 1.0;
        SoundManager.beep(100, 0.6, 0.1);
        screenShake(12);
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
    
    // Animation states based on player movement and actions
    let animState = 'idle';
    if(Math.abs(this.vx) > 50) animState = 'walk';
    if(!this.onGround && this.vy < 0) animState = 'jump';
    if(!this.onGround && this.vy > 0) animState = 'fall';
    if(this.attackCooldown > 0.15) animState = 'attack';
    
    // invulnerable flash
    const flash = this.invulnerable>0 && Math.floor(performance.now()/80)%2===0;
    const baseColor = flash ? '#fff' : this.color;
    const accentColor = flash ? '#fff' : this.colorAccent;
    
    // Animation offsets for more dynamic look
    let bobOffset = 0;
    let squashStretch = {w: 0, h: 0};
    
    if(animState === 'walk') {
      bobOffset = Math.sin(this.anim.t * 20) * 2;
    } else if(animState === 'jump') {
      squashStretch = {w: -4, h: 8};
    } else if(animState === 'fall') {
      squashStretch = {w: 4, h: -4};
    } else if(animState === 'attack') {
      squashStretch = {w: 6, h: -2};
    }
    
    // Body with squash and stretch
    ctx.fillStyle = baseColor; 
    ctx.fillRect(px + squashStretch.w/2, py + 10 + bobOffset - squashStretch.h/2, 
                 this.w - squashStretch.w, this.h - 10 + squashStretch.h);
    
    // Head
    ctx.fillStyle = accentColor; 
    ctx.fillRect(px + 6, py + bobOffset, this.w - 12, 14);
    
    // Eye (blinks occasionally)
    const blink = Math.random() < 0.005 && this.anim.t % 3 < 0.1;
    if(!blink) {
      ctx.fillStyle = '#000'; 
      ctx.fillRect(px + (this.facing===1? this.w-14:8), py + 4 + bobOffset, 4, 4);
    }
    
    // Status effect overlays
    if(this.specialEffects.shield) {
      ctx.strokeStyle = 'rgba(100,200,255,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(px-5, py-5+bobOffset, this.w+10, this.h+10);
    }
    
    if(this.specialEffects.berserker) {
      ctx.fillStyle = 'rgba(255,100,100,0.3)';
      ctx.fillRect(px, py+bobOffset, this.w, this.h);
    }
    
    if(this.specialEffects.frozen) {
      ctx.fillStyle = 'rgba(150,200,255,0.4)';
      ctx.fillRect(px, py+bobOffset, this.w, this.h);
    }
    
    // damage tint with intensity scaling
    if(this.damage > 30) { 
      const intensity = Math.min(0.3, this.damage * 0.003);
      ctx.fillStyle = `rgba(255,0,0,${intensity})`; 
      ctx.fillRect(px, py+bobOffset, this.w, this.h); 
    }
    
    // Attack indicator
    if(animState === 'attack') {
      const range = (50 + Math.min(200, this.damage*0.5)) * this.stats.power;
      const hx = this.facing===1 ? px+this.w : px-range;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(hx, py+20+bobOffset, range, 30);
    }
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
const damageNumbers = []; // For floating damage numbers
let shake = {time:0,magnitude:0};

const p1 = new Player(1, stage.spawnPoints[0].x, stage.spawnPoints[0].y, {left:'KeyA',right:'KeyD',up:'KeyW',attack:'KeyF',special:'KeyG',ultimate:'KeyH'});
const p2 = new Player(2, stage.spawnPoints[1].x, stage.spawnPoints[1].y, {left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',attack:'KeyK',special:'KeyL',ultimate:'Semicolon'});
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
  for(let i=damageNumbers.length-1;i>=0;i--){ const dn=damageNumbers[i]; dn.t-=dt; dn.y+=dn.vy*dt; dn.vy+=200*dt; if(dn.t<=0) damageNumbers.splice(i,1); }
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
  
  stage.draw(); 
  p1.draw(); 
  p2.draw(); 
  
  // Draw projectiles with enhanced effects
  for(const pr of projectiles) pr.draw(); 
  
  // Draw hit effects
  for(const e of effects){ 
    if(e.type==='hit'){ 
      ctx.fillStyle=`rgba(255,255,255,${e.t/0.15})`; 
      const size = e.size || 1;
      ctx.fillRect(e.x, e.y, 30*size, 8*size);
    } else if(e.type==='lightning') {
      ctx.fillStyle=`rgba(255,255,0,${e.t/0.3})`;
      ctx.fillRect(e.x, 0, 8, H);
      // Lightning branches
      for(let i = 0; i < 3; i++) {
        const branchX = e.x + (Math.random() - 0.5) * 100;
        ctx.fillRect(branchX, 0, 4, H);
      }
    } else if(e.type==='screenFlash') {
      ctx.fillStyle=`rgba(255,255,255,${(e.t/0.1) * 0.3})`;
      ctx.fillRect(0, 0, W, H);
    } else if(e.type==='muzzleFlash') {
      ctx.fillStyle=`rgba(255,200,100,${e.t/0.1})`;
      const size = 20;
      ctx.fillRect(e.x - size/2, e.y - size/2, size, size);
    }
  }
  
  // particles
  for(const p of particles){ 
    ctx.fillStyle=p.col; 
    ctx.fillRect(p.x,p.y,Math.max(2,p.s),Math.max(2,p.s)); 
  }
  
  // Damage numbers
  ctx.font = 'bold 16px monospace';
  for(const dn of damageNumbers) {
    const alpha = Math.max(0, dn.t);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = 2;
    ctx.strokeText(dn.damage.toString(), dn.x-8, dn.y);
    ctx.fillText(dn.damage.toString(), dn.x-8, dn.y);
  }
  
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
  
  // draw small stock boxes with better styling
  for(let i=0;i<p1.stocks;i++){ 
    ctx.fillStyle = p1.color; 
    ctx.fillRect(16+i*16,52,14,14); 
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(16+i*16,52,14,14);
  }
  for(let i=0;i<p2.stocks;i++){ 
    ctx.fillStyle = p2.color; 
    ctx.fillRect(W-130+i*16,52,14,14); 
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(W-130+i*16,52,14,14);
  }
  
  // draw special cooldown bars with labels
  ctx.font = '12px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText('Special', 16, 85);
  ctx.fillText('Special', W-80, 85);
  
  if(p1.specialCooldown>0){ 
    const w = Math.max(0, Math.min(80, (p1.specialCooldown/0.8)*80)); 
    ctx.fillStyle='#333'; ctx.fillRect(16,88,80,10); 
    ctx.fillStyle='#ff6666'; ctx.fillRect(16,88,w,10); 
  } else { 
    ctx.fillStyle='#4a4'; ctx.fillRect(16,88,80,10); 
    ctx.fillStyle='#fff'; ctx.fillText('READY', 35, 96);
  }
  
  if(p2.specialCooldown>0){ 
    const w2 = Math.max(0, Math.min(80, (p2.specialCooldown/0.8)*80)); 
    ctx.fillStyle='#333'; ctx.fillRect(W-130,88,80,10); 
    ctx.fillStyle='#ff6666'; ctx.fillRect(W-130,88,w2,10); 
  } else { 
    ctx.fillStyle='#4a4'; ctx.fillRect(W-130,88,80,10); 
    ctx.fillStyle='#fff'; ctx.fillText('READY', W-115, 96);
  }
  
  // Draw ultimate meters with better styling
  const ultBarWidth = 100;
  const ultBarHeight = 14;
  
  ctx.fillText('Ultimate', 16, 115);
  ctx.fillText('Ultimate', W-90, 115);
  
  // Player 1 Ultimate Bar
  const ult1Width = (p1.ultimate / 100) * ultBarWidth;
  ctx.fillStyle = '#222'; ctx.fillRect(16, 118, ultBarWidth, ultBarHeight); // Background
  ctx.strokeStyle = '#444'; ctx.strokeRect(16, 118, ultBarWidth, ultBarHeight); // Border
  
  if(p1.ultimate >= 100) {
    // Pulsing effect when ready
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.01);
    ctx.fillStyle = `rgba(255,0,255,${pulse})`;
  } else {
    ctx.fillStyle = '#ffcc33';
  }
  ctx.fillRect(16, 118, ult1Width, ultBarHeight); // Charge
  
  if(p1.ultimate >= 100) {
    ctx.fillStyle = '#fff';
    ctx.fillText('READY!', 40, 129);
  }
  
  // Player 2 Ultimate Bar  
  const ult2Width = (p2.ultimate / 100) * ultBarWidth;
  ctx.fillStyle = '#222'; ctx.fillRect(W-130, 118, ultBarWidth, ultBarHeight); // Background
  ctx.strokeStyle = '#444'; ctx.strokeRect(W-130, 118, ultBarWidth, ultBarHeight); // Border
  
  if(p2.ultimate >= 100) {
    // Pulsing effect when ready
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.01);
    ctx.fillStyle = `rgba(255,0,255,${pulse})`;
  } else {
    ctx.fillStyle = '#33ccff';
  }
  ctx.fillRect(W-130, 118, ult2Width, ultBarHeight); // Charge
  
  if(p2.ultimate >= 100) {
    ctx.fillStyle = '#fff';
    ctx.fillText('READY!', W-105, 129);
  }
  
  // Status effect indicators
  let p1StatusY = 140;
  let p2StatusY = 140;
  
  ctx.font = '10px monospace';
  
  // Player 1 status effects
  if(p1.specialEffects.shield) {
    ctx.fillStyle = '#4af';
    ctx.fillText('🛡️ SHIELD', 16, p1StatusY);
    p1StatusY += 12;
  }
  if(p1.specialEffects.berserker) {
    ctx.fillStyle = '#f44';
    ctx.fillText('😤 BERSERKER', 16, p1StatusY);
    p1StatusY += 12;
  }
  if(p1.specialEffects.frozen) {
    ctx.fillStyle = '#4af';
    ctx.fillText('❄️ FROZEN', 16, p1StatusY);
  }
  
  // Player 2 status effects
  if(p2.specialEffects.shield) {
    ctx.fillStyle = '#4af';
    ctx.fillText('🛡️ SHIELD', W-130, p2StatusY);
    p2StatusY += 12;
  }
  if(p2.specialEffects.berserker) {
    ctx.fillStyle = '#f44';
    ctx.fillText('😤 BERSERKER', W-130, p2StatusY);
    p2StatusY += 12;
  }
  if(p2.specialEffects.frozen) {
    ctx.fillStyle = '#4af';
    ctx.fillText('❄️ FROZEN', W-130, p2StatusY);
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

