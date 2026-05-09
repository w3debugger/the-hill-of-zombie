// Pure data — no DOM, no canvas, no audio. Imported by both client and server.

export const TAU = Math.PI * 2;
export const HILL_R = 220;
export const HILL_CORE_R = 80;
export const ARENA_R = 1700;
export const HILL_DRAIN_DPS = 10;

export const PLAYER_COLORS = ['#5cc8ff', '#ff7d7d', '#9affb6', '#ffd96a'];

export const WEAPONS = {
  pistol:  { key:'pistol',  name:'PISTOL',  dmg:26, fireRate:260, spread:0.04, speed:14, range:930, magSize:Infinity, reloadMs:0,    ammoColor:'#ffd96a', tracerLen:18, shots:1, recoil:1.0, sound:'pistol', auto:false },
  shotgun: { key:'shotgun', name:'SHOTGUN', dmg:17, fireRate:680, spread:0.22, speed:13, range:570, magSize:8,        reloadMs:1100, ammoColor:'#ff8c4a', tracerLen:14, shots:8, recoil:6.0, sound:'shotgun', auto:false },
  smg:     { key:'smg',     name:'SMG',     dmg:13, fireRate:75,  spread:0.09, speed:16, range:780, magSize:45,       reloadMs:1300, ammoColor:'#5cc8ff', tracerLen:16, shots:1, recoil:0.5, sound:'smg', auto:true },
  rifle:   { key:'rifle',   name:'RIFLE',   dmg:95, fireRate:580, spread:0.004, speed:26, range:1800, magSize:8,      reloadMs:1600, ammoColor:'#9affb6', tracerLen:36, shots:1, recoil:9.0, pierce:3, sound:'rifle', auto:false },
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
  { kind: 'p', text: 'It came up through the soil.' },
  { kind: 'space' },
  { kind: 'p', text: 'Not a virus.' },
  { kind: 'p', text: 'Not a plague.' },
  { kind: 'p', text: 'Something older.' },
  { kind: 'p', text: 'Something that should have stayed buried.' },
  { kind: 'space' },
  { kind: 'p', text: 'By the second night, the towns were empty.' },
  { kind: 'p', text: 'By the third, the dead remembered how to walk.' },
  { kind: 'p', text: 'By the fourth, they remembered how to climb.' },
  { kind: 'space' },
  { kind: 'header', text: 'HILLTOP ECHO' },
  { kind: 'p', text: 'A radio mast. A bunker. A grave with a roof.' },
  { kind: 'p', text: 'Seven men built it to outlast the bomb.' },
  { kind: 'p', text: 'Six of them are still inside.' },
  { kind: 'p', text: 'None of them are breathing.' },
  { kind: 'space' },
  { kind: 'header', text: 'SGT. M. VANCE' },
  { kind: 'p', text: 'You bit yourself before they could.' },
  { kind: 'p', text: 'Most of you came back.' },
  { kind: 'p', text: 'Some of it didn’t.' },
  { kind: 'space' },
  { kind: 'p', text: 'The rifle remembers.' },
  { kind: 'p', text: 'The hands remember.' },
  { kind: 'p', text: 'The hunger — you keep on a leash.' },
  { kind: 'space' },
  { kind: 'p', text: 'They are coming up the slope.' },
  { kind: 'p', text: 'Hold the tower till sunrise.' },
  { kind: 'p', text: 'Or join them.' },
];

// Wave names + Reyes radio chatter, keyed by wave number / event.
// Each entry: { wave, when: 'start'|'mid'|'end', from, text, sub? }
export const RADIO_SCRIPT = {
  start: {
    1:  [{ from: 'REYES', text: 'Vance — Reyes. Movement on the south slope. Up the tower. Now.' }],
    2:  [{ from: 'REYES', text: 'Runners this time. They smell their own kin and they don’t care. Don’t let them flank.' }],
    3:  [{ from: 'REYES', text: 'Bigger pack inbound. That rifle’s the only thing keeping the hill quiet.' }],
    4:  [{ from: 'REYES', text: 'Heavies in the next group. Center of mass won’t drop them. Hit them hard.' }],
    5:  [{ from: 'REYES', text: 'Spitters in the treeline. They zero on standing targets — keep moving.' }],
    6:  [{ from: 'REYES', text: 'Tower’s still on the air. Convoy four pushed through because of you.' }],
    7:  [{ from: 'REYES', text: 'They’re stacking, Vance. The dead don’t coordinate. These ones do.' }],
    8:  [{ from: 'REYES', text: 'Three hours till sunrise. Don’t you dare go quiet on me.' }],
    9:  [{ from: 'REYES', text: 'This is the big push. Whatever you have left, spend it now.' }],
    10: [{ from: 'REYES', text: 'Final wave. Hold that tower till the sun’s up — light burns them off the slope.' }],
  },
  end: {
    1:  [{ from: 'REYES', text: 'Clean shot. Reload. There’s more.' }],
    3:  [{ from: 'REYES', text: 'Convoy two cleared the bridge. Your signal is keeping people alive.' }],
    5:  [{ from: 'REYES', text: 'Halfway to dawn. Stay sharp — the worst is coming.' }],
    7:  [{ from: 'REYES', text: 'Field hospital says you bought them four hours. That’s lives, Vance. Yours included.' }],
    9:  [{ from: 'REYES', text: 'One more, brother. Just one more.' }],
    10: [{ from: 'REYES', text: 'Sun’s up. Dead are pulling back. Hilltop Echo holds.' }],
  },
  // Triggered when hill HP first drops below thresholds
  hillLow: { from: 'REYES', text: 'Something’s on the tower roof. Knock it off before they crack a hatch.' },
  // Triggered when a player dies
  playerDown: { from: 'REYES', text: 'Vance is down on the tower! Anyone — anyone get to him?!' },
  // Final triumph (after wave 10 cleared)
  victory: [
    { from: 'REYES', text: 'All units — Hilltop Echo holds. Hilltop Echo holds!' },
    { from: 'REYES', text: 'Sun’s up, Sergeant. You bought us another day.' },
  ],
  // Game over
  defeat: [
    { from: 'REYES', text: 'Vance. Vance, talk to me. Vance!' },
    { from: 'REYES', text: 'Tower’s gone silent. They’ve taken the hill.' },
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
  10: 'DAYBREAK',
};

// Shop catalog. priceFn lets cost scale with upgrade level.
export const SHOP_ITEMS = [
  { id:'shotgun',     name:'SHOTGUN',      desc:'Wide spread, devastating up close.',  price:300, type:'weapon', key:'shotgun', startAmmo:40 },
  { id:'smg',         name:'SMG',          desc:'Full auto. Spray and pray.',          price:400, type:'weapon', key:'smg',     startAmmo:135 },
  { id:'rifle',       name:'RIFLE',        desc:'High damage, pierces multiple foes.', price:650, type:'weapon', key:'rifle',   startAmmo:24 },
  { id:'ammo_active', name:'AMMO REFILL',  desc:'Refill ammo for current weapon.',     price:80,  type:'ammo' },
  { id:'ammo_all',    name:'FULL AMMO',    desc:'Refill all owned weapons.',           price:220, type:'ammoAll' },
  { id:'health',      name:'MEDKIT',       desc:'Restore +60 HP immediately.',         price:100, type:'health' },
  { id:'maxhp',       name:'BODY ARMOR',   desc:'+25 max HP. Heal to full.',           type:'upgrade', key:'hp',    max:3, base:200, step:150 },
  { id:'speed',       name:'BOOTS',        desc:'+15% movement speed.',                type:'upgrade', key:'speed', max:3, base:240, step:160 },
  { id:'dmg',         name:'HOLLOW POINT', desc:'+20% bullet damage.',                 type:'upgrade', key:'dmg',   max:3, base:320, step:200 },
  { id:'repair',      name:'BARRICADES',   desc:'Reinforce the tower +700 HP.',         price:180, type:'repair' },
];

export function shopPrice(item, ownedLevel = 0) {
  if (item.type === 'upgrade') return item.base + ownedLevel * item.step;
  return item.price;
}
