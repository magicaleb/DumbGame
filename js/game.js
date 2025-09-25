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
    this.ultimateType = id===1 ? 'meteor' : 'blitz'; // Default ultimates
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
  
  // Handle special ultimate effects
  if(this.specialEffects.timeBoost) {
    speedMod *= 2.0; // Double speed during time freeze
  }

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
    
    // attack with directional support
    if(attack && this.attackCooldown<=0 && this.hitstun <= 0){ 
      this.attackCooldown = 0.25 / this.stats.speed; // Speed affects attack speed
      
      // Determine attack direction based on input
      let attackDir = 'horizontal';
      if(input.isDown(this.controls.up)) attackDir = 'up';
      else if(input.isDown(this.controls.down)) attackDir = 'down';
      
      this.doAttack(other, attackDir); 
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
    
    // Handle other ultimate effects that need continuous updates
    if(this.specialEffects.lightningBlitz) {
      // Damage anything we touch during blitz
      if(Math.abs(this.x - other.x) < 60 && Math.abs(this.y - other.y) < 60) {
        if(Math.random() < 0.1) { // 10% chance per frame
          other.hurt(3, {x: this.facing*200, y: -150});
          particlesHit(other.x+other.w/2, other.y+other.h/2);
        }
      }
    }
    
    if(this.specialEffects.gravityWell) {
      // Pull opponent towards gravity well
      const dx = this.gravityWellX - other.x;
      const dy = this.gravityWellY - other.y;
      const dist = Math.hypot(dx, dy);
      if(dist < 200) {
        const force = (200 - dist) * 5;
        other.vx += (dx / dist) * force * dt;
        other.vy += (dy / dist) * force * dt;
      }
    }
    
    // Ultimate charging - charge from dealing/taking damage and combat activity
    if(this.ultimate < 100) {
      this.ultimate += dt * 8; // Passive charge
      this.ultimate = Math.min(100, this.ultimate);
    }    // re-enable grabbing after some frames
    if(!this.canGrab){ this.canGrab = true; }

    // animation timer
    this.anim.t += dt; if(this.anim.t > 0.12){ this.anim.t = 0; this.anim.frame = (this.anim.frame+1)%4; }
  }

  doAttack(other, direction = 'horizontal'){
    // Enhanced attack with stat scaling and directional support
    const range = (50 + Math.min(200, this.damage*0.5)) * this.stats.power;
    let hx, hy, hw, hh;
    
    // Set hitbox based on attack direction
    if(direction === 'up') {
      hx = this.x + 5; hy = this.y - 50; hw = this.w - 10; hh = 60;
    } else if(direction === 'down') {
      hx = this.x + 5; hy = this.y + this.h - 10; hw = this.w - 10; hh = 60;
    } else { // horizontal
      hx = this.facing===1 ? this.x+this.w : this.x-range;
      hy = this.y + 20; hw = range; hh = 30;
    }
    
    SoundManager.sfxAttack();
    
    // Check for special dash attack
    const isDashAttack = !!this.specialEffects.dashAttack;
    
    // draw hit effect
    effects.push({type:'hit',x:hx,y:hy,t:0.15,size:isDashAttack?2:1,direction:direction});
    
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
      
      const baseDmg = isDashAttack ? 10 : 8;
      const dmg = baseDmg * this.stats.power * (this.specialEffects.berserker ? 1.4 : 1);
      const knockFactor = (12 + other.damage*0.12) * this.stats.power;
      const defenseReduction = 1 / other.stats.defense;
      
      // Directional knockback
      let kx, ky;
      if(direction === 'up') {
        kx = this.facing * knockFactor * 15 * defenseReduction;
        ky = -600 * defenseReduction * (1 + other.damage*0.015); // Strong upward
      } else if(direction === 'down') {
        kx = this.facing * knockFactor * 10 * defenseReduction;
        ky = 300 * defenseReduction; // Downward spike
      } else { // horizontal
        kx = this.facing*knockFactor*25*defenseReduction*(1 + other.damage*0.008);
        ky = -420*defenseReduction*(1 + other.damage*0.012);
      }
      
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
      // Top 5 abilities available to both players
      fireball: () => {
        const speed = 500 * this.stats.power;
        projectiles.push(new Projectile(this.x+this.w/2, this.y+30, this.facing*speed, -20, this.id, 'fireball'));
        SoundManager.sfxPower();
      },
      dash: () => {
        this.vx += this.facing * 800 * this.stats.speed;
        this.specialEffects.dashAttack = 0.5; // damage on contact for 0.5s
        SoundManager.sfxAttack();
      },
      teleport: () => {
        const target = this.id === 1 ? p2 : p1;
        const behindX = target.x + (target.facing * -60);
        this.x = Math.max(0, Math.min(W-this.w, behindX));
        this.y = target.y;
        particlesJump(this.x+this.w/2, this.y+this.h);
        SoundManager.beep(800, 0.15, 0.06);
      },
      shield: () => {
        this.specialEffects.shield = 3.0; // 3 second shield
        SoundManager.beep(600, 0.2, 0.06);
      },
      lightning: () => {
        // Enhanced lightning - instant hit across screen with visual effects
        const target = this.id === 1 ? p2 : p1;
        if(Math.abs(target.x - this.x) < W) {
          target.hurt(12 * this.stats.power, {x: this.facing*300, y: -200});
          effects.push({type:'lightning', x: this.x, y: this.y, t: 0.3});
          // Create lightning bolt effect
          for(let i = 0; i < 8; i++){
            particles.push({
              x: this.x + (target.x - this.x) * (i/8) + (Math.random()*40-20), 
              y: this.y + (target.y - this.y) * (i/8) + (Math.random()*40-20), 
              vx: 0, vy: 0, t: 0.2, col: '#ffff00', s: 4
            });
          }
          SoundManager.beep(1200, 0.1, 0.08);
          screenShake(8);
        }
      }
    };
    
    if(specials[this.specialType]) {
      specials[this.specialType].call(this);
    }
  }
  
  doUltimate(){
    const ultimates = {
      // 1. Meteor Storm - Rains meteors from the sky
      meteor: () => {
        for(let i = 0; i < 8; i++){
          setTimeout(() => {
            const x = Math.random() * W;
            const vy = 600 + Math.random() * 300;
            projectiles.push(new Projectile(x, -50, Math.random()*200-100, vy, this.id, 'ultimate'));
          }, i * 300);
        }
        SoundManager.beep(120, 1.2, 0.15);
        screenShake(20);
      },
      
      // 2. Time Freeze - Freezes opponent and creates combo opportunity  
      chronos: () => {
        const target = this.id === 1 ? p2 : p1;
        target.specialEffects.frozen = 4.0;
        this.specialEffects.timeBoost = 4.0; // Enhanced speed while target frozen
        
        // Visual effect
        for(let i = 0; i < 20; i++){
          particles.push({
            x: target.x + Math.random()*60-30, 
            y: target.y + Math.random()*80-40, 
            vx: 0, vy: 0, t: 2.0, col: '#00ffff', s: 3
          });
        }
        SoundManager.beep(800, 0.3, 0.1);
        screenShake(8);
      },
      
      // 3. Shadow Clone - Creates temporary fighting clone
      shadow: () => {
        this.specialEffects.shadowClone = 6.0;
        this.shadowCloneX = this.x + (this.facing * -80);
        this.shadowCloneY = this.y;
        
        SoundManager.beep(400, 0.4, 0.1);
        screenShake(10);
      },
      
      // 4. Lightning Blitz - Super speed dash with multiple hits
      blitz: () => {
        this.specialEffects.lightningBlitz = 2.0;
        this.invulnerable = 2.0;
        this.vx = this.facing * 1500;
        
        // Create lightning trail
        for(let i = 0; i < 15; i++){
          setTimeout(() => {
            particles.push({
              x: this.x + Math.random()*40-20, 
              y: this.y + Math.random()*60-30, 
              vx: -this.vx * 0.3, vy: Math.random()*200-100, 
              t: 0.5, col: '#ffff00', s: 2
            });
          }, i * 50);
        }
        
        SoundManager.beep(1000, 0.8, 0.12);
        screenShake(15);
      },
      
      // 5. Gravity Well - Creates a black hole that pulls opponent in
      gravity: () => {
        this.specialEffects.gravityWell = 5.0;
        this.gravityWellX = this.x + this.facing * 150;
        this.gravityWellY = this.y;
        
        SoundManager.beep(80, 1.0, 0.15);
        screenShake(12);
      }
    };
    
    if(ultimates[this.ultimateType]) {
      ultimates[this.ultimateType].call(this);
      this.ultimate = 0; // reset charge
    }
  }

  loseStock(){ this.stocks -= 1; SoundManager.sfxKO(); this.alive=false; if(this.stocks>0){ this.respawnTimer = 2.0; } }
  respawn(){ if(this.stocks<=0){ /* out */ } else { const s = stage.spawnPoints[this.id-1]; this.x=s.x; this.y=s.y; this.vx=0; this.vy=0; this.alive=true; } }

  draw(){ if(!this.alive) return;
    const px = Math.round(this.x); const py = Math.round(this.y);
    // invulnerable flash
    const flash = this.invulnerable>0 && Math.floor(performance.now()/80)%2===0;
    
    // Draw shadow clone first (behind player)
    if(this.specialEffects.shadowClone) {
      const shadowX = Math.round(this.shadowCloneX);
      const shadowY = Math.round(this.shadowCloneY);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#444'; ctx.fillRect(shadowX,shadowY+10,this.w, this.h-10);
      ctx.fillStyle = '#222'; ctx.fillRect(shadowX+6,shadowY, this.w-12, 14);
      ctx.fillStyle = '#000'; ctx.fillRect(shadowX + (this.facing===1? this.w-14:8), shadowY+4, 4,4);
      ctx.globalAlpha = 1.0;
    }
    
    // body
    ctx.fillStyle = flash ? '#fff' : this.color; ctx.fillRect(px,py+10,this.w, this.h-10);
    // head
    ctx.fillStyle = flash ? '#fff' : this.colorAccent; ctx.fillRect(px+6,py, this.w-12, 14);
    // eye
    ctx.fillStyle = '#000'; ctx.fillRect(px + (this.facing===1? this.w-14:8), py+4, 4,4);
    // damage tint
    if(this.damage>30){ ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(px,py,this.w,this.h); }
    
    // Draw gravity well effect
    if(this.specialEffects.gravityWell) {
      const wellX = Math.round(this.gravityWellX);
      const wellY = Math.round(this.gravityWellY);
      const time = performance.now() * 0.01;
      
      // Pulsing black hole effect
      for(let i = 0; i < 3; i++) {
        const radius = 20 + i * 8 + Math.sin(time + i) * 5;
        ctx.beginPath();
        ctx.arc(wellX, wellY, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,0,0,${0.8 - i * 0.2})`;
        ctx.fill();
      }
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
  
  const p1UltimateEl = document.querySelector('input[name="p1-ultimate"]:checked');
  if(p1UltimateEl) p1.ultimateType = p1UltimateEl.value;
  
  p1.stats.speed = parseFloat(document.getElementById('p1-speed').value);
  p1.stats.power = parseFloat(document.getElementById('p1-power').value);
  p1.stats.defense = parseFloat(document.getElementById('p1-defense').value);
  
  // Apply Player 2 settings
  const p2SpecialEl = document.querySelector('input[name="p2-special"]:checked');
  if(p2SpecialEl) p2.specialType = p2SpecialEl.value;
  
  const p2UltimateEl = document.querySelector('input[name="p2-ultimate"]:checked');
  if(p2UltimateEl) p2.ultimateType = p2UltimateEl.value;
  
  p2.stats.speed = parseFloat(document.getElementById('p2-speed').value);
  p2.stats.power = parseFloat(document.getElementById('p2-power').value);
  p2.stats.defense = parseFloat(document.getElementById('p2-defense').value);
  
  console.log('Character customization applied:', {
    p1: {special: p1.specialType, ultimate: p1.ultimateType, stats: p1.stats},
    p2: {special: p2.specialType, ultimate: p2.ultimateType, stats: p2.stats}
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

