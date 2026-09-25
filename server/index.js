import { WebSocketServer } from 'ws';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';

const PORT = process.env.PORT || 8765;
const TICK_RATE = 30;
// 진짜 오픈월드처럼 — 지역 하나하나와 지역 사이 거리를 전부 2배로 키움
const WORLD_SCALE = 2;
const OVERWORLD = { w: 4800 * WORLD_SCALE, h: 4800 * WORLD_SCALE, wallThickness: 24 };
const RAID_WORLD = { w: 1400, h: 1000, wallThickness: 24 };
const PLAYER_R = 14;
const MONSTER_R = 12;
const SPEED = 340; // 맵이 커진 만큼 기본 이동속도도 올림(220 → 340)
const MOVE_ACCEL = 1000;
const MOVE_DECEL = 1500;

const ATTACK_COOLDOWN_MS = 450;
const ATTACK_REACH = 50;
const ATTACK_HALF_ANGLE = 1.05; // radians, ~60 deg either side of facing

const MONSTER_KNOCKBACK = 34;
const MONSTER_STUN_MS = 260;
const PLAYER_KNOCKBACK = 24;
const PLAYER_STUN_MS = 180;

const MONSTER_ATTACK_COOLDOWN_MS = 900;
const RESPAWN_DELAY_MS = 6000;
const MAX_RAID_PLAYERS = 4;

// ── 직업(클래스) ─────────────────────────────────────────
const PROJECTILE_SPEED = 480;
const PROJECTILE_LIFE_MS = 900;
const DASH_DISTANCE = 150;
const CLASS_DEFS = {
  warrior: { name: '용사', attackType: 'melee', maxHp: 36, atk: 7 },
  archer: { name: '궁수', attackType: 'ranged', maxHp: 26, atk: 6 },
  healer: { name: '힐러', attackType: 'ranged', maxHp: 24, atk: 4 },
};
let nextProjectileId = 1;
const RECLASS_COST = 3000;

// ── 스킬 상점 — 직업별 기본(무료) 스킬 1개 + 구매 가능 스킬 2개, 최대 2개까지 장착 ──
const SKILL_DEFS = {
  dash: { name: '대시', classKey: 'warrior', price: 0, cooldownMs: 4000, desc: '바라보는 방향으로 순간 돌진' },
  whirlwind: { name: '회전 베기', classKey: 'warrior', price: 200, cooldownMs: 6000, desc: '주변 적 전체에게 피해' },
  guard: { name: '방어 태세', classKey: 'warrior', price: 250, cooldownMs: 10000, desc: '3초간 받는 피해 절반으로 감소' },

  selfHeal: { name: '자가 치유', classKey: 'archer', price: 0, cooldownMs: 8000, healAmount: 15, desc: '자신의 체력 회복' },
  multiShot: { name: '멀티샷', classKey: 'archer', price: 200, cooldownMs: 5000, desc: '부채꼴로 화살 3발 발사' },
  piercingShot: { name: '관통샷', classKey: 'archer', price: 250, cooldownMs: 7000, desc: '적을 관통하는 강력한 화살' },

  healPulse: { name: '치유의 파동', classKey: 'healer', price: 0, cooldownMs: 9000, healAmount: 12, healRadius: 150, desc: '자신 포함 주변 아군 체력 회복' },
  barrier: { name: '보호막', classKey: 'healer', price: 250, cooldownMs: 12000, desc: '3초간 받는 피해 절반으로 감소' },
  slowField: { name: '저주의 파동', classKey: 'healer', price: 200, cooldownMs: 8000, desc: '주변 몬스터 이동속도 감소' },

  // 특정 닉네임 전용 특수 스킬 — 상점에서 구매 불가, 로그인 시 자동 지급(spawnPlayerForUser)
  curse523: { name: '523의 저주', classKey: null, price: 0, cooldownMs: 15000, desc: '주변 모든 적에게 저주를 내려 강력한 피해를 입힌다', special: true },
};
const SPECIAL_SKILL_NICKNAME = '마이콜작손';
const SPECIAL_SKILL_KEY = 'curse523';
// 클래스(재)선택 시 ownedSkills/equippedSkills가 통째로 초기화되므로 그 이후 항상 다시 호출해 보장한다
function grantSpecialSkill(user) {
  if (user.nickname !== SPECIAL_SKILL_NICKNAME) return false;
  if (!user.ownedSkills.includes(SPECIAL_SKILL_KEY)) user.ownedSkills.push(SPECIAL_SKILL_KEY);
  if (!user.equippedSkills.includes(SPECIAL_SKILL_KEY)) {
    if (user.equippedSkills[0] == null) user.equippedSkills[0] = SPECIAL_SKILL_KEY;
    else if (user.equippedSkills[1] == null) user.equippedSkills[1] = SPECIAL_SKILL_KEY;
  }
  return true;
}
function starterSkillFor(classKey) {
  return Object.keys(SKILL_DEFS).find(k => SKILL_DEFS[k].classKey === classKey && SKILL_DEFS[k].price === 0);
}

// 레벨업 시 얻는 스텟 포인트로 찍는 능력치 — 계정(유저)당 영구 저장
const STAT_INCREMENTS = { hp: 5, speed: 8, dmg: 1, magic: 1 };

// ── 계정(회원가입/로그인) — Supabase(있으면) 또는 users.json에 영구 저장, 비밀번호는 salt+scrypt 해시로만 보관 ──
let users = await db.loadUsers();
// 서버 재시작/비정상 종료 시 이전 세션의 online 플래그가 그대로 남아 재접속이 막히는 것을 방지
for (const u of users.values()) u.online = false;
function saveUsers() {
  db.saveUsers(users);
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeNewUser(username, password, nickname) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    username, salt, passwordHash: hashPassword(password, salt), nickname,
    createdAt: Date.now(), online: false,
    classKey: null, hasChosenClass: false,
    level: 1, exp: 0, gold: 50, statPoints: 0, stats: { hp: 0, speed: 0, dmg: 0, magic: 0 },
    weapon: makeStarterWeapon(), inventory: [],
    ownedSkills: [], equippedSkills: [null, null],
    guildId: null, hasMap: false, hasSeenTutorial: false,
  };
}

// ── 길드 — 이름과 가입 방식(공개/승인제)은 생성 후 변경 불가 ──
let guilds = await db.loadGuilds();
function saveGuilds() {
  db.saveGuilds(guilds);
}
function publicGuild(g) {
  return { id: g.id, name: g.name, approvalRequired: g.approvalRequired, memberCount: g.members.length, ownerUsername: g.ownerUsername, ownerNickname: users.get(g.ownerUsername)?.nickname || g.ownerUsername };
}
function applyGuildTag(player) {
  const guild = player.user.guildId ? guilds.get(player.user.guildId) : null;
  player.guildTag = guild ? guild.name : null;
}

// ── 거래장터 — 판매자가 오프라인이어도 등록/구매는 그대로 유지됨 ──
let marketListings = await db.loadMarket();
let nextMarketId = 1 + [...marketListings.keys()].reduce((max, k) => Math.max(max, parseInt(k.slice(2), 10) || 0), 0);
function saveMarket() {
  db.saveMarket(marketListings);
}
function grantMarketItem(player, listing) {
  if (listing.kind === 'material') {
    const existing = player.inventory.find(i => i.kind === 'material' && i.key === listing.key);
    if (existing) existing.qty += listing.qty;
    else player.inventory.push({ id: 'm' + (nextItemId++), kind: 'material', key: listing.key, name: listing.name, price: listing.priceHint || 1, qty: listing.qty });
  } else if (listing.kind === 'potion') {
    const existing = player.inventory.find(i => i.kind === 'potion' && i.key === listing.key);
    if (existing) existing.qty += listing.qty;
    else player.inventory.push({ id: 'p' + (nextItemId++), kind: 'potion', key: listing.key, name: listing.name, heal: listing.heal, qty: listing.qty });
  } else if (listing.kind === 'weapon') {
    player.inventory.push({ id: 'w' + (nextItemId++), kind: 'weapon', key: listing.key, name: listing.name, atkBonus: listing.atkBonus, durability: listing.durability, maxDurability: listing.maxDurability, element: listing.element, enhanceLevel: listing.enhanceLevel });
  }
}
function sendMarketData(player) {
  const listings = [...marketListings.values()]
    .map(l => ({ id: l.id, sellerNickname: l.sellerNickname, kind: l.kind, key: l.key, name: l.name, qty: l.qty, price: l.price, mine: l.sellerUsername === player.username, listedAt: l.listedAt }))
    .sort((a, b) => (b.mine - a.mine) || (b.listedAt - a.listedAt));
  sendTo(player, { type: 'market_data', listings, gold: player.gold });
}

// 직업 기본 스탯 + 유저가 찍은 스텟 포인트를 합쳐서 실제 전투 스탯을 다시 계산
function recomputeDerivedStats(player) {
  const user = player.user;
  const def = user.hasChosenClass ? (CLASS_DEFS[user.classKey] || CLASS_DEFS.warrior) : { maxHp: 30, atk: 6 };
  const newMaxHp = def.maxHp + user.stats.hp * STAT_INCREMENTS.hp;
  player.maxHp = newMaxHp;
  player.hp = Math.min(player.hp, newMaxHp);
  player.atk = def.atk + user.stats.dmg * STAT_INCREMENTS.dmg;
  player.moveSpeed = SPEED + user.stats.speed * STAT_INCREMENTS.speed;
  player.magic = user.stats.magic * STAT_INCREMENTS.magic;
}

// ── 레벨업 ──────────────────────────────────────────────
function requiredExp(level) { return 20 + (level - 1) * 15; }

function applyLevelUps(player) {
  const startLevel = player.level;
  let required = requiredExp(player.level);
  while (player.exp >= required) {
    player.exp -= required;
    player.level++;
    player.user.statPoints = (player.user.statPoints || 0) + 1;
    required = requiredExp(player.level);
  }
  if (player.level > startLevel) {
    player.user.level = player.level;
    recomputeDerivedStats(player);
    player.hp = player.maxHp;
    saveUsers();
    sendTo(player, {
      type: 'level_up', level: player.level, maxHp: player.maxHp, atk: Math.round(player.atk * 10) / 10, hp: player.hp,
      statPoints: player.user.statPoints,
    });
  }
  player.user.exp = player.exp;
}

// ── 몬스터 / 보스 타입 ──────────────────────────────────
const MONSTER_TYPES = {
  slime: { name: '슬라임', hp: 18, atk: 3, exp: 10, chaseSpeed: 70, wanderSpeed: 40, aggroRange: 140, deaggroRange: 220, r: MONSTER_R },
  mushroom: { name: '버섯', hp: 14, atk: 4, exp: 12, chaseSpeed: 65, wanderSpeed: 35, aggroRange: 130, deaggroRange: 210, r: MONSTER_R },
  wolf: { name: '들개', hp: 30, atk: 6, exp: 25, chaseSpeed: 90, wanderSpeed: 50, aggroRange: 180, deaggroRange: 260, r: MONSTER_R },
  frog: { name: '개구리', hp: 20, atk: 4, exp: 14, chaseSpeed: 60, wanderSpeed: 45, aggroRange: 140, deaggroRange: 220, r: MONSTER_R },
  scorpion: { name: '전갈', hp: 25, atk: 5, exp: 16, chaseSpeed: 80, wanderSpeed: 40, aggroRange: 160, deaggroRange: 240, r: MONSTER_R },
  bat: { name: '박쥐', hp: 12, atk: 3, exp: 11, chaseSpeed: 100, wanderSpeed: 60, aggroRange: 150, deaggroRange: 230, r: MONSTER_R },
  golem: { name: '골렘', hp: 40, atk: 7, exp: 30, chaseSpeed: 45, wanderSpeed: 25, aggroRange: 130, deaggroRange: 200, r: MONSTER_R + 2 },
};

// ── 필드마다 하나씩 상주하는 정예 몬스터 — 잡몹보다 훨씬 세지만 레이드처럼 인스턴싱하지 않고 필드에 그대로 돌아다님 ──
const ELITE_TYPES = {
  slimeChief: { name: '점액 대장', baseKind: 'slime', hp: 95, atk: 9, exp: 55, chaseSpeed: 75, wanderSpeed: 40, aggroRange: 170, deaggroRange: 260, r: MONSTER_R + 4 },
  wolfAlpha: { name: '외눈 들개 우두머리', baseKind: 'wolf', hp: 120, atk: 11, exp: 65, chaseSpeed: 105, wanderSpeed: 55, aggroRange: 200, deaggroRange: 300, r: MONSTER_R + 4 },
  bogQueen: { name: '늪지 여왕개구리', baseKind: 'frog', hp: 105, atk: 9, exp: 60, chaseSpeed: 70, wanderSpeed: 45, aggroRange: 170, deaggroRange: 260, r: MONSTER_R + 4 },
  sandstalker: { name: '쌍갈래 전갈', baseKind: 'scorpion', hp: 125, atk: 11, exp: 65, chaseSpeed: 95, wanderSpeed: 45, aggroRange: 190, deaggroRange: 280, r: MONSTER_R + 4 },
  frostReaver: { name: '서리 박쥐 떼대장', baseKind: 'bat', hp: 110, atk: 10, exp: 62, chaseSpeed: 120, wanderSpeed: 65, aggroRange: 180, deaggroRange: 270, r: MONSTER_R + 4 },
  duneWarden: { name: '사막 골렘 수문장', baseKind: 'golem', hp: 160, atk: 13, exp: 80, chaseSpeed: 50, wanderSpeed: 28, aggroRange: 160, deaggroRange: 240, r: MONSTER_R + 6 },
  ruinSentinel: { name: '폐허의 파수병', baseKind: 'golem', hp: 160, atk: 13, exp: 80, chaseSpeed: 50, wanderSpeed: 28, aggroRange: 160, deaggroRange: 240, r: MONSTER_R + 6 },
};
const ELITE_RESPAWN_DELAY_MS = 60000;

// pattern: 'nova'(제자리 예열 후 광역 파동) | 'dash'(조준 예열 후 직선 돌진)
const BOSS_TYPES = {
  iceSlimeKing: {
    name: '얼음 슬라임 킹', hp: 220, atk: 8, exp: 100, chaseSpeed: 55, aggroRange: 999, deaggroRange: 999999, r: 22,
    weakness: 'fire', pattern: 'nova',
    novaIntervalMs: 5000, novaTelegraphMs: 900, novaRadius: 100, novaDamage: 14, novaSlowMs: 2500,
  },
  flameAlphaWolf: {
    name: '불꽃 들개 대장', hp: 260, atk: 9, exp: 120, chaseSpeed: 100, aggroRange: 999, deaggroRange: 999999, r: 20,
    weakness: 'ice', pattern: 'dash',
    dashIntervalMs: 4500, dashTelegraphMs: 600, dashDurationMs: 350, dashSpeed: 500, dashDamage: 16, recoverMs: 800,
  },
  swampFrogKing: {
    name: '독늪 개구리왕', hp: 200, atk: 7, exp: 90, chaseSpeed: 55, aggroRange: 999, deaggroRange: 999999, r: 22,
    weakness: 'fire', pattern: 'nova',
    novaIntervalMs: 4800, novaTelegraphMs: 900, novaRadius: 100, novaDamage: 13, novaSlowMs: 2500,
  },
  canyonScorpionKing: {
    name: '모래폭풍 전갈왕', hp: 240, atk: 8, exp: 105, chaseSpeed: 100, aggroRange: 999, deaggroRange: 999999, r: 21,
    weakness: 'ice', pattern: 'dash',
    dashIntervalMs: 4200, dashTelegraphMs: 550, dashDurationMs: 350, dashSpeed: 520, dashDamage: 15, recoverMs: 800,
  },
  frostBatLord: {
    name: '서리 박쥐 군주', hp: 210, atk: 7, exp: 95, chaseSpeed: 110, aggroRange: 999, deaggroRange: 999999, r: 20,
    weakness: 'fire', pattern: 'dash',
    dashIntervalMs: 4000, dashTelegraphMs: 500, dashDurationMs: 320, dashSpeed: 560, dashDamage: 14, recoverMs: 750,
  },
  magmaGolem: {
    name: '용암 골렘', hp: 280, atk: 9, exp: 115, chaseSpeed: 45, aggroRange: 999, deaggroRange: 999999, r: 24,
    weakness: 'ice', pattern: 'nova',
    novaIntervalMs: 5200, novaTelegraphMs: 950, novaRadius: 110, novaDamage: 15, novaSlowMs: 2500,
  },
  ruinGuardian: {
    name: '폐허의 수호자', hp: 260, atk: 8, exp: 110, chaseSpeed: 50, aggroRange: 999, deaggroRange: 999999, r: 23,
    weakness: 'fire', pattern: 'nova',
    novaIntervalMs: 5000, novaTelegraphMs: 900, novaRadius: 105, novaDamage: 14, novaSlowMs: 2500,
  },
};

// 몬스터를 잡으면 얻는 "신체 일부" — 상점에서 팔아서 골드로 바꿈
const MATERIAL_INFO = {
  slime: { name: '슬라임 젤리', price: 4 },
  mushroom: { name: '버섯 포자', price: 5 },
  wolf: { name: '들개 가죽', price: 8 },
  frog: { name: '개구리 다리', price: 5 },
  scorpion: { name: '전갈 독침', price: 6 },
  bat: { name: '박쥐 날개', price: 5 },
  golem: { name: '골렘 파편', price: 12 },
  iceSlimeKing: { name: '얼음 결정', price: 60 },
  flameAlphaWolf: { name: '불꽃 어금니', price: 70 },
  swampFrogKing: { name: '독늪의 정수', price: 55 },
  canyonScorpionKing: { name: '전갈왕의 집게', price: 65 },
  frostBatLord: { name: '서리 날개막', price: 58 },
  magmaGolem: { name: '용암의 핵', price: 75 },
  ruinGuardian: { name: '고대의 파편', price: 68 },
  slimeChief: { name: '점액 핵', price: 28 },
  wolfAlpha: { name: '우두머리의 송곳니', price: 32 },
  bogQueen: { name: '여왕개구리의 왕관', price: 30 },
  sandstalker: { name: '갈라진 독침', price: 32 },
  frostReaver: { name: '떼대장의 발톱', price: 31 },
  duneWarden: { name: '수문장의 코어', price: 40 },
  ruinSentinel: { name: '파수병의 문장', price: 40 },
};

// ── 오픈월드 지역 정의 — 4800×4800을 3×3 칸(칸당 1600)으로 나눠 빈 공간 없이 채움 ──
function S(n) { return n * WORLD_SCALE; }
const CAPITAL_BOX = { xMin: S(1800), xMax: S(3000), yMin: S(1800), yMax: S(3000) };       // 중앙 — 진짜 도시처럼 넓게
const SECOND_CITY_BOX = { xMin: S(200), xMax: S(1400), yMin: S(3400), yMax: S(4600) };    // 남서쪽 칸
const FIELD1_BOX = { xMin: S(1700), xMax: S(3100), yMin: S(100), yMax: S(1500) };        // 북쪽 칸
const FIELD2_BOX = { xMin: S(3300), xMax: S(4700), yMin: S(1700), yMax: S(3100) };       // 동쪽 칸
const FIELD3_BOX = { xMin: S(1700), xMax: S(3100), yMin: S(3300), yMax: S(4700) };       // 남쪽 칸
const FIELD4_BOX = { xMin: S(100), xMax: S(1500), yMin: S(1700), yMax: S(3100) };        // 서쪽 칸
const FIELD5_BOX = { xMin: S(100), xMax: S(1500), yMin: S(100), yMax: S(1500) };         // 북서쪽 칸
const FIELD6_BOX = { xMin: S(3300), xMax: S(4700), yMin: S(100), yMax: S(1500) };        // 북동쪽 칸
const FIELD7_BOX = { xMin: S(3300), xMax: S(4700), yMin: S(3300), yMax: S(4700) };       // 남동쪽 칸

function inBox(x, y, b) { return x >= b.xMin && x < b.xMax && y >= b.yMin && y < b.yMax; }

function regionAt(x, y) {
  if (inBox(x, y, CAPITAL_BOX)) return { key: 'capital', name: '대도시' };
  if (inBox(x, y, SECOND_CITY_BOX)) return { key: 'frontier', name: '변방 도시' };
  if (inBox(x, y, FIELD1_BOX)) return { key: 'field1', name: '들꽃 초원' };
  if (inBox(x, y, FIELD2_BOX)) return { key: 'field2', name: '황혼 언덕' };
  if (inBox(x, y, FIELD3_BOX)) return { key: 'field3', name: '축축한 습지' };
  if (inBox(x, y, FIELD4_BOX)) return { key: 'field4', name: '메마른 협곡' };
  if (inBox(x, y, FIELD5_BOX)) return { key: 'field5', name: '얼어붙은 봉우리' };
  if (inBox(x, y, FIELD6_BOX)) return { key: 'field6', name: '불타는 사막' };
  if (inBox(x, y, FIELD7_BOX)) return { key: 'field7', name: '잊혀진 폐허' };
  return { key: 'wild', name: '황야' };
}

const ZONE_DEFS = {
  field1: { name: '들꽃 초원', monsterTypes: ['slime', 'mushroom'], monsterCount: 8, bossType: 'iceSlimeKing', eliteType: 'slimeChief', box: FIELD1_BOX },
  field2: { name: '황혼 언덕', monsterTypes: ['wolf', 'wolf', 'slime'], monsterCount: 8, bossType: 'flameAlphaWolf', eliteType: 'wolfAlpha', box: FIELD2_BOX },
  field3: { name: '축축한 습지', monsterTypes: ['frog', 'slime'], monsterCount: 8, bossType: 'swampFrogKing', eliteType: 'bogQueen', box: FIELD3_BOX },
  field4: { name: '메마른 협곡', monsterTypes: ['scorpion', 'mushroom'], monsterCount: 8, bossType: 'canyonScorpionKing', eliteType: 'sandstalker', box: FIELD4_BOX },
  field5: { name: '얼어붙은 봉우리', monsterTypes: ['bat', 'slime'], monsterCount: 8, bossType: 'frostBatLord', eliteType: 'frostReaver', box: FIELD5_BOX },
  field6: { name: '불타는 사막', monsterTypes: ['scorpion', 'golem'], monsterCount: 8, bossType: 'magmaGolem', eliteType: 'duneWarden', box: FIELD6_BOX },
  field7: { name: '잊혀진 폐허', monsterTypes: ['bat', 'golem'], monsterCount: 8, bossType: 'ruinGuardian', eliteType: 'ruinSentinel', box: FIELD7_BOX },
};

const TOWN_ENTRY = { x: S(2400), y: S(2580) }; // 대도시 — 기본 스폰 지점
const RAID_ENTRY = { x: 700, y: 780 }; // 레이드 아레나는 별도 월드라 스케일 영향 없음

const LANDMARKS = [
  { key: 'capital_fountain', x: S(2400), y: S(2400), r: 75, kind: 'fountain' },
  { key: 'frontier_fountain', x: S(800), y: S(4000), r: 58, kind: 'fountain' },
  { key: 'field1_raid', x: S(1900), y: S(1700), r: 40, kind: 'raid_entrance', zoneKey: 'field1' },
  { key: 'field2_raid', x: S(3800), y: S(1900), r: 40, kind: 'raid_entrance', zoneKey: 'field2' },
  { key: 'field3_raid', x: S(2400), y: S(3600), r: 40, kind: 'raid_entrance', zoneKey: 'field3' },
  { key: 'field4_raid', x: S(1200), y: S(2000), r: 40, kind: 'raid_entrance', zoneKey: 'field4' },
  { key: 'field5_raid', x: S(1100), y: S(500), r: 40, kind: 'raid_entrance', zoneKey: 'field5' },
  { key: 'field6_raid', x: S(3700), y: S(1100), r: 40, kind: 'raid_entrance', zoneKey: 'field6' },
  { key: 'field7_raid', x: S(4300), y: S(3600), r: 40, kind: 'raid_entrance', zoneKey: 'field7' },
];

// ── NPC / 퀘스트 — NPC 하나당 고정 퀘스트 하나(체인 없음), 완료 후에도 다시 받을 수는 없음 ──
const QUEST_DEFS = {
  q_slime: { name: '초원의 슬라임 사냥', npcId: 'npc_capital_1', monsterKind: 'slime', targetCount: 5, rewardGold: 80, rewardExp: 30, desc: '들꽃 초원에 나타나는 슬라임을 5마리 처치해주게.' },
  q_wolf: { name: '언덕의 들개 사냥', npcId: 'npc_capital_2', monsterKind: 'wolf', targetCount: 4, rewardGold: 100, rewardExp: 40, desc: '황혼 언덕의 들개들이 늘어나고 있네. 4마리만 처치해주게.' },
  q_frog: { name: '습지의 개구리 사냥', npcId: 'npc_frontier_1', monsterKind: 'frog', targetCount: 5, rewardGold: 90, rewardExp: 35, desc: '축축한 습지의 개구리를 5마리 잡아다 주게.' },
  q_scorpion: { name: '협곡의 전갈 사냥', npcId: 'npc_frontier_2', monsterKind: 'scorpion', targetCount: 4, rewardGold: 100, rewardExp: 40, desc: '메마른 협곡의 전갈이 말썽이야. 4마리만 처치해주게.' },
};
const NPC_DEFS = {
  npc_capital_1: { name: '촌장', x: S(2000), y: S(2650) },
  npc_capital_2: { name: '용병', x: S(2800), y: S(2650) },
  npc_frontier_1: { name: '약초꾼', x: S(400), y: S(4200) },
  npc_frontier_2: { name: '사냥꾼', x: S(1000), y: S(4200) },
};
function questIdForNpc(npcId) { return Object.keys(QUEST_DEFS).find(k => QUEST_DEFS[k].npcId === npcId); }
function questStateFor(user, questId) {
  const q = user.quests && user.quests[questId];
  if (!q) return 'not_started';
  if (q.turnedIn) return 'done';
  if (q.progress >= QUEST_DEFS[questId].targetCount) return 'ready';
  return 'active';
}
function sendNpcDialogue(player, npcId) {
  const npc = NPC_DEFS[npcId];
  const questId = questIdForNpc(npcId);
  const quest = QUEST_DEFS[questId];
  const user = player.user;
  if (!user.quests) user.quests = {};
  const state = questStateFor(user, questId);
  const progress = user.quests[questId] ? user.quests[questId].progress : 0;
  sendTo(player, {
    type: 'npc_dialogue', npcId, npcName: npc.name, questId, questName: quest.name, desc: quest.desc,
    monsterKind: quest.monsterKind, targetCount: quest.targetCount, progress, state,
    rewardGold: quest.rewardGold, rewardExp: quest.rewardExp,
  });
}

// 도시 안에 트리거를 나란히 배치하는 헬퍼(라벨/골드 kiosk가 늘어나도 겹치지 않게 자동 정렬)
function layoutRow(centerX, y, items, w, h, gap) {
  const totalW = items.length * w + (items.length - 1) * gap;
  let x = centerX - totalW / 2;
  const out = [];
  for (const it of items) {
    out.push({ ...it, x, y, w, h });
    x += w + gap;
  }
  return out;
}

const WORLD_PORTALS = [
  // 대도시 — 분수 광장을 중심으로 북쪽엔 레이드 접수처, 서/동쪽엔 상점·대장간이 늘어선 큰 도시
  ...layoutRow(S(2400), S(1950), [
    { id: 'raid_field1', label: '초원 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field1' } },
    { id: 'raid_field2', label: '언덕 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field2' } },
    { id: 'raid_field5', label: '봉우리 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field5' } },
    { id: 'raid_field6', label: '사막 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field6' } },
  ], 140, 55, 16),
  { id: 'shop_capital', x: S(1900), y: S(2350), w: 140, h: 60, label: '상점', action: { type: 'shop' } },
  { id: 'blacksmith_capital', x: S(2760), y: S(2350), w: 140, h: 60, label: '대장간', action: { type: 'blacksmith' } },
  { id: 'skillshop_capital', x: S(1900), y: S(2460), w: 140, h: 60, label: '스킬 상점', action: { type: 'skill_shop' } },
  { id: 'guildhall_capital', x: S(2760), y: S(2460), w: 140, h: 60, label: '마을 회관', action: { type: 'guild_hall' } },
  { id: 'market_capital', x: S(2330), y: S(2460), w: 140, h: 60, label: '거래장터', action: { type: 'market' } },
  // 변방 도시
  ...layoutRow(S(800), S(3550), [
    { id: 'raid_field3', label: '습지 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field3' } },
    { id: 'raid_field4', label: '협곡 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field4' } },
    { id: 'raid_field7', label: '폐허 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field7' } },
  ], 140, 55, 16),
  { id: 'shop_frontier', x: S(280), y: S(3950), w: 140, h: 60, label: '상점', action: { type: 'shop' } },
  { id: 'blacksmith_frontier', x: S(1140), y: S(3950), w: 140, h: 60, label: '대장간', action: { type: 'blacksmith' } },
  { id: 'skillshop_frontier', x: S(280), y: S(4060), w: 140, h: 60, label: '스킬 상점', action: { type: 'skill_shop' } },
  { id: 'guildhall_frontier', x: S(1140), y: S(4060), w: 140, h: 60, label: '마을 회관', action: { type: 'guild_hall' } },
  { id: 'market_frontier', x: S(710), y: S(4060), w: 140, h: 60, label: '거래장터', action: { type: 'market' } },
  // NPC — 퀘스트를 주는 마을 주민들
  { id: 'npc_capital_1', x: S(1950), y: S(2620), w: 100, h: 60, label: '촌장', action: { type: 'npc', npcId: 'npc_capital_1' } },
  { id: 'npc_capital_2', x: S(2750), y: S(2620), w: 100, h: 60, label: '용병', action: { type: 'npc', npcId: 'npc_capital_2' } },
  { id: 'npc_frontier_1', x: S(350), y: S(4170), w: 100, h: 60, label: '약초꾼', action: { type: 'npc', npcId: 'npc_frontier_1' } },
  { id: 'npc_frontier_2', x: S(950), y: S(4170), w: 100, h: 60, label: '사냥꾼', action: { type: 'npc', npcId: 'npc_frontier_2' } },
];

// ── 장애물(나무/바위) — 필드마다 흩뿌려서 시야를 막고 길찾기 재미를 더함 ──
const OBSTACLE_R = 16;
function scatterObstacles(box, kind, count, radius) {
  const r = radius || OBSTACLE_R;
  const list = [];
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const x = box.xMin + 60 + Math.random() * (box.xMax - box.xMin - 120);
      const y = box.yMin + 60 + Math.random() * (box.yMax - box.yMin - 120);
      const tooCloseLandmark = LANDMARKS.some(lm => Math.hypot(x - lm.x, y - lm.y) < lm.r + 60);
      const tooClosePortal = WORLD_PORTALS.some(p => x > p.x - 70 && x < p.x + p.w + 70 && y > p.y - 70 && y < p.y + p.h + 70);
      const tooCloseOther = list.some(o => Math.hypot(x - o.x, y - o.y) < 55);
      if (!tooCloseLandmark && !tooClosePortal && !tooCloseOther) {
        list.push({ x, y, r, kind });
        break;
      }
    }
  }
  return list;
}

// 도시 외곽을 두르는 성벽 — 상점/대장간/레이드 접수처 앞은 자동으로 비워져서 성문처럼 뚫림
function ringObstacles(box, kind, count, inset, radius) {
  const w = box.xMax - box.xMin, h = box.yMax - box.yMin;
  const perim = 2 * (w + h);
  const list = [];
  for (let i = 0; i < count; i++) {
    const d = (perim * i) / count;
    let x, y;
    if (d < w) { x = box.xMin + d; y = box.yMin + inset; }
    else if (d < w + h) { x = box.xMax - inset; y = box.yMin + (d - w); }
    else if (d < 2 * w + h) { x = box.xMax - (d - w - h); y = box.yMax - inset; }
    else { x = box.xMin + inset; y = box.yMax - (d - 2 * w - h); }
    const tooClosePortal = WORLD_PORTALS.some(p => x > p.x - 90 && x < p.x + p.w + 90 && y > p.y - 90 && y < p.y + p.h + 90);
    const tooCloseLandmark = LANDMARKS.some(lm => Math.hypot(x - lm.x, y - lm.y) < lm.r + 90);
    if (tooClosePortal || tooCloseLandmark) continue;
    list.push({ x, y, r: radius, kind });
  }
  return list;
}

const OBSTACLES = [
  ...scatterObstacles(FIELD1_BOX, 'tree', 11),
  ...scatterObstacles(FIELD2_BOX, 'tree', 8),
  ...scatterObstacles(FIELD3_BOX, 'tree', 10),
  ...scatterObstacles(FIELD4_BOX, 'rock', 10),
  ...scatterObstacles(FIELD5_BOX, 'tree', 9),
  ...scatterObstacles(FIELD6_BOX, 'rock', 10),
  ...scatterObstacles(FIELD7_BOX, 'rock', 10),
  // 구조물(부서진 기둥/울타리 등) — 지역마다 조금씩 섞어 넣음
  ...scatterObstacles(FIELD1_BOX, 'structure', 2),
  ...scatterObstacles(FIELD2_BOX, 'structure', 2),
  ...scatterObstacles(FIELD3_BOX, 'structure', 2),
  ...scatterObstacles(FIELD4_BOX, 'structure', 3),
  ...scatterObstacles(FIELD5_BOX, 'structure', 2),
  ...scatterObstacles(FIELD6_BOX, 'structure', 3),
  ...scatterObstacles(FIELD7_BOX, 'structure', 4),
  // 지역별 테마 구조물 — 다채로운 볼거리 추가
  ...scatterObstacles(FIELD1_BOX, 'fence', 3),        // 들꽃 초원 — 목장 울타리
  ...scatterObstacles(FIELD2_BOX, 'fence', 2),
  ...scatterObstacles(FIELD2_BOX, 'cairn', 2),        // 황혼 언덕 — 돌무덤
  ...scatterObstacles(FIELD3_BOX, 'totem', 3),        // 축축한 습지 — 부족 토템
  ...scatterObstacles(FIELD4_BOX, 'campfire', 2),     // 메마른 협곡 — 버려진 야영지
  ...scatterObstacles(FIELD5_BOX, 'cairn', 3),        // 얼어붙은 봉우리 — 돌무덤
  ...scatterObstacles(FIELD6_BOX, 'cactus', 4),       // 불타는 사막 — 선인장
  ...scatterObstacles(FIELD7_BOX, 'ruinWall', 3),     // 잊혀진 폐허 — 무너진 벽
  // 도시 — 민가·시장 좌판을 훨씬 촘촘하게 채워 넣어 진짜 대도시처럼 붐비게, 외곽엔 성벽을 둘러 마을이 아니라 도시처럼
  ...scatterObstacles(CAPITAL_BOX, 'house', 32, 30),
  ...scatterObstacles(CAPITAL_BOX, 'stall', 12, 26),
  ...scatterObstacles(SECOND_CITY_BOX, 'house', 20, 30),
  ...scatterObstacles(SECOND_CITY_BOX, 'stall', 8, 26),
  ...ringObstacles(CAPITAL_BOX, 'wallSeg', 32, 20, 34),
  ...ringObstacles(SECOND_CITY_BOX, 'wallSeg', 24, 20, 34),
];

// ── 장식(꽃/흙길) — 충돌 없이 순수 시각 요소, 서버가 위치를 고정해서 모두에게 동일하게 보이게 함 ──
function scatterDecorations(box, kind, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 15; tries++) {
      const x = box.xMin + 30 + Math.random() * (box.xMax - box.xMin - 60);
      const y = box.yMin + 30 + Math.random() * (box.yMax - box.yMin - 60);
      const tooCloseLandmark = LANDMARKS.some(lm => Math.hypot(x - lm.x, y - lm.y) < lm.r + 25);
      const tooCloseObstacle = OBSTACLES.some(o => Math.hypot(x - o.x, y - o.y) < o.r + 20);
      const tooClosePortal = WORLD_PORTALS.some(p => x > p.x - 30 && x < p.x + p.w + 30 && y > p.y - 30 && y < p.y + p.h + 30);
      const tooCloseOther = list.some(o => Math.hypot(x - o.x, y - o.y) < 18);
      if (!tooCloseLandmark && !tooCloseObstacle && !tooClosePortal && !tooCloseOther) { list.push({ x, y, kind }); break; }
    }
  }
  return list;
}

function boxCenter(b) { return { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 }; }
function closestPointOnBox(from, box) {
  return { x: Math.max(box.xMin, Math.min(box.xMax, from.x)), y: Math.max(box.yMin, Math.min(box.yMax, from.y)) };
}

function pathDecorations(from, to, kind, step) {
  const list = [];
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
  const n = Math.max(1, Math.floor(dist / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    list.push({ x: from.x + dx * t + (Math.random() * 14 - 7), y: from.y + dy * t + (Math.random() * 14 - 7), kind });
  }
  return list;
}

const FIELD_KEYS = ['field1', 'field2', 'field3', 'field4', 'field5', 'field6', 'field7'];
const FIELD_BOXES = { field1: FIELD1_BOX, field2: FIELD2_BOX, field3: FIELD3_BOX, field4: FIELD4_BOX, field5: FIELD5_BOX, field6: FIELD6_BOX, field7: FIELD7_BOX };
// 필드마다 소재지 역할을 하는 도시 — 레이드 접수처가 있는 도시와 동일하게 매핑
const FIELD_HUB_BOX = {
  field1: CAPITAL_BOX, field2: CAPITAL_BOX, field5: CAPITAL_BOX, field6: CAPITAL_BOX,
  field3: SECOND_CITY_BOX, field4: SECOND_CITY_BOX, field7: SECOND_CITY_BOX,
};

const DECORATIONS = [
  ...scatterDecorations(FIELD1_BOX, 'flower', 20),
  ...scatterDecorations(FIELD2_BOX, 'flower', 10),
  ...scatterDecorations(FIELD2_BOX, 'dirt', 6),
  ...scatterDecorations(FIELD3_BOX, 'flower', 12),
  ...scatterDecorations(FIELD4_BOX, 'dirt', 14),
  ...scatterDecorations(FIELD5_BOX, 'flower', 10),
  ...scatterDecorations(FIELD6_BOX, 'dirt', 14),
  ...scatterDecorations(FIELD7_BOX, 'dirt', 12),
  // 지역 중심에서 레이드 입구까지 흙길
  ...FIELD_KEYS.flatMap(key => {
    const raidLm = LANDMARKS.find(l => l.kind === 'raid_entrance' && l.zoneKey === key);
    if (!raidLm) return [];
    return pathDecorations(boxCenter(FIELD_BOXES[key]), raidLm, 'dirt', 45);
  }),
  // 지역마다 소재지 도시까지 이어지는 흙길 — 필드들이 뚝뚝 끊긴 섬이 아니라 서로 연결된 하나의 세계처럼 보이게
  // (도시 광장 안쪽까지 파고들지 않도록 도시 경계에서 멈춤)
  ...FIELD_KEYS.flatMap(key => {
    const fieldCenter = boxCenter(FIELD_BOXES[key]);
    const hubEdge = closestPointOnBox(fieldCenter, FIELD_HUB_BOX[key]);
    return pathDecorations(fieldCenter, hubEdge, 'dirt', 110);
  }),
  // 도시 가로등 — 거리를 밝혀서 진짜 도시 느낌
  ...scatterDecorations(CAPITAL_BOX, 'lamp', 22),
  ...scatterDecorations(SECOND_CITY_BOX, 'lamp', 14),
];

// ── 공용 물리 ───────────────────────────────────────────
function clampToWorld(p, r, world) {
  const t = world.wallThickness;
  p.x = Math.max(t + r, Math.min(world.w - t - r, p.x));
  p.y = Math.max(t + r, Math.min(world.h - t - r, p.y));
}

function pushOutOfCircle(entity, r, obs) {
  const dx = entity.x - obs.x, dy = entity.y - obs.y;
  const dist = Math.hypot(dx, dy);
  const minDist = obs.r + r;
  if (dist < minDist && dist > 0) {
    const push = (minDist - dist) / dist;
    entity.x += dx * push;
    entity.y += dy * push;
  }
}

function resolveLandmarksCollision(entity, r, room) {
  for (const lm of room.landmarks) {
    if (lm.kind !== 'fountain') continue;
    pushOutOfCircle(entity, r, lm);
  }
  for (const ob of room.obstacles || []) {
    pushOutOfCircle(entity, r, ob);
  }
}

function roll(base) {
  return Math.max(1, Math.round(base + (Math.random() * 4 - 2)));
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function approach(current, target, rate, dt) {
  if (current < target) return Math.min(current + rate * dt, target);
  if (current > target) return Math.max(current - rate * dt, target);
  return current;
}

function jitter(pt) {
  return { x: pt.x + (Math.random() * 20 - 10), y: pt.y + (Math.random() * 20 - 10) };
}

function round1(v) { return Math.round(v * 10) / 10; }

// ── 아이템 / 경제 ───────────────────────────────────────
const WEAPON_CATALOG = {
  silverSword: { name: '실버 소드', atkBonus: 2, maxDurability: 35, element: 'none', price: 50 },
  goldSword: { name: '골드 소드', atkBonus: 4, maxDurability: 45, element: 'none', price: 100 },
  flameSword: { name: '화염검', atkBonus: 2, maxDurability: 40, element: 'fire', price: 80 },
  frostSword: { name: '빙결검', atkBonus: 2, maxDurability: 40, element: 'ice', price: 80 },
  steelSword: { name: '강철검', atkBonus: 4, maxDurability: 50, element: 'none', price: 120 },
  diamondSword: { name: '다이아 소드', atkBonus: 6, maxDurability: 55, element: 'none', price: 150 },
  radiantSword: { name: '레디언트 소드', atkBonus: 9, maxDurability: 65, element: 'none', price: 250 },
  windBreathSword: { name: '바람의 숨결', atkBonus: 12, maxDurability: 75, element: 'none', price: 350 },
  masterySword: { name: '마스터리 소드', atkBonus: 16, maxDurability: 90, element: 'none', price: 500 },
};
const POTION_CATALOG = {
  healthPotion: { name: '체력 물약', heal: 20, price: 15 },
};
const MAP_ITEM_KEY = 'worldMap';
const MAP_PRICE = 150;
const SHOP_CATALOG = [
  ...Object.entries(WEAPON_CATALOG).map(([key, w]) => ({ key, kind: 'weapon', name: w.name, price: w.price, atkBonus: w.atkBonus, maxDurability: w.maxDurability, element: w.element })),
  ...Object.entries(POTION_CATALOG).map(([key, p]) => ({ key, kind: 'potion', name: p.name, price: p.price, heal: p.heal })),
  { key: MAP_ITEM_KEY, kind: 'map', name: '세계 지도', price: MAP_PRICE },
];

let nextItemId = 1;
function makeStarterWeapon() {
  return { id: 'w' + (nextItemId++), kind: 'weapon', key: 'starter', name: '낡은 검', atkBonus: 0, durability: 30, maxDurability: 30, element: 'none', enhanceLevel: 0 };
}

function sendInventory(player) {
  sendTo(player, { type: 'inventory', gold: player.gold, weapon: player.weapon, inventory: player.inventory });
}

function syncGold(player) {
  if (player.user) { player.user.gold = player.gold; saveUsers(); }
}

function addMaterial(player, monsterKind) {
  const info = MATERIAL_INFO[monsterKind];
  if (!info) return null;
  const existing = player.inventory.find(i => i.kind === 'material' && i.key === monsterKind);
  if (existing) existing.qty++;
  else player.inventory.push({ id: 'm' + (nextItemId++), kind: 'material', key: monsterKind, name: info.name, price: info.price, qty: 1 });
  return info;
}

// ── 방(room) 관리 ───────────────────────────────────────
const rooms = new Map();
const playersByWs = new Map();
let nextId = 1;
let nextMonsterId = 1;
let nextRaidId = 1;

function randomFieldPoint(zoneKey) {
  const b = ZONE_DEFS[zoneKey].box;
  for (let i = 0; i < 20; i++) {
    const x = b.xMin + 20 + Math.random() * (b.xMax - b.xMin - 40);
    const y = b.yMin + 20 + Math.random() * (b.yMax - b.yMin - 40);
    const tooClose = LANDMARKS.some(lm => (lm.kind === 'fountain' || lm.kind === 'raid_entrance') && Math.hypot(x - lm.x, y - lm.y) < lm.r + 40);
    if (!tooClose) return { x, y };
  }
  return { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 };
}

function spawnFieldMonster(room, zoneKey) {
  const def = ZONE_DEFS[zoneKey];
  const kind = def.monsterTypes[Math.floor(Math.random() * def.monsterTypes.length)];
  const t = MONSTER_TYPES[kind];
  const pt = randomFieldPoint(zoneKey);
  const m = {
    id: nextMonsterId++, kind, name: t.name, homeZone: zoneKey,
    x: pt.x, y: pt.y, hp: t.hp, maxHp: t.hp, atk: t.atk, exp: t.exp, r: t.r,
    chaseSpeed: t.chaseSpeed, wanderSpeed: t.wanderSpeed, aggroRange: t.aggroRange, deaggroRange: t.deaggroRange,
    mode: 'wander', targetId: null, lastAttackAt: 0, stunUntil: 0,
    wanderDir: { x: 0, y: 0 }, wanderUntil: 0,
  };
  room.monsters.set(m.id, m);
}

// 필드마다 상주하는 정예 몬스터 — 잡몹보다 훨씬 세지만 인스턴싱 없이 그대로 필드를 돌아다님
function spawnEliteMonster(room, zoneKey) {
  const eliteKind = ZONE_DEFS[zoneKey].eliteType;
  if (!eliteKind) return;
  const t = ELITE_TYPES[eliteKind];
  const pt = randomFieldPoint(zoneKey);
  const m = {
    id: nextMonsterId++, kind: eliteKind, name: t.name, homeZone: zoneKey, isElite: true,
    x: pt.x, y: pt.y, hp: t.hp, maxHp: t.hp, atk: t.atk, exp: t.exp, r: t.r,
    chaseSpeed: t.chaseSpeed, wanderSpeed: t.wanderSpeed, aggroRange: t.aggroRange, deaggroRange: t.deaggroRange,
    mode: 'wander', targetId: null, lastAttackAt: 0, stunUntil: 0,
    wanderDir: { x: 0, y: 0 }, wanderUntil: 0,
  };
  room.monsters.set(m.id, m);
}

function spawnBoss(bossTypeKey) {
  const t = BOSS_TYPES[bossTypeKey];
  return {
    id: nextMonsterId++, kind: bossTypeKey, name: t.name, isBoss: true, weakness: t.weakness,
    x: RAID_WORLD.w / 2, y: RAID_WORLD.h / 2, hp: t.hp, maxHp: t.hp, atk: t.atk, exp: t.exp, r: t.r,
    chaseSpeed: t.chaseSpeed, wanderSpeed: 0, aggroRange: t.aggroRange, deaggroRange: t.deaggroRange,
    mode: 'wander', targetId: null, lastAttackAt: 0, stunUntil: 0,
    wanderDir: { x: 0, y: 0 }, wanderUntil: 0,
    special: { phase: 'idle', nextAt: Date.now() + 3000, until: 0, dashDir: null, hitSet: new Set() },
  };
}

function createOverworldRoom() {
  const room = {
    id: 'world', kind: 'world', world: OVERWORLD,
    players: new Map(), monsters: new Map(), projectiles: new Map(),
    landmarks: LANDMARKS, portals: WORLD_PORTALS, obstacles: OBSTACLES, decorations: DECORATIONS, entryPoint: TOWN_ENTRY,
  };
  rooms.set('world', room);
  for (const key of Object.keys(ZONE_DEFS)) {
    for (let i = 0; i < ZONE_DEFS[key].monsterCount; i++) spawnFieldMonster(room, key);
    spawnEliteMonster(room, key);
  }
  return room;
}

// 레이드 아레나 장식 — 해당 필드와 같은 테마로 꾸미되, 중앙 보스 전투 공간은 비워둠(가장자리 고리에만 배치)
const RAID_ARENA_CENTER = { x: RAID_WORLD.w / 2, y: RAID_WORLD.h / 2 };
function scatterRing(kind, count, clearRadius, isDecoration) {
  const list = [];
  const marginX = RAID_WORLD.w * 0.12, marginY = RAID_WORLD.h * 0.12;
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const x = marginX + Math.random() * (RAID_WORLD.w - marginX * 2);
      const y = marginY + Math.random() * (RAID_WORLD.h - marginY * 2);
      if (Math.hypot(x - RAID_ARENA_CENTER.x, y - RAID_ARENA_CENTER.y) < clearRadius) continue;
      const tooCloseOther = list.some(o => Math.hypot(x - o.x, y - o.y) < (isDecoration ? 18 : 55));
      if (tooCloseOther) continue;
      list.push(isDecoration ? { x, y, kind } : { x, y, r: OBSTACLE_R, kind });
      break;
    }
  }
  return list;
}
const RAID_ARENA_DECOR = {
  field1: { obstacles: [['tree', 6], ['fence', 2]], decorations: [['flower', 12]] },
  field2: { obstacles: [['tree', 4], ['cairn', 2]], decorations: [['flower', 6]] },
  field3: { obstacles: [['totem', 3], ['tree', 3]], decorations: [['flower', 8]] },
  field4: { obstacles: [['rock', 4], ['campfire', 2]], decorations: [['dirt', 8]] },
  field5: { obstacles: [['cairn', 4]], decorations: [['dirt', 4]] },
  field6: { obstacles: [['cactus', 4], ['rock', 2]], decorations: [['dirt', 8]] },
  field7: { obstacles: [['ruinWall', 4], ['rock', 2]], decorations: [['dirt', 6]] },
};

function createRaidRoom(zoneKey, mode, hostId, hostName) {
  const id = 'raid' + (nextRaidId++);
  const bossTypeKey = ZONE_DEFS[zoneKey].bossType;
  const boss = spawnBoss(bossTypeKey);
  const decor = RAID_ARENA_DECOR[zoneKey];
  const obstacles = decor ? decor.obstacles.flatMap(([kind, count]) => scatterRing(kind, count, 260, false)) : [];
  const decorations = decor ? decor.decorations.flatMap(([kind, count]) => scatterRing(kind, count, 260, true)) : [];
  const room = {
    id, kind: 'raid', zoneKey, mode, hostId, hostName, started: mode === 'solo', createdAt: Date.now(), world: RAID_WORLD,
    players: new Map(), monsters: new Map([[boss.id, boss]]), projectiles: new Map(), boss,
    landmarks: [], portals: [], obstacles, decorations, entryPoint: RAID_ENTRY,
  };
  rooms.set(id, room);
  return room;
}

function maybeCleanupRaid(room) {
  if (room.kind === 'raid' && room.players.size === 0) rooms.delete(room.id);
}

function roomDisplayName(room, player) {
  if (room.kind === 'world') return regionAt(player.x, player.y).name;
  return ZONE_DEFS[room.zoneKey].name + ' 레이드';
}

createOverworldRoom();

function movePlayerToRoom(player, targetRoomId, spawnPos) {
  const oldRoom = rooms.get(player.roomId);
  if (oldRoom) {
    oldRoom.players.delete(player.ws);
    for (const m of oldRoom.monsters.values()) {
      if (m.targetId === player.id) { m.mode = 'wander'; m.targetId = null; }
    }
    if (oldRoom.kind === 'raid' && oldRoom.mode === 'party' && oldRoom.hostId === player.id && oldRoom.players.size > 0) {
      const next = [...oldRoom.players.values()][0];
      oldRoom.hostId = next.id; oldRoom.hostName = next.name;
    }
    broadcastRaidRoomInfo(oldRoom);
    maybeCleanupRaid(oldRoom);
  }
  const targetRoom = rooms.get(targetRoomId);
  const sp = spawnPos || jitter(targetRoom.entryPoint);
  player.roomId = targetRoomId;
  player.x = sp.x; player.y = sp.y; player.vx = 0; player.vy = 0;
  player.stunUntil = 0; player.slowUntil = 0; player.raidEntranceZone = null;
  targetRoom.players.set(player.ws, player);
  sendTo(player, {
    type: 'zone_change',
    zoneKey: targetRoom.kind === 'world' ? regionAt(player.x, player.y).key : targetRoom.zoneKey,
    zoneName: roomDisplayName(targetRoom, player),
    x: player.x, y: player.y, world: targetRoom.world,
    landmarks: targetRoom.landmarks, portals: targetRoom.portals, obstacles: targetRoom.obstacles, decorations: targetRoom.decorations,
    isRaid: targetRoom.kind === 'raid',
  });
  broadcastRaidRoomInfo(targetRoom);
}

function sendTo(player, obj) {
  if (player.ws.readyState === player.ws.OPEN) player.ws.send(JSON.stringify(obj));
}

function sendRaw(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastRoom(room, obj) {
  const raw = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
  }
}

function sendRaidList(player, zoneKey) {
  const list = [...rooms.values()]
    .filter(r => r.kind === 'raid' && r.zoneKey === zoneKey && r.mode === 'party')
    .map(r => ({
      id: r.id, hostName: r.hostName, playerCount: r.players.size, maxPlayers: MAX_RAID_PLAYERS,
      bossHpPct: r.boss ? Math.round((r.boss.hp / r.boss.maxHp) * 100) : 0, started: r.started,
    }));
  sendTo(player, { type: 'raid_rooms', zoneKey, rooms: list });
}

// 파티 레이드 대기실 — 방장이 시작 누르기 전엔 보스가 움직이지 않음
function broadcastRaidRoomInfo(room) {
  if (room.kind !== 'raid' || room.mode !== 'party') return;
  broadcastRoom(room, {
    type: 'raid_room_info', hostId: room.hostId, started: room.started,
    members: [...room.players.values()].map(p => ({ id: p.id, name: p.name })),
  });
}

// ── 트리거 판정 (포탈 / 레이드 입구) ────────────────────
function checkPortals(player, room, now) {
  let matched = null;
  for (const portal of room.portals) {
    if (player.x >= portal.x && player.x <= portal.x + portal.w && player.y >= portal.y && player.y <= portal.y + portal.h) {
      matched = portal;
      break;
    }
  }
  if (!matched) {
    player.activePortalId = null;
    return;
  }
  if (player.activePortalId === matched.id) return; // 이미 들어와서 열어준 포탈 — 다시 안 엶 (수동으로 닫아도 그대로 유지)
  player.activePortalId = matched.id;
  if (matched.action.type === 'raid_list') {
    sendRaidList(player, matched.action.zoneKey);
  } else if (matched.action.type === 'shop') {
    sendTo(player, { type: 'shop_open', catalog: SHOP_CATALOG, gold: player.gold, hasMap: !!player.user.hasMap });
  } else if (matched.action.type === 'blacksmith') {
    sendTo(player, { type: 'blacksmith_open', weapon: player.weapon, gold: player.gold });
  } else if (matched.action.type === 'skill_shop') {
    const user = player.user;
    const catalog = Object.entries(SKILL_DEFS).filter(([, d]) => d.classKey === player.classKey).map(([key, d]) => ({ key, ...d }));
    sendTo(player, { type: 'skill_shop_open', catalog, ownedSkills: user.ownedSkills, equippedSkills: user.equippedSkills, gold: player.gold });
  } else if (matched.action.type === 'guild_hall') {
    const user = player.user;
    const guild = user.guildId ? guilds.get(user.guildId) : null;
    sendTo(player, {
      type: 'guild_hall_open', guild: guild ? publicGuild(guild) : null,
      isOwner: !!(guild && guild.ownerUsername === user.username),
      members: guild ? guild.members : [], pending: guild ? guild.pending : [],
      guilds: [...guilds.values()].map(publicGuild),
    });
  } else if (matched.action.type === 'npc') {
    sendNpcDialogue(player, matched.action.npcId);
  } else if (matched.action.type === 'market') {
    sendMarketData(player);
  }
}

function checkRaidEntrance(player, room, now) {
  if (room.kind !== 'world') {
    if (player.raidEntranceZone) { player.raidEntranceZone = null; sendTo(player, { type: 'raid_prompt', show: false }); }
    return;
  }
  let insideZone = null;
  for (const lm of room.landmarks) {
    if (lm.kind !== 'raid_entrance') continue;
    if (Math.hypot(player.x - lm.x, player.y - lm.y) < lm.r) { insideZone = lm.zoneKey; break; }
  }
  if (insideZone && player.raidEntranceZone !== insideZone) {
    player.raidEntranceZone = insideZone;
    sendTo(player, { type: 'raid_prompt', show: true, zoneKey: insideZone });
  } else if (!insideZone && player.raidEntranceZone) {
    player.raidEntranceZone = null;
    sendTo(player, { type: 'raid_prompt', show: false });
  }
}

// ── 전투 ────────────────────────────────────────────────
function handlePlayerDefeated(room, target, dmg) {
  target.vx = 0; target.vy = 0; target.stunUntil = 0; target.slowUntil = 0;
  if (room.kind === 'raid') {
    target.hp = target.maxHp;
    sendTo(target, { type: 'player_hit', damage: dmg, hp: target.hp, maxHp: target.maxHp, x: target.x, y: target.y, stunMs: 0, defeated: true });
    movePlayerToRoom(target, 'world', jitter(TOWN_ENTRY));
  } else {
    const sp = jitter(TOWN_ENTRY);
    target.x = sp.x; target.y = sp.y;
    target.hp = target.maxHp;
    sendTo(target, { type: 'player_hit', damage: dmg, hp: target.hp, maxHp: target.maxHp, x: target.x, y: target.y, stunMs: 0, defeated: true });
  }
}

function dealMonsterContactDamage(room, m, target, dx, dy, dist) {
  const dmg = applyGuardReduction(target, roll(m.atk));
  target.hp = Math.max(0, target.hp - dmg);
  if (target.hp <= 0) {
    handlePlayerDefeated(room, target, dmg);
    return;
  }
  const kbx = dist > 0 ? dx / dist : 1, kby = dist > 0 ? dy / dist : 0;
  target.x += kbx * PLAYER_KNOCKBACK;
  target.y += kby * PLAYER_KNOCKBACK;
  target.vx = 0; target.vy = 0;
  clampToWorld(target, PLAYER_R, room.world);
  resolveLandmarksCollision(target, PLAYER_R, room);
  clampToWorld(target, PLAYER_R, room.world);
  target.stunUntil = Date.now() + PLAYER_STUN_MS;
  sendTo(target, { type: 'player_hit', damage: dmg, hp: target.hp, maxHp: target.maxHp, x: target.x, y: target.y, stunMs: PLAYER_STUN_MS, defeated: false });
}

function applyNova(room, boss, t) {
  for (const p of room.players.values()) {
    const dist = Math.hypot(p.x - boss.x, p.y - boss.y);
    if (dist > t.novaRadius) continue;
    const dmg = applyGuardReduction(p, t.novaDamage);
    p.hp = Math.max(0, p.hp - dmg);
    if (p.hp <= 0) { handlePlayerDefeated(room, p, dmg); continue; }
    const kbx = dist > 0 ? (p.x - boss.x) / dist : 1, kby = dist > 0 ? (p.y - boss.y) / dist : 0;
    p.x += kbx * PLAYER_KNOCKBACK;
    p.y += kby * PLAYER_KNOCKBACK;
    p.vx = 0; p.vy = 0;
    clampToWorld(p, PLAYER_R, room.world);
    resolveLandmarksCollision(p, PLAYER_R, room);
    clampToWorld(p, PLAYER_R, room.world);
    p.slowUntil = Date.now() + t.novaSlowMs;
    p.stunUntil = Date.now() + 180;
    sendTo(p, { type: 'player_hit', damage: dmg, hp: p.hp, maxHp: p.maxHp, x: p.x, y: p.y, stunMs: 180, defeated: false });
  }
}

function updateBossSpecial(room, boss, dt, now) {
  const s = boss.special;
  const t = BOSS_TYPES[boss.kind];
  if (t.pattern === 'nova') {
    if (s.phase === 'telegraph') {
      if (now >= s.until) {
        s.phase = 'idle';
        applyNova(room, boss, t);
        s.nextAt = now + t.novaIntervalMs;
      }
      return true;
    }
    if (boss.mode === 'chase' && now >= s.nextAt) {
      s.phase = 'telegraph';
      s.until = now + t.novaTelegraphMs;
      return true;
    }
    return false;
  }
  if (t.pattern === 'dash') {
    if (s.phase === 'telegraph') {
      if (now >= s.until) {
        const target = [...room.players.values()].find(p => p.id === boss.targetId);
        if (target) {
          const dx = target.x - boss.x, dy = target.y - boss.y, len = Math.hypot(dx, dy) || 1;
          s.dashDir = { x: dx / len, y: dy / len };
        } else {
          s.dashDir = { x: 1, y: 0 };
        }
        s.phase = 'dash';
        s.until = now + t.dashDurationMs;
        s.hitSet = new Set();
      }
      return true;
    }
    if (s.phase === 'dash') {
      boss.x += s.dashDir.x * t.dashSpeed * dt;
      boss.y += s.dashDir.y * t.dashSpeed * dt;
      for (const p of room.players.values()) {
        if (s.hitSet.has(p.id)) continue;
        const dx = p.x - boss.x, dy = p.y - boss.y;
        const dist = Math.hypot(dx, dy);
        if (dist < boss.r + PLAYER_R + 6) {
          s.hitSet.add(p.id);
          dealMonsterContactDamage(room, { atk: t.dashDamage }, p, dx, dy, dist);
        }
      }
      if (now >= s.until) { s.phase = 'recover'; s.until = now + t.recoverMs; }
      return true;
    }
    if (s.phase === 'recover') {
      if (now >= s.until) { s.phase = 'idle'; s.nextAt = now + t.dashIntervalMs; }
      return true;
    }
    if (boss.mode === 'chase' && now >= s.nextAt) {
      s.phase = 'telegraph';
      s.until = now + t.dashTelegraphMs;
      return true;
    }
    return false;
  }
  return false;
}

function updateMonsters(room, dt, now) {
  if (room.kind === 'raid' && room.started === false) return; // 방장이 시작 누르기 전엔 보스가 가만히 있음
  for (const m of room.monsters.values()) {
    if (now < m.stunUntil) {
      clampToWorld(m, m.r, room.world);
      resolveLandmarksCollision(m, m.r, room);
      clampToWorld(m, m.r, room.world);
      continue;
    }

    if (m.isBoss) {
      let target = m.targetId != null ? [...room.players.values()].find(p => p.id === m.targetId) : null;
      if (m.mode === 'chase' && !target) { m.mode = 'wander'; m.targetId = null; }
      if (m.mode === 'wander') {
        for (const p of room.players.values()) { m.mode = 'chase'; m.targetId = p.id; break; }
      }
      if (updateBossSpecial(room, m, dt, now)) {
        clampToWorld(m, m.r, room.world);
        continue;
      }
    }

    let target = m.targetId != null ? [...room.players.values()].find(p => p.id === m.targetId) : null;
    if (m.mode === 'chase' && (!target || Math.hypot(target.x - m.x, target.y - m.y) > m.deaggroRange)) {
      m.mode = 'wander'; m.targetId = null; target = null;
    }
    if (m.mode === 'wander') {
      for (const p of room.players.values()) {
        if (Math.hypot(p.x - m.x, p.y - m.y) <= m.aggroRange) { m.mode = 'chase'; m.targetId = p.id; target = p; break; }
      }
    }

    const slowMult = (m.slowUntil && now < m.slowUntil) ? 0.5 : 1;
    if (m.mode === 'chase' && target) {
      const dx = target.x - m.x, dy = target.y - m.y;
      const dist = Math.hypot(dx, dy);
      const contactRange = m.r + PLAYER_R + 4;
      if (dist > contactRange) {
        m.x += (dx / dist) * m.chaseSpeed * slowMult * dt;
        m.y += (dy / dist) * m.chaseSpeed * slowMult * dt;
      } else if (now - m.lastAttackAt >= MONSTER_ATTACK_COOLDOWN_MS) {
        m.lastAttackAt = now;
        dealMonsterContactDamage(room, m, target, dx, dy, dist);
      }
    } else if (!m.isBoss) {
      if (now > m.wanderUntil) {
        const angle = Math.random() * Math.PI * 2;
        const moving = Math.random() < 0.7;
        m.wanderDir = moving ? { x: Math.cos(angle), y: Math.sin(angle) } : { x: 0, y: 0 };
        m.wanderUntil = now + 1500 + Math.random() * 2000;
      }
      m.x += m.wanderDir.x * m.wanderSpeed * slowMult * dt;
      m.y += m.wanderDir.y * m.wanderSpeed * slowMult * dt;
      if (m.homeZone) {
        const b = ZONE_DEFS[m.homeZone].box;
        m.x = Math.max(b.xMin, Math.min(b.xMax, m.x));
        m.y = Math.max(b.yMin, Math.min(b.yMax, m.y));
      }
    }
    clampToWorld(m, m.r, room.world);
    resolveLandmarksCollision(m, m.r, room);
    clampToWorld(m, m.r, room.world);
  }
}

// 몬스터 한 마리에게 피해를 적용 — 넉백/기절/처치 보상까지 melee·투사체 공격이 공통으로 사용
function applyHitToMonster(room, player, m, dmg, now) {
  m.hp = Math.max(0, m.hp - dmg);
  m.mode = 'chase';
  m.targetId = player.id;
  const hit = { monsterId: m.id, damage: dmg, x: m.x, y: m.y, monsterHp: m.hp, monsterMaxHp: m.maxHp, defeated: false, isBoss: !!m.isBoss };

  const dx = m.x - player.x, dy = m.y - player.y;
  const dist = Math.hypot(dx, dy);
  const kb = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
  m.x += kb.x * MONSTER_KNOCKBACK;
  m.y += kb.y * MONSTER_KNOCKBACK;
  clampToWorld(m, m.r, room.world);
  resolveLandmarksCollision(m, m.r, room);
  clampToWorld(m, m.r, room.world);
  m.stunUntil = now + MONSTER_STUN_MS;

  if (m.hp <= 0) {
    hit.defeated = true;
    hit.exp = m.exp;
    hit.materialName = MATERIAL_INFO[m.kind]?.name;
    const goldGain = Math.max(2, Math.round(m.exp * 0.5));
    hit.goldGain = goldGain;
    if (m.isBoss) {
      for (const p of room.players.values()) {
        p.exp = (p.exp || 0) + m.exp;
        applyLevelUps(p);
        addMaterial(p, m.kind);
        p.gold += goldGain;
        syncGold(p);
        sendInventory(p);
        sendTo(p, { type: 'raid_win', bossName: m.name, exp: m.exp, goldGain, materialName: hit.materialName });
      }
      room.monsters.delete(m.id);
      room.boss = null;
      const roomId = room.id;
      setTimeout(() => {
        const r = rooms.get(roomId);
        if (!r) return;
        for (const p of [...r.players.values()]) movePlayerToRoom(p, 'world', jitter(TOWN_ENTRY));
        rooms.delete(roomId);
      }, 3000);
    } else {
      player.exp = (player.exp || 0) + m.exp;
      applyLevelUps(player);
      addMaterial(player, m.kind);
      player.gold += goldGain;
      syncGold(player);
      sendInventory(player);
      if (player.user && player.user.quests) {
        for (const [qid, q] of Object.entries(player.user.quests)) {
          const qdef = QUEST_DEFS[qid];
          if (qdef && qdef.monsterKind === m.kind && !q.turnedIn && q.progress < qdef.targetCount) q.progress++;
        }
      }
      room.monsters.delete(m.id);
      const homeZone = m.homeZone;
      if (m.isElite) {
        setTimeout(() => {
          const r = rooms.get('world');
          if (r) spawnEliteMonster(r, homeZone);
        }, ELITE_RESPAWN_DELAY_MS);
      } else {
        setTimeout(() => {
          const r = rooms.get('world');
          if (r) spawnFieldMonster(r, homeZone);
        }, RESPAWN_DELAY_MS);
      }
    }
  }
  return hit;
}

function handleAttack(player) {
  const now = Date.now();
  if (now - player.lastAttackAt < ATTACK_COOLDOWN_MS) return;
  player.lastAttackAt = now;
  const room = rooms.get(player.roomId);
  if (!room) return;
  if (room.kind === 'raid' && room.started === false) return;
  const classDef = CLASS_DEFS[player.classKey] || CLASS_DEFS.warrior;
  if (classDef.attackType === 'ranged') {
    spawnProjectile(room, player);
    return;
  }
  handleMeleeAttack(player, room, now);
}

function handleMeleeAttack(player, room, now) {
  broadcastRoom(room, { type: 'swing', id: player.id });
  const weaponUsed = player.weapon;

  const hits = [];
  for (const m of room.monsters.values()) {
    const dx = m.x - player.x, dy = m.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > ATTACK_REACH + m.r) continue;
    const angleTo = Math.atan2(dy, dx);
    if (Math.abs(normalizeAngle(angleTo - player.facing)) > ATTACK_HALF_ANGLE) continue;

    const weapon = weaponUsed;
    let dmg = roll(player.atk + (weapon.atkBonus || 0));
    if (weapon.durability <= 0) dmg = Math.ceil(dmg / 2);
    if (m.isBoss && weapon.element !== 'none' && weapon.element === m.weakness) {
      dmg = Math.round(dmg * 1.5);
    }
    hits.push(applyHitToMonster(room, player, m, dmg, now));
  }
  if (hits.length) {
    weaponUsed.durability = Math.max(0, weaponUsed.durability - 1);
    sendTo(player, {
      type: 'attack_result', hits, totalExp: player.exp, level: player.level,
      weaponDurability: weaponUsed.durability, weaponMaxDurability: weaponUsed.maxDurability,
    });
  }
}

// 활/마법봉 — 조준 방향으로 투사체를 날림(궁수·힐러 공용)
function spawnProjectile(room, player, angleOffset = 0, opts = {}) {
  const weapon = player.weapon;
  let dmg = roll(player.atk + (weapon.atkBonus || 0) + (player.magic || 0));
  if (weapon.durability <= 0) dmg = Math.ceil(dmg / 2);
  if (opts.dmgMult) dmg = Math.round(dmg * opts.dmgMult);
  weapon.durability = Math.max(0, weapon.durability - 1);
  const angle = player.facing + angleOffset;
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const proj = {
    id: nextProjectileId++, ownerId: player.id,
    x: player.x + dirX * 22, y: player.y + dirY * 22,
    vx: dirX * PROJECTILE_SPEED, vy: dirY * PROJECTILE_SPEED,
    dmg, r: 7, bornAt: Date.now(), maxLife: PROJECTILE_LIFE_MS,
    pierce: !!opts.pierce, hitIds: new Set(),
  };
  room.projectiles.set(proj.id, proj);
  broadcastRoom(room, {
    type: 'projectile_spawn', id: proj.id, x: proj.x, y: proj.y, vx: proj.vx, vy: proj.vy,
    ownerId: player.id, classKey: player.classKey, maxLife: proj.maxLife,
  });
  sendTo(player, { type: 'attack_result', hits: [], totalExp: player.exp, level: player.level, weaponDurability: weapon.durability, weaponMaxDurability: weapon.maxDurability });
}

function updateProjectiles(room, dt, now) {
  if (!room.projectiles || !room.projectiles.size) return;
  for (const proj of [...room.projectiles.values()]) {
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    let hitMonster = null;
    for (const m of room.monsters.values()) {
      if (proj.hitIds && proj.hitIds.has(m.id)) continue;
      if (Math.hypot(m.x - proj.x, m.y - proj.y) <= m.r + proj.r) { hitMonster = m; break; }
    }
    const outOfBounds = proj.x < 0 || proj.x > room.world.w || proj.y < 0 || proj.y > room.world.h;
    if (hitMonster) {
      const owner = [...room.players.values()].find(p => p.id === proj.ownerId);
      if (owner) {
        const hit = applyHitToMonster(room, owner, hitMonster, proj.dmg, now);
        sendTo(owner, { type: 'attack_result', hits: [hit], totalExp: owner.exp, level: owner.level, weaponDurability: owner.weapon.durability, weaponMaxDurability: owner.weapon.maxDurability });
      }
      if (proj.pierce) {
        proj.hitIds.add(hitMonster.id);
        broadcastRoom(room, { type: 'projectile_pierce', id: proj.id, x: proj.x, y: proj.y });
      } else {
        broadcastRoom(room, { type: 'projectile_hit', id: proj.id, x: proj.x, y: proj.y });
        room.projectiles.delete(proj.id);
      }
    } else if (now - proj.bornAt > proj.maxLife || outOfBounds) {
      room.projectiles.delete(proj.id);
    }
  }
}

// ── 직업 스킬 — 슬롯 2개(E/R), 장착한 스킬 키로 실제 효과를 실행 ──
function applyGuardReduction(target, dmg) {
  return (target.guardUntil && Date.now() < target.guardUntil) ? Math.round(dmg * 0.5) : dmg;
}

function runSkill(player, room, skillKey, now) {
  const def = SKILL_DEFS[skillKey];
  if (!def) return;
  if (skillKey === 'dash') {
    const dx = Math.cos(player.facing), dy = Math.sin(player.facing);
    player.x += dx * DASH_DISTANCE;
    player.y += dy * DASH_DISTANCE;
    clampToWorld(player, PLAYER_R, room.world);
    resolveLandmarksCollision(player, PLAYER_R, room);
    clampToWorld(player, PLAYER_R, room.world);
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'dash', x: player.x, y: player.y });
  } else if (skillKey === 'selfHeal') {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + def.healAmount + (player.magic || 0));
    if (player.hp !== before) sendTo(player, { type: 'healed', amount: player.hp - before, hp: player.hp, maxHp: player.maxHp });
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'selfHeal', x: player.x, y: player.y });
  } else if (skillKey === 'healPulse') {
    for (const p of room.players.values()) {
      if (Math.hypot(p.x - player.x, p.y - player.y) > def.healRadius) continue;
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + def.healAmount + (player.magic || 0));
      if (p.hp !== before) sendTo(p, { type: 'healed', amount: p.hp - before, hp: p.hp, maxHp: p.maxHp });
    }
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'healPulse', x: player.x, y: player.y, radius: def.healRadius });
  } else if (skillKey === 'whirlwind') {
    for (const m of room.monsters.values()) {
      if (Math.hypot(m.x - player.x, m.y - player.y) <= 75) applyHitToMonster(room, player, m, roll(player.atk * 1.3), now);
    }
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'whirlwind', x: player.x, y: player.y, radius: 75 });
  } else if (skillKey === 'guard' || skillKey === 'barrier') {
    player.guardUntil = now + 3000;
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: skillKey, x: player.x, y: player.y });
  } else if (skillKey === 'multiShot') {
    for (const off of [-0.3, 0, 0.3]) spawnProjectile(room, player, off, { dmgMult: 0.8 });
  } else if (skillKey === 'piercingShot') {
    spawnProjectile(room, player, 0, { pierce: true, dmgMult: 1.6 });
  } else if (skillKey === 'slowField') {
    for (const m of room.monsters.values()) {
      if (Math.hypot(m.x - player.x, m.y - player.y) <= 160) m.slowUntil = now + 3000;
    }
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'slowField', x: player.x, y: player.y, radius: 160 });
  } else if (skillKey === 'curse523') {
    const radius = 260;
    for (const m of room.monsters.values()) {
      if (Math.hypot(m.x - player.x, m.y - player.y) <= radius) applyHitToMonster(room, player, m, roll(player.atk * 5 + 23), now);
    }
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'curse523', x: player.x, y: player.y, radius });
  }
}

function useSkillSlot(player, room, slot, now) {
  if (room.kind === 'raid' && room.started === false) return;
  const user = player.user;
  const skillKey = user.equippedSkills[slot];
  if (!skillKey) return;
  const def = SKILL_DEFS[skillKey];
  if (!def) return;
  if (!Array.isArray(player.skillCooldownAt)) player.skillCooldownAt = [0, 0];
  if (now - (player.skillCooldownAt[slot] || 0) < def.cooldownMs) return;
  player.skillCooldownAt[slot] = now;
  runSkill(player, room, skillKey, now);
  sendTo(player, { type: 'skill_used', slot, cooldownMs: def.cooldownMs });
}

// ── 메인 루프 ───────────────────────────────────────────
function tick(dt) {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (now < p.stunUntil) continue;
      const input = p.input;
      let dx = 0, dy = 0;
      if (input.up) dy -= 1;
      if (input.down) dy += 1;
      if (input.left) dx -= 1;
      if (input.right) dx += 1;

      const speedMult = now < p.slowUntil ? 0.5 : 1;
      let targetVx = 0, targetVy = 0;
      const hasInput = dx !== 0 || dy !== 0;
      if (hasInput) {
        const len = Math.hypot(dx, dy);
        targetVx = (dx / len) * (p.moveSpeed || SPEED) * speedMult;
        targetVy = (dy / len) * (p.moveSpeed || SPEED) * speedMult;
      }
      const rate = hasInput ? MOVE_ACCEL : MOVE_DECEL;
      p.vx = approach(p.vx, targetVx, rate, dt);
      p.vy = approach(p.vy, targetVy, rate, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      clampToWorld(p, PLAYER_R, room.world);
      resolveLandmarksCollision(p, PLAYER_R, room);
      clampToWorld(p, PLAYER_R, room.world);

      checkPortals(p, room, now);
      checkRaidEntrance(p, room, now);
    }

    updateMonsters(room, dt, now);
    updateProjectiles(room, dt, now);

    const snapshot = JSON.stringify({
      type: 'state',
      players: [...room.players.values()].map(p => ({
        id: p.id, x: round1(p.x), y: round1(p.y),
        facing: p.facing, name: p.name, hp: p.hp, maxHp: p.maxHp, level: p.level, guildTag: p.guildTag || null,
        zoneName: room.kind === 'world' ? regionAt(p.x, p.y).name : null,
        zoneKey: room.kind === 'world' ? regionAt(p.x, p.y).key : room.zoneKey,
      })),
      monsters: [...room.monsters.values()].map(m => ({
        id: m.id, x: round1(m.x), y: round1(m.y),
        kind: m.kind, hp: m.hp, maxHp: m.maxHp, isBoss: !!m.isBoss, isElite: !!m.isElite,
        phase: m.special ? m.special.phase : undefined,
      })),
    });
    for (const p of room.players.values()) {
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(snapshot);
    }
  }
}

// ── 회원가입 / 로그인 ────────────────────────────────────
function handleSignup(ws, msg) {
  const username = String(msg.username || '').trim();
  const password = String(msg.password || '');
  const nickname = String(msg.nickname || '').trim().slice(0, 12);
  if (username.length < 3 || username.length > 20) { sendRaw(ws, { type: 'auth_error', reason: '아이디는 3~20자로 입력해주세요' }); return; }
  if (password.length < 4) { sendRaw(ws, { type: 'auth_error', reason: '비밀번호는 4자 이상이어야 합니다' }); return; }
  if (nickname.length < 2) { sendRaw(ws, { type: 'auth_error', reason: '닉네임은 2자 이상이어야 합니다' }); return; }
  if (users.has(username)) { sendRaw(ws, { type: 'auth_error', reason: '이미 존재하는 아이디입니다' }); return; }
  const user = makeNewUser(username, password, nickname);
  users.set(username, user);
  saveUsers();
  spawnPlayerForUser(ws, user);
}

function handleLogin(ws, msg) {
  const username = String(msg.username || '').trim();
  const password = String(msg.password || '');
  const user = users.get(username);
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
    sendRaw(ws, { type: 'auth_error', reason: '아이디 또는 비밀번호가 올바르지 않습니다' });
    return;
  }
  if (user.online) { sendRaw(ws, { type: 'auth_error', reason: '이미 접속 중인 계정입니다' }); return; }
  spawnPlayerForUser(ws, user);
}

function spawnPlayerForUser(ws, user) {
  const id = nextId++;
  const worldRoom = rooms.get('world');
  const spawn = jitter(TOWN_ENTRY);
  if (!user.equippedSkills) user.equippedSkills = [null, null];
  if (!user.ownedSkills) user.ownedSkills = [];
  if (!user.stats) user.stats = { hp: 0, speed: 0, dmg: 0, magic: 0 };
  if (grantSpecialSkill(user)) saveUsers();
  const player = {
    id, ws, name: user.nickname, username: user.username, user,
    x: spawn.x, y: spawn.y, vx: 0, vy: 0, facing: 0,
    hp: 30, maxHp: 30, atk: 6, moveSpeed: SPEED, magic: 0,
    level: user.level, exp: user.exp,
    gold: user.gold, weapon: user.weapon, inventory: user.inventory,
    lastAttackAt: 0, stunUntil: 0, slowUntil: 0, guardUntil: 0,
    raidEntranceZone: null, activePortalId: null,
    roomId: 'world',
    classKey: user.classKey || 'warrior', skillCooldownAt: [0, 0], guildTag: null,
    input: { up: false, down: false, left: false, right: false },
  };
  recomputeDerivedStats(player);
  player.hp = player.maxHp;
  applyGuildTag(player);
  user.online = true;

  playersByWs.set(ws, player);
  worldRoom.players.set(ws, player);

  const guild = user.guildId ? guilds.get(user.guildId) : null;
  sendTo(player, {
    type: 'auth_ok', username: user.username, nickname: user.nickname,
    hasChosenClass: user.hasChosenClass, classKey: user.classKey,
    level: user.level, gold: user.gold, statPoints: user.statPoints, stats: user.stats,
    ownedSkills: user.ownedSkills, equippedSkills: user.equippedSkills, hasMap: !!user.hasMap, hasSeenTutorial: !!user.hasSeenTutorial,
    guild: guild ? publicGuild(guild) : null, isGuildOwner: !!(guild && guild.ownerUsername === user.username),
  });
  sendTo(player, { type: 'welcome', id, tickMs: 1000 / TICK_RATE, self: { hp: player.hp, maxHp: player.maxHp, level: player.level } });
  sendTo(player, {
    type: 'zone_change', zoneKey: 'capital', zoneName: '대도시',
    x: player.x, y: player.y, world: OVERWORLD,
    landmarks: LANDMARKS, portals: WORLD_PORTALS, obstacles: OBSTACLES, decorations: DECORATIONS, isRaid: false,
  });
  sendInventory(player);
  console.log(`+ ${player.name}(${user.username}) connected`);
}

// ── 정적 파일(클라이언트) + WebSocket을 한 포트에서 같이 서빙 — 배포 시 서비스 하나로 끝나게 ──
const CLIENT_DIR = fileURLToPath(new URL('../client/', import.meta.url));
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};
function serveStatic(req, res) {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.join(CLIENT_DIR, reqPath === '/' ? 'index.html' : reqPath);
  if (!filePath.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}
const httpServer = http.createServer(serveStatic);
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => console.log(`PixelRealm listening on http://localhost:${PORT} (client + ws 같이 서빙)`));

wss.on('connection', ws => {
  console.log('+ connection opened (awaiting login)');

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const player = playersByWs.get(ws);
    if (!player) {
      if (msg.type === 'signup') handleSignup(ws, msg);
      else if (msg.type === 'login') handleLogin(ws, msg);
      return;
    }

    if (msg.type === 'input') {
      player.input.up = !!msg.up;
      player.input.down = !!msg.down;
      player.input.left = !!msg.left;
      player.input.right = !!msg.right;
    } else if (msg.type === 'aim' && typeof msg.facing === 'number') {
      player.facing = msg.facing;
    } else if (msg.type === 'attack') {
      handleAttack(player);
    } else if (msg.type === 'select_class' && CLASS_DEFS[msg.classKey]) {
      const def = CLASS_DEFS[msg.classKey];
      const user = player.user;
      if (user.hasChosenClass && user.classKey !== msg.classKey) {
        if (player.gold < RECLASS_COST) {
          sendTo(player, { type: 'class_change_denied', reason: `골드가 부족합니다 (직업 변경 비용 ${RECLASS_COST}G)` });
          return;
        }
        player.gold -= RECLASS_COST;
        user.gold = player.gold;
      }
      user.classKey = msg.classKey;
      user.hasChosenClass = true;
      const starter = starterSkillFor(msg.classKey);
      user.ownedSkills = starter ? [starter] : [];
      user.equippedSkills = [starter || null, null];
      grantSpecialSkill(user);
      player.classKey = msg.classKey;
      recomputeDerivedStats(player);
      player.hp = player.maxHp;
      player.skillCooldownAt = [0, 0];
      saveUsers();
      sendTo(player, {
        type: 'class_selected', classKey: msg.classKey, hp: player.hp, maxHp: player.maxHp, gold: player.gold,
        ownedSkills: user.ownedSkills, equippedSkills: user.equippedSkills,
      });
    } else if (msg.type === 'allocate_stat' && STAT_INCREMENTS[msg.stat]) {
      const user = player.user;
      if ((user.statPoints || 0) <= 0) return;
      user.statPoints--;
      user.stats[msg.stat] = (user.stats[msg.stat] || 0) + 1;
      recomputeDerivedStats(player);
      saveUsers();
      sendTo(player, { type: 'stats_update', stats: user.stats, statPoints: user.statPoints, maxHp: player.maxHp, atk: player.atk, hp: player.hp });
    } else if (msg.type === 'skill_buy' && SKILL_DEFS[msg.skillKey]) {
      const def = SKILL_DEFS[msg.skillKey];
      const user = player.user;
      if (def.classKey !== player.classKey) return;
      if (user.ownedSkills.includes(msg.skillKey)) { sendTo(player, { type: 'shop_error', reason: '이미 보유한 스킬입니다' }); return; }
      if (player.gold < def.price) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
      player.gold -= def.price;
      user.gold = player.gold;
      user.ownedSkills.push(msg.skillKey);
      saveUsers();
      sendTo(player, { type: 'skill_shop_update', ownedSkills: user.ownedSkills, equippedSkills: user.equippedSkills, gold: player.gold });
    } else if (msg.type === 'equip_skill' && (msg.slot === 0 || msg.slot === 1)) {
      const user = player.user;
      if (msg.skillKey && !user.ownedSkills.includes(msg.skillKey)) return;
      user.equippedSkills[msg.slot] = msg.skillKey || null;
      saveUsers();
      sendTo(player, { type: 'skill_shop_update', ownedSkills: user.ownedSkills, equippedSkills: user.equippedSkills, gold: player.gold });
    } else if (msg.type === 'skill' && (msg.slot === 0 || msg.slot === 1)) {
      const room = rooms.get(player.roomId);
      if (room) useSkillSlot(player, room, msg.slot, Date.now());
    } else if (msg.type === 'guild_create') {
      const user = player.user;
      if (user.guildId) { sendTo(player, { type: 'guild_error', reason: '이미 길드에 가입되어 있습니다' }); return; }
      const name = String(msg.name || '').trim().slice(0, 20);
      if (name.length < 2) { sendTo(player, { type: 'guild_error', reason: '길드 이름은 2자 이상이어야 합니다' }); return; }
      if ([...guilds.values()].some(g => g.name === name)) { sendTo(player, { type: 'guild_error', reason: '이미 존재하는 길드 이름입니다' }); return; }
      const id = 'g' + Date.now() + Math.floor(Math.random() * 1000);
      const guild = { id, name, ownerUsername: user.username, approvalRequired: !!msg.approvalRequired, members: [user.username], pending: [], createdAt: Date.now() };
      guilds.set(id, guild);
      user.guildId = id;
      saveGuilds(); saveUsers();
      applyGuildTag(player);
      sendTo(player, { type: 'guild_status', guild: publicGuild(guild), isOwner: true, members: guild.members, pending: guild.pending });
    } else if (msg.type === 'guild_list') {
      sendTo(player, { type: 'guild_list', guilds: [...guilds.values()].map(publicGuild) });
    } else if (msg.type === 'guild_join') {
      const guild = guilds.get(msg.guildId);
      const user = player.user;
      if (!guild) return;
      if (user.guildId) { sendTo(player, { type: 'guild_error', reason: '이미 길드에 가입되어 있습니다' }); return; }
      if (guild.approvalRequired) {
        if (!guild.pending.includes(user.username)) guild.pending.push(user.username);
        saveGuilds();
        sendTo(player, { type: 'guild_error', reason: '가입 신청을 보냈습니다. 길드장의 승인을 기다려주세요' });
      } else {
        guild.members.push(user.username);
        user.guildId = guild.id;
        saveGuilds(); saveUsers();
        applyGuildTag(player);
        sendTo(player, { type: 'guild_status', guild: publicGuild(guild), isOwner: false, members: guild.members, pending: [] });
      }
    } else if (msg.type === 'guild_approve') {
      const user = player.user;
      const guild = user.guildId ? guilds.get(user.guildId) : null;
      if (!guild || guild.ownerUsername !== user.username) return;
      const idx = guild.pending.indexOf(msg.username);
      if (idx === -1) return;
      guild.pending.splice(idx, 1);
      guild.members.push(msg.username);
      const targetUser = users.get(msg.username);
      if (targetUser) targetUser.guildId = guild.id;
      saveGuilds(); saveUsers();
      for (const p2 of playersByWs.values()) {
        if (p2.username === msg.username) { applyGuildTag(p2); sendTo(p2, { type: 'guild_status', guild: publicGuild(guild), isOwner: false, members: guild.members, pending: [] }); }
      }
      sendTo(player, { type: 'guild_status', guild: publicGuild(guild), isOwner: true, members: guild.members, pending: guild.pending });
    } else if (msg.type === 'guild_reject') {
      const user = player.user;
      const guild = user.guildId ? guilds.get(user.guildId) : null;
      if (!guild || guild.ownerUsername !== user.username) return;
      guild.pending = guild.pending.filter(u => u !== msg.username);
      saveGuilds();
      sendTo(player, { type: 'guild_status', guild: publicGuild(guild), isOwner: true, members: guild.members, pending: guild.pending });
    } else if (msg.type === 'guild_invite') {
      const user = player.user;
      const guild = user.guildId ? guilds.get(user.guildId) : null;
      if (!guild || guild.ownerUsername !== user.username) return;
      const targetUsername = String(msg.username || '').trim();
      const targetUser = users.get(targetUsername);
      if (!targetUser) { sendTo(player, { type: 'guild_error', reason: '존재하지 않는 유저입니다' }); return; }
      if (targetUser.guildId) { sendTo(player, { type: 'guild_error', reason: '이미 길드가 있는 유저입니다' }); return; }
      targetUser.guildId = guild.id;
      guild.members.push(targetUsername);
      saveGuilds(); saveUsers();
      for (const p2 of playersByWs.values()) {
        if (p2.username === targetUsername) { applyGuildTag(p2); sendTo(p2, { type: 'guild_status', guild: publicGuild(guild), isOwner: false, members: guild.members, pending: [] }); }
      }
      sendTo(player, { type: 'guild_status', guild: publicGuild(guild), isOwner: true, members: guild.members, pending: guild.pending });
    } else if (msg.type === 'guild_leave') {
      const user = player.user;
      const guild = user.guildId ? guilds.get(user.guildId) : null;
      if (!guild) return;
      guild.members = guild.members.filter(u => u !== user.username);
      if (guild.ownerUsername === user.username) {
        guilds.delete(guild.id);
        for (const m of guild.members) { const u = users.get(m); if (u) u.guildId = null; }
        for (const p2 of playersByWs.values()) {
          if (guild.members.includes(p2.username)) { applyGuildTag(p2); sendTo(p2, { type: 'guild_status', guild: null }); }
        }
      }
      user.guildId = null;
      saveGuilds(); saveUsers();
      applyGuildTag(player);
      sendTo(player, { type: 'guild_status', guild: null });
    } else if (msg.type === 'shop_buy') {
      const wcat = WEAPON_CATALOG[msg.itemKey];
      const pcat = POTION_CATALOG[msg.itemKey];
      if (wcat) {
        if (player.gold < wcat.price) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
        player.gold -= wcat.price;
        player.inventory.push({
          id: 'w' + (nextItemId++), kind: 'weapon', key: msg.itemKey, name: wcat.name,
          atkBonus: wcat.atkBonus, durability: wcat.maxDurability, maxDurability: wcat.maxDurability,
          element: wcat.element, enhanceLevel: 0,
        });
        syncGold(player);
        sendInventory(player);
      } else if (pcat) {
        if (player.gold < pcat.price) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
        player.gold -= pcat.price;
        const existing = player.inventory.find(i => i.kind === 'potion' && i.key === msg.itemKey);
        if (existing) existing.qty++;
        else player.inventory.push({ id: 'p' + (nextItemId++), kind: 'potion', key: msg.itemKey, name: pcat.name, heal: pcat.heal, qty: 1 });
        syncGold(player);
        sendInventory(player);
      } else if (msg.itemKey === MAP_ITEM_KEY) {
        if (player.user.hasMap) { sendTo(player, { type: 'shop_error', reason: '이미 구매했습니다' }); return; }
        if (player.gold < MAP_PRICE) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
        player.gold -= MAP_PRICE;
        player.user.hasMap = true;
        syncGold(player);
        saveUsers();
        sendTo(player, { type: 'map_purchased' });
        sendInventory(player);
      }
    } else if (msg.type === 'equip_weapon') {
      const idx = player.inventory.findIndex(i => i.id === msg.itemId && i.kind === 'weapon');
      if (idx === -1) return;
      const newWeapon = player.inventory[idx];
      player.inventory.splice(idx, 1);
      player.inventory.push(player.weapon);
      player.weapon = newWeapon;
      sendInventory(player);
    } else if (msg.type === 'use_item') {
      const idx = player.inventory.findIndex(i => i.id === msg.itemId && i.kind === 'potion');
      if (idx === -1) return;
      const item = player.inventory[idx];
      player.hp = Math.min(player.maxHp, player.hp + item.heal);
      item.qty--;
      if (item.qty <= 0) player.inventory.splice(idx, 1);
      sendTo(player, { type: 'healed', amount: item.heal, hp: player.hp, maxHp: player.maxHp });
      sendInventory(player);
    } else if (msg.type === 'blacksmith_enhance') {
      const cost = 30 + (player.weapon.enhanceLevel || 0) * 20;
      if (player.gold < cost) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
      player.gold -= cost;
      player.weapon.atkBonus += 1;
      player.weapon.enhanceLevel = (player.weapon.enhanceLevel || 0) + 1;
      syncGold(player);
      sendInventory(player);
    } else if (msg.type === 'blacksmith_repair') {
      const missing = player.weapon.maxDurability - player.weapon.durability;
      if (missing <= 0) return;
      const cost = missing * 2;
      if (player.gold < cost) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
      player.gold -= cost;
      player.weapon.durability = player.weapon.maxDurability;
      syncGold(player);
      sendInventory(player);
    } else if (msg.type === 'sell_item') {
      const room = rooms.get(player.roomId);
      if (!room) return;
      const inShop = room.portals.some(p => p.action.type === 'shop' &&
        player.x >= p.x && player.x <= p.x + p.w && player.y >= p.y && player.y <= p.y + p.h);
      if (!inShop) return;
      const idx = player.inventory.findIndex(i => i.id === msg.itemId && i.kind === 'material');
      if (idx === -1) return;
      const item = player.inventory[idx];
      player.gold += item.price * item.qty;
      player.inventory.splice(idx, 1);
      syncGold(player);
      sendInventory(player);
    } else if (msg.type === 'tutorial_done') {
      player.user.hasSeenTutorial = true;
      saveUsers();
    } else if (msg.type === 'market_sell' || msg.type === 'market_buy' || msg.type === 'market_cancel') {
      const room = rooms.get(player.roomId);
      if (!room) return;
      const inMarket = room.portals.some(p => p.action.type === 'market' &&
        player.x >= p.x && player.x <= p.x + p.w && player.y >= p.y && player.y <= p.y + p.h);
      if (!inMarket) return;

      if (msg.type === 'market_sell') {
        const idx = player.inventory.findIndex(i => i.id === msg.itemId);
        if (idx === -1) return;
        const item = player.inventory[idx];
        const price = Math.max(1, Math.round(Number(msg.price) || 0));
        if (!price) { sendTo(player, { type: 'shop_error', reason: '가격을 입력해주세요' }); return; }
        let listQty, listedItem;
        if (item.kind === 'material' || item.kind === 'potion') {
          listQty = Math.max(1, Math.min(item.qty, Math.round(Number(msg.qty) || 1)));
          listedItem = { kind: item.kind, key: item.key, name: item.name };
          if (item.kind === 'potion') listedItem.heal = item.heal;
          if (item.kind === 'material') listedItem.priceHint = item.price;
          item.qty -= listQty;
          if (item.qty <= 0) player.inventory.splice(idx, 1);
        } else if (item.kind === 'weapon') {
          listQty = 1;
          listedItem = { kind: 'weapon', key: item.key, name: item.name, atkBonus: item.atkBonus, durability: item.durability, maxDurability: item.maxDurability, element: item.element, enhanceLevel: item.enhanceLevel };
          player.inventory.splice(idx, 1);
        } else {
          return;
        }
        const id = 'mk' + (nextMarketId++);
        marketListings.set(id, { id, sellerUsername: player.username, sellerNickname: player.name, ...listedItem, qty: listQty, price, listedAt: Date.now() });
        saveMarket();
        sendInventory(player);
        sendMarketData(player);
      } else if (msg.type === 'market_buy') {
        const listing = marketListings.get(msg.listingId);
        if (!listing) { sendTo(player, { type: 'shop_error', reason: '이미 판매되었거나 취소된 아이템입니다' }); return; }
        if (listing.sellerUsername === player.username) { sendTo(player, { type: 'shop_error', reason: '자신이 등록한 아이템은 구매할 수 없습니다' }); return; }
        if (player.gold < listing.price) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
        player.gold -= listing.price;
        syncGold(player);
        grantMarketItem(player, listing);
        marketListings.delete(listing.id);
        saveMarket();
        const seller = users.get(listing.sellerUsername);
        if (seller) {
          seller.gold = (seller.gold || 0) + listing.price;
          saveUsers();
          const sellerPlayer = [...playersByWs.values()].find(p => p.username === listing.sellerUsername);
          if (sellerPlayer) { sellerPlayer.gold = seller.gold; sendInventory(sellerPlayer); }
        }
        sendInventory(player);
        sendMarketData(player);
      } else if (msg.type === 'market_cancel') {
        const listing = marketListings.get(msg.listingId);
        if (!listing || listing.sellerUsername !== player.username) return;
        grantMarketItem(player, listing);
        marketListings.delete(listing.id);
        saveMarket();
        sendInventory(player);
        sendMarketData(player);
      }
    } else if (msg.type === 'raid_start') {
      const room = rooms.get(player.roomId);
      if (!room || room.kind !== 'world' || !player.raidEntranceZone) return;
      const mode = msg.mode === 'party' ? 'party' : 'solo';
      const raidRoom = createRaidRoom(player.raidEntranceZone, mode, player.id, player.name);
      movePlayerToRoom(player, raidRoom.id);
    } else if (msg.type === 'raid_room_start') {
      const room = rooms.get(player.roomId);
      if (!room || room.kind !== 'raid' || room.mode !== 'party' || room.started) return;
      if (room.hostId !== player.id) return;
      room.started = true;
      broadcastRoom(room, { type: 'raid_started' });
      broadcastRaidRoomInfo(room);
    } else if (msg.type === 'quest_accept' && QUEST_DEFS[msg.questId]) {
      const user = player.user;
      if (!user.quests) user.quests = {};
      if (user.quests[msg.questId]) return;
      user.quests[msg.questId] = { progress: 0, turnedIn: false };
      saveUsers();
      sendNpcDialogue(player, QUEST_DEFS[msg.questId].npcId);
    } else if (msg.type === 'quest_turn_in' && QUEST_DEFS[msg.questId]) {
      const user = player.user;
      const quest = QUEST_DEFS[msg.questId];
      const q = user.quests && user.quests[msg.questId];
      if (!q || q.turnedIn || q.progress < quest.targetCount) return;
      q.turnedIn = true;
      player.gold += quest.rewardGold;
      player.exp += quest.rewardExp;
      applyLevelUps(player);
      syncGold(player);
      saveUsers();
      sendInventory(player);
      sendTo(player, { type: 'quest_complete', questName: quest.name, rewardGold: quest.rewardGold, rewardExp: quest.rewardExp });
      sendNpcDialogue(player, quest.npcId);
    } else if (msg.type === 'raid_join') {
      const raidRoom = rooms.get(msg.raidId);
      if (!raidRoom || raidRoom.kind !== 'raid' || raidRoom.mode !== 'party') return;
      if (raidRoom.players.size >= MAX_RAID_PLAYERS) {
        sendTo(player, { type: 'raid_join_failed', reason: '인원이 가득 찼습니다' });
        return;
      }
      movePlayerToRoom(player, raidRoom.id);
    } else if (msg.type === 'raid_leave') {
      const room = rooms.get(player.roomId);
      if (!room || room.kind !== 'raid') return;
      movePlayerToRoom(player, 'world', jitter(TOWN_ENTRY));
    } else if (msg.type === 'chat') {
      const now = Date.now();
      if (now - (player.lastChatAt || 0) < 400) return;
      if (typeof msg.text !== 'string') return;
      const text = msg.text.trim().slice(0, 120);
      if (!text) return;
      player.lastChatAt = now;
      const room = rooms.get(player.roomId);
      if (!room) return;
      broadcastRoom(room, { type: 'chat', id: player.id, name: player.name, text });
    }
  });

  ws.on('close', () => {
    const player = playersByWs.get(ws);
    if (!player) { console.log('- connection closed before login'); return; }
    const room = rooms.get(player.roomId);
    if (room) {
      room.players.delete(ws);
      for (const m of room.monsters.values()) {
        if (m.targetId === player.id) { m.mode = 'wander'; m.targetId = null; }
      }
      if (room.kind === 'raid' && room.mode === 'party' && room.hostId === player.id && room.players.size > 0) {
        const next = [...room.players.values()][0];
        room.hostId = next.id; room.hostName = next.name;
      }
      broadcastRaidRoomInfo(room);
      maybeCleanupRaid(room);
    }
    if (player.user) {
      player.user.online = false;
      player.user.gold = player.gold;
      player.user.level = player.level;
      player.user.exp = player.exp;
      saveUsers();
    }
    playersByWs.delete(ws);
    console.log(`- ${player.name} disconnected`);
  });
});

const intervalMs = 1000 / TICK_RATE;
setInterval(() => tick(intervalMs / 1000), intervalMs);
