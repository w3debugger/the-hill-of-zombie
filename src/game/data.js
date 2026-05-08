// Pure data — no DOM, no canvas, no audio. Imported by both client and server.

export const TAU = Math.PI * 2;
export const HILL_R = 220;
export const HILL_CORE_R = 80;
export const ARENA_R = 1700;
export const HILL_DRAIN_DPS = 14;

export const PLAYER_COLORS = ['#5cc8ff', '#ff7d7d', '#9affb6', '#ffd96a'];

export const WEAPONS = {
  pistol:  { key:'pistol',  name:'PISTOL',  dmg:26, fireRate:260, spread:0.04, speed:14, range:620, magSize:Infinity, reloadMs:0,    ammoColor:'#ffd96a', tracerLen:18, shots:1, recoil:1.0, sound:'pistol', auto:false },
  shotgun: { key:'shotgun', name:'SHOTGUN', dmg:17, fireRate:680, spread:0.22, speed:13, range:380, magSize:6,        reloadMs:1100, ammoColor:'#ff8c4a', tracerLen:14, shots:8, recoil:6.0, sound:'shotgun', auto:false },
  smg:     { key:'smg',     name:'SMG',     dmg:13, fireRate:75,  spread:0.09, speed:16, range:520, magSize:30,       reloadMs:1300, ammoColor:'#5cc8ff', tracerLen:16, shots:1, recoil:0.5, sound:'smg', auto:true },
  rifle:   { key:'rifle',   name:'RIFLE',   dmg:95, fireRate:580, spread:0.004, speed:26, range:1200, magSize:5,      reloadMs:1600, ammoColor:'#9affb6', tracerLen:36, shots:1, recoil:9.0, pierce:3, sound:'rifle', auto:false },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'smg', 'rifle'];

export const ZTYPES = {
  walker:  { hp:80,  speed:55,  dmg:9,  r:15, atkCd:600,  cash:5,  scoreMul:1,   push:0.6 },
  runner:  { hp:55,  speed:135, dmg:6,  r:13, atkCd:450,  cash:8,  scoreMul:1.5, push:0.5 },
  brute:   { hp:380, speed:36,  dmg:28, r:26, atkCd:900,  cash:50, scoreMul:6,   push:0.2, knockback:80 },
  spitter: { hp:65,  speed:78,  dmg:14, r:14, atkCd:1500, cash:14, scoreMul:2,   push:0.5, ranged:true, rangedSpeed:380, rangedRange:520 },
};

// ---------- Story ----------
// Intro crawl, shown once before the first match.
export const INTRO_TEXT = [
  { kind: 'header', text: 'YEAR 2031' },
  { kind: 'p', text: 'Six weeks ago the Veridian-7 strain breached containment at Fort Sebring.' },
  { kind: 'p', text: 'Within seventy-two hours the eastern seaboard went dark.' },
  { kind: 'p', text: 'The infected don’t shamble. They hunt. They organize. They listen.' },
  { kind: 'space' },
  { kind: 'header', text: 'HILLTOP ECHO' },
  { kind: 'p', text: 'A relay tower on a hill outside Black Ridge — the last working transmitter for sixty kilometers.' },
  { kind: 'p', text: 'For as long as it broadcasts, civilian convoys can navigate the dead zones to the coast.' },
  { kind: 'p', text: 'For as long as it broadcasts, the choppers know where to come.' },
  { kind: 'space' },
  { kind: 'header', text: 'YOU' },
  { kind: 'p', text: 'Sergeant Marcus Vance. Fourth Light Infantry. Last man on the hill.' },
  { kind: 'p', text: 'Captain Reyes is on the radio. Extraction is on the way.' },
  { kind: 'p', text: 'Hold until they arrive. That is the entire mission.' },
];

// Wave names + Reyes radio chatter, keyed by wave number / event.
// Each entry: { wave, when: 'start'|'mid'|'end', from, text, sub? }
export const RADIO_SCRIPT = {
  start: {
    1:  [{ from: 'REYES', text: 'Vance, Reyes. Movement on the south slope. Get to your position.' }],
    2:  [{ from: 'REYES', text: 'Runners this time. They smell us. Don’t let them flank.' }],
    3:  [{ from: 'REYES', text: 'Bigger pack inbound. Conserve rifle ammo if you have it.' }],
    4:  [{ from: 'REYES', text: 'Heavies in the next group. Center of mass won’t cut it. Hit them hard.' }],
    5:  [{ from: 'REYES', text: 'Spitters in the treeline. Keep moving — they zero on standing targets.' }],
    6:  [{ from: 'REYES', text: 'Hilltop, you’re holding. Convoy four made it through because of you.' }],
    7:  [{ from: 'REYES', text: 'They’re stacking, Vance. I’ve never seen them coordinate like this.' }],
    8:  [{ from: 'REYES', text: 'Choppers are spinning up. Twelve minutes. Don’t you dare go quiet on me.' }],
    9:  [{ from: 'REYES', text: 'This is the big push. Whatever you have left, spend it now.' }],
    10: [{ from: 'REYES', text: 'Final wave. Final wave! Hold the hill, soldier — birds are inbound!' }],
  },
  end: {
    1:  [{ from: 'REYES', text: 'Clean kill. Reload. There’s more.' }],
    3:  [{ from: 'REYES', text: 'Convoy two cleared the bridge. They owe you a beer.' }],
    5:  [{ from: 'REYES', text: 'You’re halfway. Stay sharp, the worst is coming.' }],
    7:  [{ from: 'REYES', text: 'Field hospital says you bought them four hours. That’s lives, Vance. That’s lives.' }],
    9:  [{ from: 'REYES', text: 'One more, brother. Just one more.' }],
    10: [{ from: 'REYES', text: 'Birds on the deck. We see you. Welcome home, Sergeant.' }],
  },
  // Triggered when hill HP first drops below thresholds
  hillLow: { from: 'REYES', text: 'Tower’s taking damage. Push them off it before we lose signal!' },
  // Triggered when a player dies
  playerDown: { from: 'REYES', text: 'Man down on the hill! Can anyone get to them?!' },
  // Final triumph (after wave 10 cleared)
  victory: [
    { from: 'REYES', text: 'All units — Hilltop Echo holds. Hilltop Echo holds!' },
    { from: 'PILOT', text: 'Sergeant. Get on the bird. You’re going home.' },
  ],
  // Game over
  defeat: [
    { from: 'REYES', text: 'Vance. Vance, talk to me. Vance!' },
    { from: 'PILOT', text: 'Tower’s gone dark. Aborting approach.' },
  ],
};

// Wave names (small flavor over the wave banner)
export const WAVE_NAMES = {
  1: 'CONTACT',
  2: 'FIRST BLOOD',
  3: 'GATHERING',
  4: 'HEAVY METAL',
  5: 'POISON RAIN',
  6: 'BREAKTHROUGH',
  7: 'NIGHTFALL',
  8: 'THE TIDE',
  9: 'LAST STAND',
  10: 'EXFIL',
};

// Shop catalog. priceFn lets cost scale with upgrade level.
export const SHOP_ITEMS = [
  { id:'shotgun',     name:'SHOTGUN',      desc:'Wide spread, devastating up close.',  price:300, type:'weapon', key:'shotgun', startAmmo:24 },
  { id:'smg',         name:'SMG',          desc:'Full auto. Spray and pray.',          price:400, type:'weapon', key:'smg',     startAmmo:90 },
  { id:'rifle',       name:'RIFLE',        desc:'High damage, pierces multiple foes.', price:650, type:'weapon', key:'rifle',   startAmmo:15 },
  { id:'ammo_active', name:'AMMO REFILL',  desc:'Refill ammo for current weapon.',     price:80,  type:'ammo' },
  { id:'ammo_all',    name:'FULL AMMO',    desc:'Refill all owned weapons.',           price:220, type:'ammoAll' },
  { id:'health',      name:'MEDKIT',       desc:'Restore +60 HP immediately.',         price:100, type:'health' },
  { id:'maxhp',       name:'BODY ARMOR',   desc:'+25 max HP. Heal to full.',           type:'upgrade', key:'hp',    max:3, base:200, step:150 },
  { id:'speed',       name:'BOOTS',        desc:'+15% movement speed.',                type:'upgrade', key:'speed', max:3, base:240, step:160 },
  { id:'dmg',         name:'HOLLOW POINT', desc:'+20% bullet damage.',                 type:'upgrade', key:'dmg',   max:3, base:320, step:200 },
  { id:'repair',      name:'BARRICADES',   desc:'Repair the hill +400 HP.',            price:180, type:'repair' },
];

export function shopPrice(item, ownedLevel = 0) {
  if (item.type === 'upgrade') return item.base + ownedLevel * item.step;
  return item.price;
}
