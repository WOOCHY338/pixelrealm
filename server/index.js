import { WebSocketServer } from 'ws';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';

const PORT = process.env.PORT || 8765;
const TICK_RATE = 30;
// 오픈월드 스냅샷은 TICK_RATE / WORLD_SNAPSHOT_EVERY 번(초당 15번)만 전송, 몬스터는 플레이어 기준 이 범위 안만
const WORLD_SNAPSHOT_EVERY = 2;
const SNAPSHOT_VIEW_HALF_W = 1400;
const SNAPSHOT_VIEW_HALF_H = 900;
let snapshotTick = 0;
// 진짜 오픈월드처럼 — 지역 하나하나와 지역 사이 거리를 전부 2배로 키움
const WORLD_SCALE = 2;
const OVERWORLD = { w: 4800 * WORLD_SCALE, h: 4800 * WORLD_SCALE, wallThickness: 24 };
const RAID_WORLD = { w: 1400, h: 1000, wallThickness: 24 };
const PLAYER_R = 14;
const MONSTER_R = 12;
const SPEED = 290; // 340은 너무 빨라서 살짝 낮춤(340 → 290)
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

  // 특정 계정 전용 특수 스킬 — 상점에서 구매 불가, 로그인 시 자동 지급(spawnPlayerForUser)
  curse523: { name: '523의 저주', classKey: null, price: 0, cooldownMs: 15000, desc: '주변 모든 적에게 저주를 내려 강력한 피해를 입힌다', special: true },
  relicNogeon: { name: '노건도스의 비보', classKey: null, price: 0, cooldownMs: 14000, desc: '주변 모든 적에게 강력한 피해를 입히고 자신의 체력을 회복한다', special: true },
};
// 조건에 맞는 계정에 자동 지급되는 특수 스킬 목록 — nickname/username 중 지정된 조건을 전부 만족해야 지급됨
const SPECIAL_SKILLS = [
  { nickname: '마이콜작손', skillKey: 'curse523' },
  { username: '궁수급', nickname: '노건', skillKey: 'relicNogeon' },
];
// 클래스(재)선택 시 ownedSkills/equippedSkills가 통째로 초기화되므로 그 이후 항상 다시 호출해 보장한다
// 두 스킬 슬롯이 이미 다 차 있어도(기존 계정이 스킬 상점에서 이미 2개를 장착해둔 경우) 슬롯1을 덮어써서라도 항상 장착되게 함 —
// 그렇지 않으면 ownedSkills에만 조용히 추가되고 실제로는 쓸 수 없는 채로 남는 버그가 있었음
function grantSpecialSkill(user) {
  let granted = false;
  for (const s of SPECIAL_SKILLS) {
    if (s.nickname && user.nickname !== s.nickname) continue;
    if (s.username && user.username !== s.username) continue;
    if (!user.ownedSkills.includes(s.skillKey)) user.ownedSkills.push(s.skillKey);
    if (!user.equippedSkills.includes(s.skillKey)) {
      if (user.equippedSkills[0] == null) user.equippedSkills[0] = s.skillKey;
      else if (user.equippedSkills[1] == null) user.equippedSkills[1] = s.skillKey;
      else user.equippedSkills[1] = s.skillKey;
    }
    granted = true;
  }
  return granted;
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

// v3.5 레벨 초기화 — 필요 경험치 공식이 바뀌면서 기존 계정을 모두 레벨 1로 되돌린다.
// 그동안 레벨업으로 얻은 스텟(찍은 능력치 + 남은 포인트)은 그대로 두고, 보상으로 스텟 포인트 30개를 추가 지급.
// 전용 컬럼이 없어서 기록은 quests(jsonb)에 남긴다 — QUEST_DEFS에 없는 키라 퀘스트 로직은 무시함.
// 값은 초기화 전 기록 { level, exp, statPoints, at } (신규 계정은 true — 초기화 대상 아님)
const LEVEL_RESET_V35 = '_levelResetV35';
const LEVEL_RESET_V35_BONUS = 30;
const LEVEL_RESET_V35_AT = '2026-09-28';
// 첫 배포 때 기록 없이 true로만 표시된 26개 계정 — 당시 서버 로그에서 복구한 초기화 전 [레벨, EXP, 스텟포인트].
// 저장소가 공개라 아이디 대신 해시로 보관
const LEVEL_RESET_V35_LOG = {
  "56d6a2c1dd112cc2": [1, 0, 0],
  "91b65d256b328c93": [11, 30, 10],
  "5b0f6937d3fa09c7": [20, 144, 5],
  "6e4678285a8166ff": [1, 0, 0],
  "ce4893b73f1ee80d": [2, 8, 1],
  "b6ecae820b3c4759": [7, 34, 3],
  "55ff3618c7253bb9": [38, 775, 0],
  "fa5f94cb9eca528a": [1, 0, 0],
  "52460e74b34f4a82": [10, 127, 0],
  "cdba7344f0300e91": [1, 0, 0],
  "2f5c640f08689e75": [1, 12, 0],
  "47b062962ffc93f2": [1, 10, 0],
  "a1c5fa4dccf99ea9": [4, 15, 3],
  "cdc93d234bb71569": [17, 24, 2],
  "630b8f0607285f92": [27, 160, 0],
  "ee4b5a0fa2b51fc3": [1, 0, 0],
  "bbc7a7809f486a15": [1, 0, 0],
  "11781cf973423020": [4, 25, 0],
  "945699da5940401e": [28, 185, 4],
  "ccaf6203d0eca9f7": [4, 1, 3],
  "9cf778ad0c1dd19d": [1, 0, 0],
  "d4ce4dd3e5420bff": [1, 0, 0],
  "98677d7f6c349102": [1, 0, 0],
  "d6dafccbe2df26c3": [3, 45, 2],
  "ab47e8e8d39cc92f": [1, 0, 0],
  "51a93eb334e97750": [9, 82, 8],
};
function levelResetV35Key(username) {
  return crypto.createHash('sha256').update('pixelrealm-v35:' + username).digest('hex').slice(0, 16);
}
{
  let resetCount = 0, restoredCount = 0;
  for (const u of users.values()) {
    if (!u.quests) u.quests = {};
    const mark = u.quests[LEVEL_RESET_V35];
    if (mark === true) {
      const rec = LEVEL_RESET_V35_LOG[levelResetV35Key(u.username)];
      if (rec) {
        u.quests[LEVEL_RESET_V35] = { level: rec[0], exp: rec[1], statPoints: rec[2], at: LEVEL_RESET_V35_AT };
        restoredCount++;
      }
      continue;
    }
    if (mark) continue;
    console.log(`[v3.5 레벨 초기화] ${u.username}(${u.nickname}) Lv.${u.level} EXP ${u.exp} 스텟포인트 ${u.statPoints || 0} → Lv.1, 스텟포인트 +${LEVEL_RESET_V35_BONUS}`);
    u.quests[LEVEL_RESET_V35] = { level: u.level, exp: u.exp, statPoints: u.statPoints || 0, at: LEVEL_RESET_V35_AT };
    u.level = 1;
    u.exp = 0;
    u.statPoints = (u.statPoints || 0) + LEVEL_RESET_V35_BONUS;
    resetCount++;
  }
  if (resetCount || restoredCount) {
    saveUsers();
    // 무중단 배포 중엔 이전 서버가 종료되면서 옛 데이터로 전체 저장을 덮어쓸 수 있음 — 이전 서버가 내려간 뒤 한 번 더 저장
    setTimeout(saveUsers, 30000);
    setTimeout(saveUsers, 90000);
    console.log(`[v3.5 레벨 초기화] 초기화 ${resetCount}개, 기록 복구 ${restoredCount}개 계정 처리 완료`);
  }
}
// 운영자 요청 — 특정 계정의 속도 스텟을 0으로 되돌리고, 찍었던 만큼 스텟 포인트로 환급(계정당 한 번).
// 기록 { speed, at }은 quests._speedReset에 남김. 공개 저장소라 아이디는 해시로 지정
const SPEED_RESET_KEY = '_speedReset';
const SPEED_RESET_TARGETS = new Set(['ace5870f96704d6f']);
{
  let count = 0;
  for (const u of users.values()) {
    if (!u.stats || (u.quests && u.quests[SPEED_RESET_KEY])) continue;
    const key = crypto.createHash('sha256').update('pixelrealm-speedreset:' + u.username).digest('hex').slice(0, 16);
    if (!SPEED_RESET_TARGETS.has(key)) continue;
    const speed = u.stats.speed || 0;
    if (!u.quests) u.quests = {};
    u.quests[SPEED_RESET_KEY] = { speed, at: '2026-09-28' };
    u.stats.speed = 0;
    u.statPoints = (u.statPoints || 0) + speed;
    console.log(`[속도 스텟 초기화] ${u.username}(${u.nickname}) 속도 ${speed} → 0, 스텟포인트 +${speed}`);
    count++;
  }
  if (count) { saveUsers(); setTimeout(saveUsers, 30000); setTimeout(saveUsers, 90000); }
}
function levelResetV35Record(user) {
  const rec = user.quests && user.quests[LEVEL_RESET_V35];
  return rec && typeof rec === 'object' ? rec : null;
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
    quests: { [LEVEL_RESET_V35]: true }, // 신규 계정은 v3.5 레벨 초기화 대상이 아님
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
    player.inventory.push({ id: 'w' + (nextItemId++), kind: 'weapon', key: listing.key, name: listing.name, atkBonus: listing.atkBonus, element: listing.element, enhanceLevel: listing.enhanceLevel });
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
// 1→2: 40, 5→6: 525, 10→11: 1592 — 레벨이 오를수록 가파르게 증가
function requiredExp(level) { return Math.round(40 * Math.pow(level, 1.6)); }
// 레벨 L에 도달할 때 받는 스텟 포인트 — Lv.2: 1, Lv.3: 2, Lv.4: 3 … 레벨마다 1씩 증가
function statPointsForLevel(level) { return level - 1; }

function applyLevelUps(player) {
  const startLevel = player.level;
  let required = requiredExp(player.level);
  while (player.exp >= required) {
    player.exp -= required;
    player.level++;
    player.user.statPoints = (player.user.statPoints || 0) + statPointsForLevel(player.level);
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
  goblin: { name: '고블린', hp: 22, atk: 5, exp: 15, chaseSpeed: 85, wanderSpeed: 45, aggroRange: 150, deaggroRange: 230, r: MONSTER_R },
  treant: { name: '덩굴괴물', hp: 28, atk: 5, exp: 16, chaseSpeed: 55, wanderSpeed: 30, aggroRange: 140, deaggroRange: 220, r: MONSTER_R + 1 },
  naga: { name: '물의 정령', hp: 20, atk: 5, exp: 15, chaseSpeed: 75, wanderSpeed: 40, aggroRange: 150, deaggroRange: 230, r: MONSTER_R },
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
  goblinChief: { name: '고블린 우두머리', baseKind: 'goblin', hp: 100, atk: 10, exp: 58, chaseSpeed: 90, wanderSpeed: 48, aggroRange: 170, deaggroRange: 260, r: MONSTER_R + 4 },
  ancientTreant: { name: '늙은 덩굴괴물', baseKind: 'treant', hp: 135, atk: 10, exp: 68, chaseSpeed: 60, wanderSpeed: 32, aggroRange: 160, deaggroRange: 250, r: MONSTER_R + 5 },
  nagaPriestess: { name: '나가 여사제', baseKind: 'naga', hp: 112, atk: 10, exp: 62, chaseSpeed: 80, wanderSpeed: 42, aggroRange: 170, deaggroRange: 260, r: MONSTER_R + 4 },
};
const ELITE_RESPAWN_DELAY_MS = 60000;

// ── 레이드 보스 (v3.6) ──────────────────────────────────
// 보스마다 고유 패턴 3개를 번갈아 사용하고, 체력 50% 이하에서 분노(패턴 강화 + 공격 간격 단축 + 이동속도 증가).
// 모든 공격은 "위험 지대(hazard)" — 바닥에 예고 표시가 먼저 뜨고 채워지면 발동. 클라이언트는 스냅샷의 hazards로 그림.
// 보스는 슈퍼아머: 플레이어 공격에 경직·넉백되지 않음.
// attacks: BOSS_ATTACKS의 키 목록, gapMs: 공격 사이 추적 시간, color: 위험 지대 색
const BOSS_TYPES = {
  iceSlimeKing: {
    name: '얼음 슬라임 킹', hp: 1500, atk: 16, exp: 320, chaseSpeed: 70, aggroRange: 999, deaggroRange: 999999, r: 22,
    weakness: 'fire', color: '#8fd0ec', gapMs: 1500, attacks: ['iceShardRain', 'frostRings', 'iceLances'],
  },
  flameAlphaWolf: {
    name: '불꽃 들개 대장', hp: 1700, atk: 18, exp: 360, chaseSpeed: 115, aggroRange: 999, deaggroRange: 999999, r: 20,
    weakness: 'ice', color: '#ff7a3a', gapMs: 1300, attacks: ['flameDashes', 'flameRoar', 'flameDashes', 'emberRain'],
  },
  swampFrogKing: {
    name: '독늪 개구리왕', hp: 1450, atk: 15, exp: 300, chaseSpeed: 65, aggroRange: 999, deaggroRange: 999999, r: 22,
    weakness: 'fire', color: '#7ee07a', gapMs: 1400, attacks: ['poisonLob', 'tongueLash', 'leapSlam'],
  },
  canyonScorpionKing: {
    name: '모래폭풍 전갈왕', hp: 1650, atk: 17, exp: 330, chaseSpeed: 105, aggroRange: 999, deaggroRange: 999999, r: 21,
    weakness: 'ice', color: '#e8b84f', gapMs: 1300, attacks: ['sandStar', 'tailStrikes', 'sandStar', 'burrowAmbush'],
  },
  frostBatLord: {
    name: '서리 박쥐 군주', hp: 1500, atk: 15, exp: 320, chaseSpeed: 120, aggroRange: 999, deaggroRange: 999999, r: 20,
    weakness: 'fire', color: '#b4a8ff', gapMs: 1200, attacks: ['sonicBurst', 'blinkStrike', 'spiralBarrage'],
  },
  magmaGolem: {
    name: '용암 골렘', hp: 2000, atk: 20, exp: 380, chaseSpeed: 50, aggroRange: 999, deaggroRange: 999999, r: 24,
    weakness: 'ice', color: '#ff5a2a', gapMs: 1600, attacks: ['lavaGrid', 'quake', 'meteors'],
  },
  ruinGuardian: {
    name: '폐허의 수호자', hp: 1850, atk: 18, exp: 360, chaseSpeed: 55, aggroRange: 999, deaggroRange: 999999, r: 23,
    weakness: 'fire', color: '#c8a8ff', gapMs: 1400, attacks: ['crossLaser', 'rockFall', 'guardianPulse'],
  },
  goblinWarlord: {
    name: '고블린 대장', hp: 1600, atk: 17, exp: 340, chaseSpeed: 100, aggroRange: 999, deaggroRange: 999999, r: 21,
    weakness: 'ice', color: '#ffb84f', gapMs: 1300, attacks: ['bombBarrage', 'berserkSpin', 'warCry'],
  },
  ancientTreantLord: {
    name: '고대 정령수', hp: 1900, atk: 18, exp: 370, chaseSpeed: 50, aggroRange: 999, deaggroRange: 999999, r: 24,
    weakness: 'fire', color: '#9ad65a', gapMs: 1500, attacks: ['rootEruption', 'thornPrison', 'natureWrath'],
  },
  abyssalNaga: {
    name: '심연의 나가', hp: 1750, atk: 17, exp: 350, chaseSpeed: 110, aggroRange: 999, deaggroRange: 999999, r: 22,
    weakness: 'ice', color: '#6cc4e8', gapMs: 1300, attacks: ['tidalWave', 'waterJets', 'abyssCurse'],
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
  goblin: { name: '고블린 이빨', price: 6 },
  treant: { name: '덩굴 조각', price: 7 },
  naga: { name: '정령의 비늘', price: 6 },
  goblinWarlord: { name: '대장의 완장', price: 66 },
  ancientTreantLord: { name: '정령수의 뿌리', price: 72 },
  abyssalNaga: { name: '심연의 눈물', price: 68 },
  goblinChief: { name: '우두머리의 곤봉', price: 30 },
  ancientTreant: { name: '늙은 나이테', price: 34 },
  nagaPriestess: { name: '여사제의 비늘', price: 31 },
};

// ── 오픈월드 지역 정의 — 사용자가 그려준 지도(인접 관계) 그대로 재배치(v3.1) ──
// 대도시(좌하단) — 들꽃초원 — 황혼언덕 — 메마른협곡(좌상단) 세로줄
// 변방도시(상단) — 마을 — 그린숲 — 물의신전 세로줄(가운데, 마을/그린숲은 변방도시 소속·물의신전은 대도시 소속 필드)
// 불타는사막 — 축축한습지 세로줄(가운데-우측), 얼어붙은봉우리 — 잊혀진폐허 세로줄(우측)
function S(n) { return n * WORLD_SCALE; }
const CAPITAL_BOX = { xMin: S(100), xMax: S(1300), yMin: S(3600), yMax: S(4700) };        // 좌하단
const FIELD1_BOX = { xMin: S(100), xMax: S(1300), yMin: S(2400), yMax: S(3600) };        // 들꽃 초원
const FIELD2_BOX = { xMin: S(100), xMax: S(1300), yMin: S(1300), yMax: S(2400) };        // 황혼 언덕
const FIELD4_BOX = { xMin: S(100), xMax: S(1300), yMin: S(100), yMax: S(1300) };         // 메마른 협곡(좌상단)

const SECOND_CITY_BOX = { xMin: S(1300), xMax: S(2500), yMin: S(100), yMax: S(1300) };    // 변방 도시(상단)
const VILLAGE_BOX = { xMin: S(1300), xMax: S(2000), yMin: S(1300), yMax: S(1900) };       // 마을(소형 필드)
const GREEN_FOREST_BOX = { xMin: S(1300), xMax: S(2500), yMin: S(1900), yMax: S(3000) };  // 그린 숲
const WATER_TEMPLE_BOX = { xMin: S(1300), xMax: S(2500), yMin: S(3000), yMax: S(4700) };  // 물의 신전

const FIELD6_BOX = { xMin: S(2500), xMax: S(3700), yMin: S(100), yMax: S(2600) };        // 불타는 사막
const FIELD3_BOX = { xMin: S(2500), xMax: S(3700), yMin: S(2600), yMax: S(4700) };       // 축축한 습지

const FIELD5_BOX = { xMin: S(3700), xMax: S(4700), yMin: S(100), yMax: S(1700) };        // 얼어붙은 봉우리
const FIELD7_BOX = { xMin: S(3700), xMax: S(4700), yMin: S(1700), yMax: S(4700) };       // 잊혀진 폐허

function inBox(x, y, b) { return x >= b.xMin && x < b.xMax && y >= b.yMin && y < b.yMax; }

function regionAt(x, y) {
  if (inBox(x, y, CAPITAL_BOX)) return { key: 'capital', name: '대도시' };
  if (inBox(x, y, SECOND_CITY_BOX)) return { key: 'frontier', name: '변방 도시' };
  if (inBox(x, y, VILLAGE_BOX)) return { key: 'village', name: '마을' };
  if (inBox(x, y, GREEN_FOREST_BOX)) return { key: 'greenforest', name: '그린 숲' };
  if (inBox(x, y, WATER_TEMPLE_BOX)) return { key: 'watertemple', name: '물의 신전' };
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
  field1: { name: '들꽃 초원', monsterTypes: ['slime', 'mushroom'], monsterCount: 14, bossType: 'iceSlimeKing', eliteType: 'slimeChief', box: FIELD1_BOX },
  field2: { name: '황혼 언덕', monsterTypes: ['wolf', 'wolf', 'slime'], monsterCount: 14, bossType: 'flameAlphaWolf', eliteType: 'wolfAlpha', box: FIELD2_BOX },
  field3: { name: '축축한 습지', monsterTypes: ['frog', 'slime'], monsterCount: 14, bossType: 'swampFrogKing', eliteType: 'bogQueen', box: FIELD3_BOX },
  field4: { name: '메마른 협곡', monsterTypes: ['scorpion', 'mushroom'], monsterCount: 14, bossType: 'canyonScorpionKing', eliteType: 'sandstalker', box: FIELD4_BOX },
  field5: { name: '얼어붙은 봉우리', monsterTypes: ['bat', 'slime'], monsterCount: 14, bossType: 'frostBatLord', eliteType: 'frostReaver', box: FIELD5_BOX },
  field6: { name: '불타는 사막', monsterTypes: ['scorpion', 'golem'], monsterCount: 14, bossType: 'magmaGolem', eliteType: 'duneWarden', box: FIELD6_BOX },
  field7: { name: '잊혀진 폐허', monsterTypes: ['bat', 'golem'], monsterCount: 14, bossType: 'ruinGuardian', eliteType: 'ruinSentinel', box: FIELD7_BOX },
  village: { name: '마을', monsterTypes: ['goblin', 'slime'], monsterCount: 6, bossType: 'goblinWarlord', eliteType: 'goblinChief', box: VILLAGE_BOX },
  greenforest: { name: '그린 숲', monsterTypes: ['treant', 'mushroom'], monsterCount: 13, bossType: 'ancientTreantLord', eliteType: 'ancientTreant', box: GREEN_FOREST_BOX },
  watertemple: { name: '물의 신전', monsterTypes: ['naga', 'frog'], monsterCount: 14, bossType: 'abyssalNaga', eliteType: 'nagaPriestess', box: WATER_TEMPLE_BOX },
};

const TOWN_ENTRY = { x: S(700), y: S(4330) }; // 대도시 — 기본 스폰 지점
const FRONTIER_ENTRY = { x: S(1900), y: S(880) }; // 변방 도시 — 홈타운으로 설정 시 스폰 지점
const RAID_ENTRY = { x: 700, y: 780 }; // 레이드 아레나는 별도 월드라 스케일 영향 없음

// ── 홈타운 — 분수 근처에서 설정하면 이후 로그인·리스폰·레이드 이탈 시 그 도시로 스폰 ──
const HOME_TOWNS = {
  capital: { name: '대도시', entry: TOWN_ENTRY },
  frontier: { name: '변방 도시', entry: FRONTIER_ENTRY },
};
function homeEntryFor(user) {
  const town = HOME_TOWNS[user.homeTown];
  return town ? town.entry : TOWN_ENTRY;
}

const LANDMARKS = [
  { key: 'capital_fountain', x: S(700), y: S(4150), r: 75, kind: 'fountain' },
  { key: 'frontier_fountain', x: S(1900), y: S(700), r: 58, kind: 'fountain' },
  { key: 'capital_hometown', x: S(700), y: S(4150), r: 90, kind: 'hometown_shrine', townKey: 'capital' },
  { key: 'frontier_hometown', x: S(1900), y: S(700), r: 90, kind: 'hometown_shrine', townKey: 'frontier' },
  { key: 'water_temple_fountain', x: S(1900), y: S(3850), r: 46, kind: 'fountain' }, // 물의 신전 — 장식용 분수
  { key: 'field1_raid', x: S(700), y: S(3000), r: 40, kind: 'raid_entrance', zoneKey: 'field1' },
  { key: 'field2_raid', x: S(700), y: S(1850), r: 40, kind: 'raid_entrance', zoneKey: 'field2' },
  { key: 'field3_raid', x: S(3100), y: S(3650), r: 40, kind: 'raid_entrance', zoneKey: 'field3' },
  { key: 'field4_raid', x: S(700), y: S(700), r: 40, kind: 'raid_entrance', zoneKey: 'field4' },
  { key: 'field5_raid', x: S(4200), y: S(900), r: 40, kind: 'raid_entrance', zoneKey: 'field5' },
  { key: 'field6_raid', x: S(3100), y: S(1350), r: 40, kind: 'raid_entrance', zoneKey: 'field6' },
  { key: 'field7_raid', x: S(4200), y: S(3200), r: 40, kind: 'raid_entrance', zoneKey: 'field7' },
  { key: 'village_raid', x: S(1650), y: S(1600), r: 40, kind: 'raid_entrance', zoneKey: 'village' },
  { key: 'greenforest_raid', x: S(1900), y: S(2450), r: 40, kind: 'raid_entrance', zoneKey: 'greenforest' },
  { key: 'watertemple_raid', x: S(1900), y: S(3300), r: 40, kind: 'raid_entrance', zoneKey: 'watertemple' },
];

// ── NPC / 퀘스트 — NPC 하나당 고정 퀘스트 하나(체인 없음), 완료 후에도 다시 받을 수는 없음 ──
const QUEST_DEFS = {
  q_slime: { name: '초원의 슬라임 사냥', npcId: 'npc_capital_1', monsterKind: 'slime', targetCount: 5, rewardGold: 80, rewardExp: 30, desc: '들꽃 초원에 나타나는 슬라임을 5마리 처치해주게.' },
  q_wolf: { name: '언덕의 들개 사냥', npcId: 'npc_capital_2', monsterKind: 'wolf', targetCount: 4, rewardGold: 100, rewardExp: 40, desc: '황혼 언덕의 들개들이 늘어나고 있네. 4마리만 처치해주게.' },
  q_frog: { name: '습지의 개구리 사냥', npcId: 'npc_frontier_1', monsterKind: 'frog', targetCount: 5, rewardGold: 90, rewardExp: 35, desc: '축축한 습지의 개구리를 5마리 잡아다 주게.' },
  q_scorpion: { name: '협곡의 전갈 사냥', npcId: 'npc_frontier_2', monsterKind: 'scorpion', targetCount: 4, rewardGold: 100, rewardExp: 40, desc: '메마른 협곡의 전갈이 말썽이야. 4마리만 처치해주게.' },
};
const NPC_DEFS = {
  npc_capital_1: { name: '촌장', x: S(300), y: S(4400) },
  npc_capital_2: { name: '용병', x: S(1100), y: S(4400) },
  npc_frontier_1: { name: '약초꾼', x: S(1500), y: S(900) },
  npc_frontier_2: { name: '사냥꾼', x: S(2100), y: S(900) },
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
  ...layoutRow(S(700), S(3700), [
    { id: 'raid_field1', label: '초원 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field1' } },
    { id: 'raid_field2', label: '언덕 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field2' } },
    { id: 'raid_field3', label: '습지 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field3' } },
    { id: 'raid_watertemple', label: '물의 신전 레이드 접수처', action: { type: 'raid_list', zoneKey: 'watertemple' } },
  ], 140, 55, 16),
  { id: 'shop_capital', x: S(200), y: S(4100), w: 140, h: 60, label: '상점', action: { type: 'shop' } },
  { id: 'blacksmith_capital', x: S(1060), y: S(4100), w: 140, h: 60, label: '대장간', action: { type: 'blacksmith' } },
  { id: 'skillshop_capital', x: S(200), y: S(4210), w: 140, h: 60, label: '스킬 상점', action: { type: 'skill_shop' } },
  { id: 'guildhall_capital', x: S(1060), y: S(4210), w: 140, h: 60, label: '마을 회관', action: { type: 'guild_hall' } },
  { id: 'market_capital', x: S(630), y: S(4210), w: 140, h: 60, label: '거래장터', action: { type: 'market' } },
  // 변방 도시
  ...layoutRow(S(1900), S(250), [
    { id: 'raid_field4', label: '협곡 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field4' } },
    { id: 'raid_field5', label: '봉우리 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field5' } },
    { id: 'raid_field6', label: '사막 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field6' } },
    { id: 'raid_field7', label: '폐허 레이드 접수처', action: { type: 'raid_list', zoneKey: 'field7' } },
    { id: 'raid_village', label: '마을 레이드 접수처', action: { type: 'raid_list', zoneKey: 'village' } },
    { id: 'raid_greenforest', label: '그린 숲 레이드 접수처', action: { type: 'raid_list', zoneKey: 'greenforest' } },
  ], 140, 55, 16),
  { id: 'shop_frontier', x: S(1380), y: S(650), w: 140, h: 60, label: '상점', action: { type: 'shop' } },
  { id: 'blacksmith_frontier', x: S(2240), y: S(650), w: 140, h: 60, label: '대장간', action: { type: 'blacksmith' } },
  { id: 'skillshop_frontier', x: S(1380), y: S(760), w: 140, h: 60, label: '스킬 상점', action: { type: 'skill_shop' } },
  { id: 'guildhall_frontier', x: S(2240), y: S(760), w: 140, h: 60, label: '마을 회관', action: { type: 'guild_hall' } },
  { id: 'market_frontier', x: S(1810), y: S(760), w: 140, h: 60, label: '거래장터', action: { type: 'market' } },
  // NPC — 퀘스트를 주는 마을 주민들
  { id: 'npc_capital_1', x: S(250), y: S(4370), w: 100, h: 60, label: '촌장', action: { type: 'npc', npcId: 'npc_capital_1' } },
  { id: 'npc_capital_2', x: S(1050), y: S(4370), w: 100, h: 60, label: '용병', action: { type: 'npc', npcId: 'npc_capital_2' } },
  { id: 'npc_frontier_1', x: S(1450), y: S(870), w: 100, h: 60, label: '약초꾼', action: { type: 'npc', npcId: 'npc_frontier_1' } },
  { id: 'npc_frontier_2', x: S(2050), y: S(870), w: 100, h: 60, label: '사냥꾼', action: { type: 'npc', npcId: 'npc_frontier_2' } },
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
// gates: 인접한 신규 필드(마을/그린 숲/물의 신전)로 이어지는 흙길이 성벽을 통과하는 지점 — 그 앞도 성문처럼 비움
function ringObstacles(box, kind, count, inset, radius, gates) {
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
    const tooCloseGate = (gates || []).some(g => Math.hypot(x - g.x, y - g.y) < g.r);
    if (tooClosePortal || tooCloseLandmark || tooCloseGate) continue;
    list.push({ x, y, r: radius, kind });
  }
  return list;
}

// 마을/그린 숲/물의 신전이 도시와 맞닿는 경계 지점 — 성벽에 이 지점을 성문처럼 뚫어서 필드↔도시 이동 통로를 보장
const FRONTIER_SOUTH_GATES = [
  { x: (VILLAGE_BOX.xMin + VILLAGE_BOX.xMax) / 2, y: SECOND_CITY_BOX.yMax, r: 110 },      // 마을 방향 성문
  { x: (GREEN_FOREST_BOX.xMin + GREEN_FOREST_BOX.xMax) / 2, y: SECOND_CITY_BOX.yMax, r: 110 }, // 그린 숲 방향 성문
];
const CAPITAL_EAST_GATES = [
  { x: CAPITAL_BOX.xMax, y: (WATER_TEMPLE_BOX.yMin + WATER_TEMPLE_BOX.yMax) / 2, r: 110 }, // 물의 신전 방향 성문
];

const OBSTACLES = [
  // 지역이 2배로 커진(WORLD_SCALE) 뒤로 필드가 휑해 보여서 밀도를 다시 채움(면적 4배 → 대략 2.5배로 보강)
  ...scatterObstacles(FIELD1_BOX, 'tree', 28),
  ...scatterObstacles(FIELD2_BOX, 'tree', 20),
  ...scatterObstacles(FIELD3_BOX, 'tree', 26),
  ...scatterObstacles(FIELD4_BOX, 'rock', 26),
  ...scatterObstacles(FIELD5_BOX, 'tree', 23),
  ...scatterObstacles(FIELD6_BOX, 'rock', 26),
  ...scatterObstacles(FIELD7_BOX, 'rock', 26),
  // 구조물(부서진 기둥/울타리 등) — 지역마다 조금씩 섞어 넣음
  ...scatterObstacles(FIELD1_BOX, 'structure', 5),
  ...scatterObstacles(FIELD2_BOX, 'structure', 5),
  ...scatterObstacles(FIELD3_BOX, 'structure', 5),
  ...scatterObstacles(FIELD4_BOX, 'structure', 7),
  ...scatterObstacles(FIELD5_BOX, 'structure', 5),
  ...scatterObstacles(FIELD6_BOX, 'structure', 7),
  ...scatterObstacles(FIELD7_BOX, 'structure', 9),
  // 지역별 테마 구조물 — 다채로운 볼거리 추가
  ...scatterObstacles(FIELD1_BOX, 'fence', 7),        // 들꽃 초원 — 목장 울타리
  ...scatterObstacles(FIELD2_BOX, 'fence', 5),
  ...scatterObstacles(FIELD2_BOX, 'cairn', 5),        // 황혼 언덕 — 돌무덤
  ...scatterObstacles(FIELD3_BOX, 'totem', 7),        // 축축한 습지 — 부족 토템
  ...scatterObstacles(FIELD4_BOX, 'campfire', 5),     // 메마른 협곡 — 버려진 야영지
  ...scatterObstacles(FIELD5_BOX, 'cairn', 7),        // 얼어붙은 봉우리 — 돌무덤
  ...scatterObstacles(FIELD6_BOX, 'cactus', 9),       // 불타는 사막 — 선인장
  ...scatterObstacles(FIELD7_BOX, 'ruinWall', 7),     // 잊혀진 폐허 — 무너진 벽
  // 도시 — 민가·시장 좌판을 훨씬 촘촘하게 채워 넣어 진짜 대도시처럼 붐비게, 외곽엔 성벽을 둘러 마을이 아니라 도시처럼
  ...scatterObstacles(CAPITAL_BOX, 'house', 32, 30),
  ...scatterObstacles(CAPITAL_BOX, 'stall', 12, 26),
  ...scatterObstacles(SECOND_CITY_BOX, 'house', 20, 30),
  ...scatterObstacles(SECOND_CITY_BOX, 'stall', 8, 26),
  ...ringObstacles(CAPITAL_BOX, 'wallSeg', 32, 20, 34, CAPITAL_EAST_GATES),
  ...ringObstacles(SECOND_CITY_BOX, 'wallSeg', 24, 20, 34, FRONTIER_SOUTH_GATES),
  // 마을/그린 숲/물의 신전 — 지도 개편으로 새로 생긴 필드(몬스터·엘리트·레이드 보스 포함)
  ...scatterObstacles(VILLAGE_BOX, 'house', 5, 28),          // 마을 — 작은 민가 몇 채
  ...scatterObstacles(GREEN_FOREST_BOX, 'tree', 30),         // 그린 숲 — 이름값 하는 빽빽한 숲
  ...scatterObstacles(GREEN_FOREST_BOX, 'structure', 3),
  ...scatterObstacles(WATER_TEMPLE_BOX, 'totem', 6),         // 물의 신전 — 유적 느낌의 토템·폐벽
  ...scatterObstacles(WATER_TEMPLE_BOX, 'ruinWall', 5),
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

const FIELD_KEYS = ['field1', 'field2', 'field3', 'field4', 'field5', 'field6', 'field7', 'village', 'greenforest', 'watertemple'];
const FIELD_BOXES = {
  field1: FIELD1_BOX, field2: FIELD2_BOX, field3: FIELD3_BOX, field4: FIELD4_BOX, field5: FIELD5_BOX, field6: FIELD6_BOX, field7: FIELD7_BOX,
  village: VILLAGE_BOX, greenforest: GREEN_FOREST_BOX, watertemple: WATER_TEMPLE_BOX,
};
// 필드마다 소재지 역할을 하는 도시 — 레이드 접수처가 있는 도시와 동일하게 매핑
const FIELD_HUB_BOX = {
  field1: CAPITAL_BOX, field2: CAPITAL_BOX, field3: CAPITAL_BOX,
  field4: SECOND_CITY_BOX, field5: SECOND_CITY_BOX, field6: SECOND_CITY_BOX, field7: SECOND_CITY_BOX,
  village: SECOND_CITY_BOX, greenforest: SECOND_CITY_BOX, watertemple: CAPITAL_BOX,
};

const DECORATIONS = [
  ...scatterDecorations(FIELD1_BOX, 'flower', 48),
  ...scatterDecorations(FIELD2_BOX, 'flower', 24),
  ...scatterDecorations(FIELD2_BOX, 'dirt', 14),
  ...scatterDecorations(FIELD3_BOX, 'flower', 28),
  ...scatterDecorations(FIELD4_BOX, 'dirt', 34),
  ...scatterDecorations(FIELD5_BOX, 'flower', 24),
  ...scatterDecorations(FIELD6_BOX, 'dirt', 34),
  ...scatterDecorations(FIELD7_BOX, 'dirt', 28),
  ...scatterDecorations(VILLAGE_BOX, 'flower', 10),
  ...scatterDecorations(GREEN_FOREST_BOX, 'flower', 16),
  ...scatterDecorations(WATER_TEMPLE_BOX, 'dirt', 20),
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
  silverSword: { name: '실버 소드', atkBonus: 2, element: 'none', price: 50 },
  goldSword: { name: '골드 소드', atkBonus: 4, element: 'none', price: 100 },
  flameSword: { name: '화염검', atkBonus: 2, element: 'fire', price: 80 },
  frostSword: { name: '빙결검', atkBonus: 2, element: 'ice', price: 80 },
  steelSword: { name: '강철검', atkBonus: 4, element: 'none', price: 120 },
  diamondSword: { name: '다이아 소드', atkBonus: 6, element: 'none', price: 150 },
  radiantSword: { name: '레디언트 소드', atkBonus: 9, element: 'none', price: 250 },
  windBreathSword: { name: '바람의 숨결', atkBonus: 12, element: 'none', price: 350 },
  masterySword: { name: '마스터리 소드', atkBonus: 16, element: 'none', price: 500 },

  // 궁수 전용 — 용사 검과 동일한 등급별 스탯, 강철 등급 없이 8종 + 언덕의 전설(바람의 숨결 자리)
  silverBow: { name: '실버 활', atkBonus: 2, element: 'none', price: 50 },
  goldBow: { name: '골드 활', atkBonus: 4, element: 'none', price: 100 },
  flameBow: { name: '화염 활', atkBonus: 2, element: 'fire', price: 80 },
  frostBow: { name: '빙결 활', atkBonus: 2, element: 'ice', price: 80 },
  diamondBow: { name: '다이아 활', atkBonus: 6, element: 'none', price: 150 },
  radiantBow: { name: '레디언트 활', atkBonus: 9, element: 'none', price: 250 },
  hillLegendBow: { name: '언덕의 전설 활', atkBonus: 12, element: 'none', price: 350 },
  masteryBow: { name: '마스터리 활', atkBonus: 16, element: 'none', price: 500 },

  // 힐러 전용 — 강철 등급 자리에 레전더리 마법봉, 마스터리 등급 없이 바람의 마법봉이 최고 등급
  silverWand: { name: '실버 마법봉', atkBonus: 2, element: 'none', price: 50 },
  goldWand: { name: '골드 마법봉', atkBonus: 4, element: 'none', price: 100 },
  flameWand: { name: '화염 마법봉', atkBonus: 2, element: 'fire', price: 80 },
  frostWand: { name: '빙결 마법봉', atkBonus: 2, element: 'ice', price: 80 },
  legendaryWand: { name: '레전더리 마법봉', atkBonus: 4, element: 'none', price: 120 },
  diamondWand: { name: '다이아 마법봉', atkBonus: 6, element: 'none', price: 150 },
  radiantWand: { name: '레디언트 마법봉', atkBonus: 9, element: 'none', price: 250 },
  windBreathWand: { name: '바람의 마법봉', atkBonus: 12, element: 'none', price: 350 },
};
// 직업별로 상점에서 살 수 있는 무기 목록 — 용사는 기존 그대로, 궁수/힐러는 각자 전용 무기 계열
const CLASS_WEAPON_KEYS = {
  warrior: ['silverSword', 'goldSword', 'flameSword', 'frostSword', 'steelSword', 'diamondSword', 'radiantSword', 'windBreathSword', 'masterySword'],
  archer: ['silverBow', 'goldBow', 'flameBow', 'frostBow', 'diamondBow', 'radiantBow', 'hillLegendBow', 'masteryBow'],
  healer: ['silverWand', 'goldWand', 'flameWand', 'frostWand', 'legendaryWand', 'diamondWand', 'radiantWand', 'windBreathWand'],
};
const POTION_CATALOG = {
  healthPotion: { name: '체력 물약', heal: 20, price: 15 },
};
const MAP_ITEM_KEY = 'worldMap';
const MAP_PRICE = 150;
function shopCatalogFor(classKey) {
  const weaponKeys = CLASS_WEAPON_KEYS[classKey] || CLASS_WEAPON_KEYS.warrior;
  return [
    ...weaponKeys.map(key => {
      const w = WEAPON_CATALOG[key];
      return { key, kind: 'weapon', name: w.name, price: w.price, atkBonus: w.atkBonus, element: w.element };
    }),
    ...Object.entries(POTION_CATALOG).map(([key, p]) => ({ key, kind: 'potion', name: p.name, price: p.price, heal: p.heal })),
    { key: MAP_ITEM_KEY, kind: 'map', name: '세계 지도', price: MAP_PRICE },
  ];
}

let nextItemId = 1;
function makeStarterWeapon() {
  return { id: 'w' + (nextItemId++), kind: 'weapon', key: 'starter', name: '낡은 검', atkBonus: 0, element: 'none', enhanceLevel: 0 };
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
  const hp = Math.round(t.hp * BOSS_HP_SCALE);
  return {
    id: nextMonsterId++, kind: bossTypeKey, name: t.name, isBoss: true, weakness: t.weakness,
    x: RAID_WORLD.w / 2, y: RAID_WORLD.h / 2, hp, maxHp: hp, atk: Math.round(t.atk * BOSS_DAMAGE_SCALE), exp: t.exp, r: t.r,
    chaseSpeed: t.chaseSpeed, wanderSpeed: 0, aggroRange: t.aggroRange, deaggroRange: t.deaggroRange,
    mode: 'wander', targetId: null, lastAttackAt: 0, stunUntil: 0,
    wanderDir: { x: 0, y: 0 }, wanderUntil: 0,
    special: { phase: 'idle', nextAt: Date.now() + 2500, busyUntil: 0, attackIdx: 0, queue: [], dash: null, enraged: false, retargetAt: 0, speedMult: 1, speedUntil: 0 },
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
  village: { obstacles: [['house', 3], ['fence', 2]], decorations: [['flower', 8]] },
  greenforest: { obstacles: [['tree', 6], ['structure', 2]], decorations: [['flower', 10]] },
  watertemple: { obstacles: [['totem', 4], ['ruinWall', 3]], decorations: [['dirt', 8]] },
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
    players: new Map(), monsters: new Map([[boss.id, boss]]), projectiles: new Map(), hazards: new Map(), boss,
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
    sendTo(player, { type: 'shop_open', catalog: shopCatalogFor(player.classKey), gold: player.gold, hasMap: !!player.user.hasMap });
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

function checkHomeTownEntrance(player, room, now) {
  if (room.kind !== 'world') {
    if (player.homeTownPromptZone) { player.homeTownPromptZone = null; sendTo(player, { type: 'hometown_prompt', show: false }); }
    return;
  }
  let insideTown = null;
  for (const lm of room.landmarks) {
    if (lm.kind !== 'hometown_shrine') continue;
    if (Math.hypot(player.x - lm.x, player.y - lm.y) < lm.r) { insideTown = lm.townKey; break; }
  }
  if (insideTown && player.homeTownPromptZone !== insideTown) {
    player.homeTownPromptZone = insideTown;
    sendTo(player, {
      type: 'hometown_prompt', show: true, townKey: insideTown, townName: HOME_TOWNS[insideTown].name,
      isCurrent: (player.user.homeTown || 'capital') === insideTown,
    });
  } else if (!insideTown && player.homeTownPromptZone) {
    player.homeTownPromptZone = null;
    sendTo(player, { type: 'hometown_prompt', show: false });
  }
}

// ── 전투 ────────────────────────────────────────────────
function handlePlayerDefeated(room, target, dmg) {
  target.vx = 0; target.vy = 0; target.stunUntil = 0; target.slowUntil = 0;
  if (room.kind === 'raid') {
    target.hp = target.maxHp;
    sendTo(target, { type: 'player_hit', damage: dmg, hp: target.hp, maxHp: target.maxHp, x: target.x, y: target.y, stunMs: 0, defeated: true });
    movePlayerToRoom(target, 'world', jitter(homeEntryFor(target.user)));
  } else {
    const sp = jitter(homeEntryFor(target.user));
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

// ── 레이드 보스 AI / 위험 지대 (v3.6) ─────────────────────
let nextHazardId = 1;
const BOSS_ENRAGE_HP_RATIO = 0.5;
const BOSS_RETARGET_MS = 6000;
// v3.6.1 난이도 완화 — 공격이 너무 몰아쳐서 파티로도 어렵다는 피드백: 피해·공격 빈도·분노 강화폭을 낮춤
// v3.7 대폭 하향 — 피해 절반, 쉬는 시간 2배, 체력 40% 감소, 맞았을 때 경직 절반, 분노 강화폭 축소
const BOSS_DAMAGE_SCALE = 0.5;   // 위험 지대·접촉 피해 배율
const BOSS_GAP_SCALE = 2.0;      // 공격 사이 쉬는 시간 배율
const BOSS_HP_SCALE = 0.6;       // 보스 체력 배율
const BOSS_STUN_SCALE = 0.5;     // 위험 지대에 맞았을 때 경직 시간 배율
const BOSS_ENRAGE_GAP = 0.85;    // 분노 시 쉬는 시간(평소 대비)
const BOSS_ENRAGE_DAMAGE = 1.05; // 분노 시 위험 지대 피해 배율
const BOSS_ENRAGE_SPEED = 1.15;  // 분노 시 이동속도 배율

function arenaClamp(x, y, pad = 40) {
  return { x: Math.max(pad, Math.min(RAID_WORLD.w - pad, x)), y: Math.max(pad, Math.min(RAID_WORLD.h - pad, y)) };
}
function randomArenaPoint(pad = 70) {
  return { x: pad + Math.random() * (RAID_WORLD.w - pad * 2), y: pad + Math.random() * (RAID_WORLD.h - pad * 2) };
}
function bossPlayers(room) { return [...room.players.values()]; }
function findRoomPlayer(room, id) { return [...room.players.values()].find(p => p.id === id) || null; }
function angleTo(from, to) { return Math.atan2(to.y - from.y, to.x - from.x); }

// shape: 'circle'(x,y,r) | 'ring'(x,y, 안쪽 r2 ~ 바깥 r) | 'line'(x,y에서 angle 방향으로 len, 폭 w)
// warnMs 동안 예고만 하고, activeMs 동안 판정 — tickMs가 있으면 장판처럼 그 간격으로 반복 피해
function addHazard(room, boss, h) {
  const now = Date.now();
  const hz = {
    shape: 'circle', x: 0, y: 0, r: 50, r2: 0, angle: 0, len: 0, w: 0, vx: 0, vy: 0,
    warnMs: 800, activeMs: 150, tickMs: 0, dmg: 20, slowMs: 0, stunMs: 200, knock: PLAYER_KNOCKBACK,
    color: BOSS_TYPES[boss.kind].color, consume: false, visualOnly: false,
    followId: null, followUntilMs: 0, anchor: null,
    ...h,
  };
  hz.dmg = Math.round(hz.dmg * BOSS_DAMAGE_SCALE * (boss.special.enraged ? BOSS_ENRAGE_DAMAGE : 1));
  hz.stunMs = Math.round(hz.stunMs * BOSS_STUN_SCALE);
  hz.id = nextHazardId++;
  hz.bornAt = now;
  hz.activeAt = now + hz.warnMs;
  hz.endAt = hz.activeAt + hz.activeMs;
  hz.followEndAt = hz.followUntilMs ? now + hz.followUntilMs : 0;
  hz.hits = new Map();
  room.hazards.set(hz.id, hz);
  return hz;
}

// 맞았으면 밀려날 방향, 아니면 null
function hazardHitDir(h, px, py, pr) {
  const dx = px - h.x, dy = py - h.y;
  if (h.shape === 'circle' || h.shape === 'ring') {
    const d = Math.hypot(dx, dy);
    if (d > h.r + pr) return null;
    if (h.shape === 'ring' && d < h.r2 - pr) return null;
    return d > 0 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
  }
  if (h.shape === 'line') {
    const c = Math.cos(h.angle), s = Math.sin(h.angle);
    const along = dx * c + dy * s, perp = -dx * s + dy * c;
    if (along < -pr || along > h.len + pr || Math.abs(perp) > h.w / 2 + pr) return null;
    const sg = perp >= 0 ? 1 : -1;
    return { x: -s * sg, y: c * sg };
  }
  return null;
}

function hurtPlayer(room, p, rawDmg, dir, o) {
  const now = Date.now();
  const dmg = applyGuardReduction(p, roll(rawDmg));
  p.hp = Math.max(0, p.hp - dmg);
  if (p.hp <= 0) { handlePlayerDefeated(room, p, dmg); return; }
  if (o.knock) {
    p.x += dir.x * o.knock;
    p.y += dir.y * o.knock;
    clampToWorld(p, PLAYER_R, room.world);
    resolveLandmarksCollision(p, PLAYER_R, room);
    clampToWorld(p, PLAYER_R, room.world);
  }
  p.vx = 0; p.vy = 0;
  if (o.slowMs) p.slowUntil = Math.max(p.slowUntil || 0, now + o.slowMs);
  const stunMs = o.stunMs || 0;
  if (stunMs) p.stunUntil = now + stunMs;
  sendTo(p, { type: 'player_hit', damage: dmg, hp: p.hp, maxHp: p.maxHp, x: p.x, y: p.y, stunMs, defeated: false });
}

function updateHazards(room, dt, now) {
  if (!room.hazards || !room.hazards.size) return;
  for (const h of [...room.hazards.values()]) {
    if (now > h.endAt) { room.hazards.delete(h.id); continue; }
    if (h.anchor) { h.x = h.anchor.x; h.y = h.anchor.y; }
    if (h.followId != null && now < h.followEndAt) {
      const p = findRoomPlayer(room, h.followId);
      if (p) { h.x = p.x; h.y = p.y; }
    }
    if (now < h.activeAt || h.visualOnly) continue;
    if (h.vx || h.vy) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.x < -150 || h.x > RAID_WORLD.w + 150 || h.y < -150 || h.y > RAID_WORLD.h + 150) { room.hazards.delete(h.id); continue; }
    }
    for (const p of bossPlayers(room)) {
      const dir = hazardHitDir(h, p.x, p.y, PLAYER_R);
      if (!dir) continue;
      const last = h.hits.get(p.id);
      if (last != null && (!h.tickMs || now - last < h.tickMs)) continue;
      h.hits.set(p.id, now);
      hurtPlayer(room, p, h.dmg, dir, h);
      if (h.consume) { room.hazards.delete(h.id); break; }
    }
  }
}

function later(boss, ms, fn) { boss.special.queue.push({ at: Date.now() + ms, fn }); }

// 탄환 한 발 — 예고 없이 날아가며 처음 맞은 플레이어에게 피해 후 소멸
function bossBullet(room, boss, x, y, angle, speed, o = {}) {
  return addHazard(room, boss, {
    x, y, r: 10, warnMs: 0, activeMs: 4000, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    dmg: 14, knock: 16, stunMs: 120, consume: true, ...o,
  });
}
function castWarn(room, boss, ms) {
  addHazard(room, boss, { x: boss.x, y: boss.y, r: boss.r + 26, warnMs: ms, activeMs: 0, visualOnly: true, anchor: boss });
}

// 각 공격: c = { room, boss, enraged, target } → 보스가 제자리에서 시전하는 시간(ms)을 돌려줌
const BOSS_ATTACKS = {
  // ── 얼음 슬라임 킹 ──
  iceShardRain: {
    name: '얼음 파편 폭우',
    run({ room, boss, enraged }) {
      const waves = enraged ? 5 : 3;
      for (let i = 0; i < waves; i++) {
        later(boss, i * 450, () => {
          for (const p of bossPlayers(room)) addHazard(room, boss, { x: p.x, y: p.y, r: 55, warnMs: 800, dmg: 20, slowMs: 1500 });
          for (let k = 0; k < (enraged ? 3 : 2); k++) { const pt = randomArenaPoint(); addHazard(room, boss, { x: pt.x, y: pt.y, r: 55, warnMs: 900, dmg: 20, slowMs: 1500 }); }
        });
      }
      return 600;
    },
  },
  frostRings: {
    name: '빙결 파동',
    run({ room, boss, enraged }) {
      const bands = [[0, 90], [90, 180], [180, 270], [270, 370], [370, 480]];
      const x = boss.x, y = boss.y;
      bands.forEach(([r2, r], i) => addHazard(room, boss, { shape: 'ring', x, y, r2, r, warnMs: 700 + i * 300, dmg: 24, slowMs: 2000 }));
      if (enraged) {
        const base = 700 + bands.length * 300 + 500;
        [...bands].reverse().forEach(([r2, r], i) => addHazard(room, boss, { shape: 'ring', x, y, r2, r, warnMs: base + i * 300, dmg: 24, slowMs: 2000 }));
        return base + bands.length * 300;
      }
      return 700 + bands.length * 300;
    },
  },
  iceLances: {
    name: '고드름 창',
    run({ room, boss, enraged }) {
      const volley = () => {
        const target = findRoomPlayer(room, boss.targetId);
        if (!target) return;
        const n = enraged ? 5 : 3, base = angleTo(boss, target);
        for (let i = 0; i < n; i++) {
          addHazard(room, boss, { shape: 'line', x: boss.x, y: boss.y, angle: base + (i - (n - 1) / 2) * 0.35, len: 760, w: 46, warnMs: 750, dmg: 26, stunMs: 300 });
        }
      };
      volley();
      if (enraged) { later(boss, 550, volley); return 1350; }
      return 900;
    },
  },

  // ── 불꽃 들개 대장 ──
  flameDashes: {
    name: '화염 연속 돌진',
    run({ room, boss, enraged }) {
      const count = enraged ? 4 : 3;
      for (let i = 0; i < count; i++) {
        later(boss, i * 850, () => {
          const target = findRoomPlayer(room, boss.targetId);
          if (!target) return;
          const angle = angleTo(boss, target);
          const want = Math.min(480, Math.hypot(target.x - boss.x, target.y - boss.y) + 140);
          const end = arenaClamp(boss.x + Math.cos(angle) * want, boss.y + Math.sin(angle) * want, boss.r + 30);
          const len = Math.hypot(end.x - boss.x, end.y - boss.y);
          const x0 = boss.x, y0 = boss.y;
          addHazard(room, boss, { shape: 'line', x: x0, y: y0, angle, len, w: 60, warnMs: 520, activeMs: 200, dmg: 26, knock: 50, stunMs: 250 });
          later(boss, 520, () => { boss.special.dash = { vx: Math.cos(angle) * len / 0.2, vy: Math.sin(angle) * len / 0.2, until: Date.now() + 200 }; });
          later(boss, 760, () => {
            for (let d = 0; d <= len; d += 55) {
              addHazard(room, boss, { x: x0 + Math.cos(angle) * d, y: y0 + Math.sin(angle) * d, r: 30, warnMs: 0, activeMs: 2600, tickMs: 500, dmg: 8, knock: 0, stunMs: 0 });
            }
          });
        });
      }
      return count * 850 + 150;
    },
  },
  flameRoar: {
    name: '불꽃 포효',
    run({ room, boss, enraged }) {
      const x = boss.x, y = boss.y;
      addHazard(room, boss, { x, y, r: 170, warnMs: 950, dmg: 32, knock: 70, stunMs: 350 });
      addHazard(room, boss, { shape: 'ring', x, y, r2: 170, r: 340, warnMs: 1550, dmg: 28, knock: 50 });
      if (enraged) { addHazard(room, boss, { x, y, r: 170, warnMs: 2150, dmg: 32, knock: 70, stunMs: 350 }); return 2150; }
      return 1550;
    },
  },
  emberRain: {
    name: '불씨 비',
    run({ room, boss, enraged }) {
      const n = enraged ? 13 : 9;
      for (let i = 0; i < n; i++) { const pt = randomArenaPoint(); addHazard(room, boss, { x: pt.x, y: pt.y, r: 48, warnMs: 700 + i * 80, dmg: 18, knock: 30 }); }
      for (const p of bossPlayers(room)) addHazard(room, boss, { x: p.x, y: p.y, r: 60, warnMs: 900, dmg: 22, knock: 40 });
      return 500;
    },
  },

  // ── 독늪 개구리왕 ──
  poisonLob: {
    name: '독 덩어리 투척',
    run({ room, boss, enraged }) {
      const waves = enraged ? 3 : 2;
      for (let i = 0; i < waves; i++) {
        later(boss, i * 700, () => {
          for (const p of bossPlayers(room)) {
            const a = Math.random() * Math.PI * 2, off = Math.random() * 30;
            addHazard(room, boss, { x: p.x + Math.cos(a) * off, y: p.y + Math.sin(a) * off, r: 72, warnMs: 900, activeMs: 3500, tickMs: 600, dmg: 12, slowMs: 1200, knock: 0, stunMs: 0 });
          }
        });
      }
      return 500;
    },
  },
  tongueLash: {
    name: '혀 채찍',
    run({ room, boss, enraged }) {
      const lash = () => {
        for (const p of bossPlayers(room)) addHazard(room, boss, { shape: 'line', x: boss.x, y: boss.y, angle: angleTo(boss, p), len: 700, w: 36, warnMs: 480, dmg: 24, knock: 40, stunMs: 450 });
      };
      lash();
      if (enraged) { later(boss, 650, lash); return 1300; }
      return 700;
    },
  },
  leapSlam: {
    name: '대점프 내려찍기',
    run({ room, boss, enraged }) {
      const leap = (delay) => later(boss, delay, () => {
        const ps = bossPlayers(room);
        const target = findRoomPlayer(room, boss.targetId) || ps[0];
        if (!target) return;
        const pos = arenaClamp(target.x, target.y, boss.r + 30);
        addHazard(room, boss, { x: pos.x, y: pos.y, r: 115, warnMs: 1100, dmg: 36, knock: 80, stunMs: 400 });
        later(boss, 1100, () => { boss.x = pos.x; boss.y = pos.y; });
      });
      leap(0);
      if (enraged) { leap(1300); return 2550; }
      return 1250;
    },
  },

  // ── 모래폭풍 전갈왕 ──
  sandStar: {
    name: '모래 폭풍',
    run({ room, boss, enraged }) {
      const stars = enraged ? 3 : 2;
      for (let k = 0; k < stars; k++) {
        later(boss, k * 650, () => {
          for (let i = 0; i < 8; i++) addHazard(room, boss, { shape: 'line', x: boss.x, y: boss.y, angle: i * Math.PI / 4 + k * Math.PI / 8, len: 950, w: 44, warnMs: 750, dmg: 24, stunMs: 250 });
        });
      }
      return 750 + (stars - 1) * 650 + 100;
    },
  },
  tailStrikes: {
    name: '독침 연타',
    run({ room, boss, enraged }) {
      const n = enraged ? 6 : 4;
      for (let i = 0; i < n; i++) {
        later(boss, i * 330, () => {
          const target = findRoomPlayer(room, boss.targetId);
          if (target) addHazard(room, boss, { x: target.x, y: target.y, r: 62, warnMs: 620, dmg: 26, stunMs: 450 });
        });
      }
      return 400;
    },
  },
  burrowAmbush: {
    name: '잠행 기습',
    run({ room, boss, enraged }) {
      const n = enraged ? 4 : 3;
      for (let i = 0; i < n; i++) {
        later(boss, i * 900, () => {
          for (const p of bossPlayers(room)) addHazard(room, boss, { x: p.x, y: p.y, r: 70, warnMs: 1200, followId: p.id, followUntilMs: 700, dmg: 28, knock: 60, stunMs: 300 });
        });
      }
      later(boss, (n - 1) * 900 + 1200, () => {
        const target = findRoomPlayer(room, boss.targetId);
        if (target) { const pos = arenaClamp(target.x, target.y, boss.r + 30); boss.x = pos.x; boss.y = pos.y; }
      });
      return (n - 1) * 900 + 1300;
    },
  },

  // ── 서리 박쥐 군주 ──
  sonicBurst: {
    name: '초음파 탄막',
    run({ room, boss, enraged }) {
      const waves = enraged ? 3 : 2, n = enraged ? 16 : 12;
      castWarn(room, boss, 500);
      for (let i = 0; i < waves; i++) {
        later(boss, 500 + i * 450, () => {
          for (let j = 0; j < n; j++) bossBullet(room, boss, boss.x, boss.y, (j + i * 0.5) * Math.PI * 2 / n, 240, { dmg: 16 });
        });
      }
      return 500 + waves * 450;
    },
  },
  blinkStrike: {
    name: '순간이동 급습',
    run({ room, boss, enraged }) {
      const n = enraged ? 3 : 2;
      for (let i = 0; i < n; i++) {
        later(boss, i * 1000, () => {
          const target = findRoomPlayer(room, boss.targetId);
          if (!target) return;
          const pos = arenaClamp(target.x, target.y, boss.r + 30);
          addHazard(room, boss, { x: pos.x, y: pos.y, r: 95, warnMs: 750, dmg: 30, knock: 70, stunMs: 350 });
          later(boss, 750, () => {
            boss.x = pos.x; boss.y = pos.y;
            for (let j = 0; j < 8; j++) bossBullet(room, boss, pos.x, pos.y, j * Math.PI / 4, 260, { dmg: 12 });
          });
        });
      }
      return n * 1000 + 100;
    },
  },
  spiralBarrage: {
    name: '나선 탄막',
    run({ room, boss, enraged }) {
      const arms = enraged ? 4 : 3;
      castWarn(room, boss, 500);
      let rot = Math.random() * Math.PI * 2;
      for (let tMs = 500; tMs < 2900; tMs += 170) {
        later(boss, tMs, () => {
          rot += 0.33;
          for (let a = 0; a < arms; a++) bossBullet(room, boss, boss.x, boss.y, rot + a * Math.PI * 2 / arms, 240, { dmg: 14 });
        });
      }
      return 2900;
    },
  },

  // ── 용암 골렘 ──
  lavaGrid: {
    name: '용암 분출',
    run({ room, boss, enraged }) {
      const stripe = 140, cols = Math.ceil(RAID_WORLD.w / stripe), rows = Math.ceil(RAID_WORLD.h / stripe);
      const vertical = (parity, warnMs) => {
        for (let i = parity; i < cols; i += 2) addHazard(room, boss, { shape: 'line', x: i * stripe + stripe / 2, y: 0, angle: Math.PI / 2, len: RAID_WORLD.h, w: stripe, warnMs, activeMs: 200, dmg: 30, knock: 0, stunMs: 300 });
      };
      const horizontal = (parity, warnMs) => {
        for (let j = parity; j < rows; j += 2) addHazard(room, boss, { shape: 'line', x: 0, y: j * stripe + stripe / 2, angle: 0, len: RAID_WORLD.w, w: stripe, warnMs, activeMs: 200, dmg: 30, knock: 0, stunMs: 300 });
      };
      const first = Math.random() < 0.5 ? 0 : 1;
      vertical(first, 1000);
      vertical(1 - first, 2000);
      if (enraged) { horizontal(0, 3000); horizontal(1, 3900); return 1500; }
      return 1200;
    },
  },
  quake: {
    name: '대지진',
    run({ room, boss, enraged }) {
      const x = boss.x, y = boss.y;
      addHazard(room, boss, { shape: 'ring', x, y, r2: 130, r: 1800, warnMs: 1300, dmg: 40, knock: 0, stunMs: 500 });
      addHazard(room, boss, { x, y, r: 130, warnMs: 2000, dmg: 34, knock: 90, stunMs: 300 });
      if (enraged) { addHazard(room, boss, { shape: 'ring', x, y, r2: 130, r: 1800, warnMs: 3000, dmg: 40, knock: 0, stunMs: 500 }); return 3000; }
      return 2000;
    },
  },
  meteors: {
    name: '용암 운석',
    run({ room, boss, enraged }) {
      const spots = bossPlayers(room).map(p => ({ x: p.x, y: p.y }));
      while (spots.length < (enraged ? 7 : 5)) spots.push(randomArenaPoint());
      for (const pt of spots) {
        addHazard(room, boss, { x: pt.x, y: pt.y, r: 105, warnMs: 1400, dmg: 38, knock: 60, stunMs: 300 });
        addHazard(room, boss, { x: pt.x, y: pt.y, r: 80, warnMs: 1400, activeMs: 2500, tickMs: 500, dmg: 10, knock: 0, stunMs: 0 });
      }
      return 600;
    },
  },

  // ── 폐허의 수호자 ──
  crossLaser: {
    name: '십자 레이저',
    run({ room, boss, enraged }) {
      const seq = enraged ? [0, 1, 0, 1] : [0, 1];
      seq.forEach((diag, k) => later(boss, k * 700, () => {
        for (let i = 0; i < 4; i++) addHazard(room, boss, { shape: 'line', x: boss.x, y: boss.y, angle: i * Math.PI / 2 + diag * Math.PI / 4, len: 1100, w: 60, warnMs: 800, dmg: 30, stunMs: 250 });
      }));
      return 800 + (seq.length - 1) * 700 + 100;
    },
  },
  rockFall: {
    name: '추적 낙석',
    run({ room, boss, enraged }) {
      const n = enraged ? 9 : 6;
      for (let i = 0; i < n; i++) {
        later(boss, i * 280, () => {
          const targets = enraged ? bossPlayers(room) : [findRoomPlayer(room, boss.targetId)].filter(Boolean);
          for (const p of targets) addHazard(room, boss, { x: p.x, y: p.y, r: 62, warnMs: 650, dmg: 22, stunMs: 250 });
        });
      }
      return 400;
    },
  },
  guardianPulse: {
    name: '수호자의 파동',
    run({ room, boss, enraged }) {
      const x = boss.x, y = boss.y;
      addHazard(room, boss, { x, y, r: 150, warnMs: 850, dmg: 30, knock: 60, stunMs: 250 });
      addHazard(room, boss, { shape: 'ring', x, y, r2: 250, r: 480, warnMs: 1400, dmg: 30, knock: 40 });
      if (enraged) {
        addHazard(room, boss, { shape: 'ring', x, y, r2: 150, r: 250, warnMs: 1950, dmg: 30, knock: 40 });
        addHazard(room, boss, { shape: 'ring', x, y, r2: 480, r: 1800, warnMs: 1950, dmg: 30, knock: 0 });
        return 2000;
      }
      return 1450;
    },
  },

  // ── 고블린 대장 ──
  bombBarrage: {
    name: '폭탄 투척',
    run({ room, boss, enraged }) {
      const waves = enraged ? 4 : 3;
      for (let i = 0; i < waves; i++) {
        later(boss, i * 500, () => {
          for (const p of bossPlayers(room)) {
            // 한 발은 지금 위치, 분노 시 한 발 더 이동 방향 앞쪽(예측 사격)
            for (let k = 0; k < (enraged ? 2 : 1); k++) {
              const lead = k === 0 ? 0 : 0.9;
              const a = Math.random() * Math.PI * 2, off = Math.random() * 60;
              addHazard(room, boss, { x: p.x + (p.vx || 0) * lead + Math.cos(a) * off, y: p.y + (p.vy || 0) * lead + Math.sin(a) * off, r: 65, warnMs: 1200, dmg: 26, knock: 70, stunMs: 250 });
            }
          }
        });
      }
      return 400;
    },
  },
  berserkSpin: {
    name: '광란의 회전',
    run({ room, boss, enraged }) {
      const spinMs = enraged ? 3600 : 2800;
      addHazard(room, boss, { x: boss.x, y: boss.y, r: 75, warnMs: 600, activeMs: spinMs, tickMs: 400, dmg: 14, knock: 50, stunMs: 0, anchor: boss });
      boss.special.speedMult = 2.2;
      boss.special.speedUntil = Date.now() + 600 + spinMs;
      return 600;
    },
  },
  warCry: {
    name: '전투 함성',
    run({ room, boss }) {
      addHazard(room, boss, { x: boss.x, y: boss.y, r: 230, warnMs: 1000, dmg: 18, knock: 0, stunMs: 900 });
      later(boss, 1000, () => {
        for (const p of bossPlayers(room)) addHazard(room, boss, { x: p.x, y: p.y, r: 70, warnMs: 700, dmg: 26, knock: 70, stunMs: 250 });
      });
      return 1100;
    },
  },

  // ── 고대 정령수 ──
  rootEruption: {
    name: '뿌리 가시',
    run({ room, boss, enraged }) {
      const x0 = boss.x, y0 = boss.y;
      const angles = bossPlayers(room).map(p => angleTo(boss, p));
      if (enraged) for (let k = 0; k < 3; k++) angles.push(Math.random() * Math.PI * 2);
      for (const a of angles) {
        for (let k = 1; k <= 11; k++) {
          later(boss, k * 85, () => addHazard(room, boss, { x: x0 + Math.cos(a) * k * 65, y: y0 + Math.sin(a) * k * 65, r: 42, warnMs: 450, dmg: 22, knock: 30, stunMs: 500 }));
        }
      }
      return 600;
    },
  },
  thornPrison: {
    name: '가시 감옥',
    run({ room, boss, enraged }) {
      for (const p of bossPlayers(room)) {
        addHazard(room, boss, { shape: 'ring', x: p.x, y: p.y, r2: 75, r: 150, warnMs: 700, dmg: 20, slowMs: 1500, knock: 0 });
        addHazard(room, boss, { x: p.x, y: p.y, r: 75, warnMs: 1500, dmg: 34, knock: 60, stunMs: 300 });
        if (enraged) addHazard(room, boss, { shape: 'ring', x: p.x, y: p.y, r2: 150, r: 260, warnMs: 1500, dmg: 20, slowMs: 1500, knock: 0 });
      }
      return 900;
    },
  },
  natureWrath: {
    name: '대자연의 분노',
    run({ room, boss, enraged }) {
      const n = enraged ? 15 : 10;
      for (let i = 0; i < n; i++) { const pt = randomArenaPoint(); addHazard(room, boss, { x: pt.x, y: pt.y, r: 60, warnMs: 1000 + (i % 3) * 250, dmg: 22, knock: 40 }); }
      for (const p of bossPlayers(room)) addHazard(room, boss, { x: p.x, y: p.y, r: 60, warnMs: 1000, dmg: 22, knock: 40 });
      return 600;
    },
  },

  // ── 심연의 나가 ──
  tidalWave: {
    name: '해일',
    run({ room, boss, enraged }) {
      const seg = 100, n = Math.ceil(RAID_WORLD.h / seg), speed = 270;
      const wall = (fromLeft, delay) => {
        const gap = 1 + Math.floor(Math.random() * (n - 3));
        for (let j = 0; j < n; j++) {
          if (j === gap || j === gap + 1) continue;
          addHazard(room, boss, {
            shape: 'line', x: fromLeft ? 30 : RAID_WORLD.w - 30, y: j * seg, angle: Math.PI / 2, len: seg, w: 44,
            vx: fromLeft ? speed : -speed, warnMs: 900 + delay, activeMs: RAID_WORLD.w / speed * 1000, dmg: 30, knock: 50, stunMs: 300,
          });
        }
      };
      const fromLeft = Math.random() < 0.5;
      wall(fromLeft, 0);
      if (enraged) wall(!fromLeft, 1600);
      return 1000;
    },
  },
  waterJets: {
    name: '물줄기 난사',
    run({ room, boss, enraged }) {
      const volleys = enraged ? 4 : 3;
      castWarn(room, boss, 400);
      for (let i = 0; i < volleys; i++) {
        later(boss, 400 + i * 420, () => {
          for (const p of bossPlayers(room)) {
            const base = angleTo(boss, p);
            for (let k = -2; k <= 2; k++) bossBullet(room, boss, boss.x, boss.y, base + k * 0.18, 330, { dmg: 16 });
          }
        });
      }
      return 400 + volleys * 420;
    },
  },
  abyssCurse: {
    name: '심연의 저주',
    run({ room, boss, enraged }) {
      const curse = () => {
        for (const p of bossPlayers(room)) addHazard(room, boss, { x: p.x, y: p.y, r: 95, warnMs: 1600, followId: p.id, followUntilMs: 1000, dmg: 34, knock: 70, stunMs: 300 });
        addHazard(room, boss, { x: boss.x, y: boss.y, r: 120, warnMs: 1600, dmg: 30, knock: 70 });
      };
      curse();
      if (enraged) later(boss, 1800, curse);
      return 700;
    },
  },
};

function updateBoss(room, boss, dt, now) {
  const t = BOSS_TYPES[boss.kind];
  const s = boss.special;
  const ps = bossPlayers(room);

  // 타깃: 지금 타깃이 사라졌거나 일정 시간이 지나면 방 안의 다른 플레이어로 바꿈(파티원 전원이 노려짐)
  let target = findRoomPlayer(room, boss.targetId);
  if (ps.length && (!target || now >= s.retargetAt)) {
    target = ps[Math.floor(Math.random() * ps.length)];
    boss.targetId = target.id;
    s.retargetAt = now + BOSS_RETARGET_MS;
  }
  if (!target) { boss.targetId = null; return; }
  boss.mode = 'chase';

  if (!s.enraged && boss.hp <= boss.maxHp * BOSS_ENRAGE_HP_RATIO) {
    s.enraged = true;
    s.nextAt = Math.min(s.nextAt, now + 800);
    broadcastRoom(room, { type: 'boss_enrage', name: boss.name });
  }

  if (s.queue.length) {
    const due = s.queue.filter(q => q.at <= now);
    s.queue = s.queue.filter(q => q.at > now);
    for (const q of due) q.fn();
  }

  if (s.dash) {
    boss.x += s.dash.vx * dt;
    boss.y += s.dash.vy * dt;
    if (now >= s.dash.until) s.dash = null;
  }

  if (now < s.busyUntil || s.dash) {
    s.phase = 'telegraph';
  } else if (now >= s.nextAt) {
    const key = t.attacks[s.attackIdx % t.attacks.length];
    s.attackIdx++;
    const attack = BOSS_ATTACKS[key];
    const busy = attack.run({ room, boss, enraged: s.enraged, target });
    s.busyUntil = now + busy;
    s.nextAt = s.busyUntil + t.gapMs * BOSS_GAP_SCALE * (s.enraged ? BOSS_ENRAGE_GAP : 1);
    s.phase = 'telegraph';
    broadcastRoom(room, { type: 'boss_cast', id: boss.id, text: attack.name, x: round1(boss.x), y: round1(boss.y) });
  } else {
    s.phase = 'idle';
    const slowMult = (boss.slowUntil && now < boss.slowUntil) ? 0.6 : 1;
    const speedMult = (s.speedUntil && now < s.speedUntil) ? s.speedMult : 1;
    const speed = t.chaseSpeed * (s.enraged ? BOSS_ENRAGE_SPEED : 1) * slowMult * speedMult;
    const dx = target.x - boss.x, dy = target.y - boss.y;
    const dist = Math.hypot(dx, dy);
    if (dist > boss.r + PLAYER_R + 4) {
      boss.x += (dx / dist) * speed * dt;
      boss.y += (dy / dist) * speed * dt;
    } else if (now - boss.lastAttackAt >= MONSTER_ATTACK_COOLDOWN_MS) {
      boss.lastAttackAt = now;
      dealMonsterContactDamage(room, boss, target, dx, dy, dist);
    }
  }
  clampToWorld(boss, boss.r, room.world);
  resolveLandmarksCollision(boss, boss.r, room);
  clampToWorld(boss, boss.r, room.world);
}

function updateMonsters(room, dt, now) {
  if (room.kind === 'raid' && room.started === false) return; // 방장이 시작 누르기 전엔 보스가 가만히 있음
  for (const m of room.monsters.values()) {
    if (m.isBoss) { updateBoss(room, m, dt, now); continue; } // 보스는 슈퍼아머 — 경직 무시
    if (now < m.stunUntil) {
      clampToWorld(m, m.r, room.world);
      resolveLandmarksCollision(m, m.r, room);
      clampToWorld(m, m.r, room.world);
      continue;
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
  const hit = { monsterId: m.id, damage: dmg, x: m.x, y: m.y, monsterHp: m.hp, monsterMaxHp: m.maxHp, defeated: false, isBoss: !!m.isBoss };

  // 보스는 슈퍼아머 — 넉백·경직 없고, 타깃도 스스로 정함(updateBoss)
  if (!m.isBoss) {
    m.mode = 'chase';
    m.targetId = player.id;
    const dx = m.x - player.x, dy = m.y - player.y;
    const dist = Math.hypot(dx, dy);
    const kb = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
    m.x += kb.x * MONSTER_KNOCKBACK;
    m.y += kb.y * MONSTER_KNOCKBACK;
    clampToWorld(m, m.r, room.world);
    resolveLandmarksCollision(m, m.r, room);
    clampToWorld(m, m.r, room.world);
    m.stunUntil = now + MONSTER_STUN_MS;
  }

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
      m.special.queue = [];
      if (room.hazards) room.hazards.clear();
      const roomId = room.id;
      setTimeout(() => {
        const r = rooms.get(roomId);
        if (!r) return;
        for (const p of [...r.players.values()]) movePlayerToRoom(p, 'world', jitter(homeEntryFor(p.user)));
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
    if (m.isBoss && weapon.element !== 'none' && weapon.element === m.weakness) {
      dmg = Math.round(dmg * 1.5);
    }
    hits.push(applyHitToMonster(room, player, m, dmg, now));
  }
  if (hits.length) {
    sendTo(player, { type: 'attack_result', hits, totalExp: player.exp, level: player.level });
  }
}

// 활/마법봉 — 조준 방향으로 투사체를 날림(궁수·힐러 공용)
function spawnProjectile(room, player, angleOffset = 0, opts = {}) {
  const weapon = player.weapon;
  let dmg = roll(player.atk + (weapon.atkBonus || 0) + (player.magic || 0));
  if (opts.dmgMult) dmg = Math.round(dmg * opts.dmgMult);
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
    ownerId: player.id, classKey: player.classKey, maxLife: proj.maxLife, tag: opts.tag || null,
  });
  sendTo(player, { type: 'attack_result', hits: [], totalExp: player.exp, level: player.level });
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
        sendTo(owner, { type: 'attack_result', hits: [hit], totalExp: owner.exp, level: owner.level });
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
    for (const off of [-0.3, 0, 0.3]) spawnProjectile(room, player, off, { dmgMult: 0.8, tag: 'multi' });
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'multiShot', x: player.x, y: player.y, facing: player.facing });
  } else if (skillKey === 'piercingShot') {
    spawnProjectile(room, player, 0, { pierce: true, dmgMult: 1.6, tag: 'pierce' });
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'piercingShot', x: player.x, y: player.y, facing: player.facing });
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
  } else if (skillKey === 'relicNogeon') {
    const radius = 240;
    for (const m of room.monsters.values()) {
      if (Math.hypot(m.x - player.x, m.y - player.y) <= radius) applyHitToMonster(room, player, m, roll(player.atk * 4 + 18), now);
    }
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + 20);
    if (player.hp !== before) sendTo(player, { type: 'healed', amount: player.hp - before, hp: player.hp, maxHp: player.maxHp });
    broadcastRoom(room, { type: 'skill_fx', id: player.id, skill: 'relicNogeon', x: player.x, y: player.y, radius });
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
  snapshotTick++;
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
      checkHomeTownEntrance(p, room, now);
    }

    updateMonsters(room, dt, now);
    updateProjectiles(room, dt, now);
    updateHazards(room, dt, now);

    // ── 스냅샷 전송 — Render 무료 전송량(월 5GB) 안에서 돌도록 줄임 ──
    // 오픈월드는 초당 15번(레이드는 탄막이 빨라서 30번 유지), 몬스터는 각 플레이어 화면 근처 것만 보냄.
    // 전에는 오픈월드 몬스터 전체(140마리 이상)를 초당 30번 모두에게 보내서 1인당 시간당 약 1GB가 나갔음
    if (room.kind === 'world' && snapshotTick % WORLD_SNAPSHOT_EVERY !== 0) continue;
    if (!room.players.size) continue;
    const playersJson = JSON.stringify([...room.players.values()].map(p => ({
        id: p.id, x: round1(p.x), y: round1(p.y),
        facing: p.facing, name: p.name, hp: p.hp, maxHp: p.maxHp, level: p.level, guildTag: p.guildTag || null,
        weaponKey: p.weapon.key, weaponElement: p.weapon.element,
        zoneName: room.kind === 'world' ? regionAt(p.x, p.y).name : null,
        zoneKey: room.kind === 'world' ? regionAt(p.x, p.y).key : room.zoneKey,
      })));
    const monsterViews = [...room.monsters.values()].map(m => ({
      m,
      json: JSON.stringify({
        id: m.id, x: round1(m.x), y: round1(m.y),
        kind: m.kind, hp: m.hp, maxHp: m.maxHp, isBoss: !!m.isBoss || undefined, isElite: !!m.isElite || undefined,
        phase: m.special ? m.special.phase : undefined,
        enraged: m.special ? m.special.enraged : undefined,
      }),
    }));
    const hazardsJson = JSON.stringify(
      // 위험 지대는 한 번에 수십 개가 뜨므로 모양별로 필요한 값만 짧은 키로 보냄(s: c=원, r=고리, l=직선)
      room.hazards ? [...room.hazards.values()].map(h => {
        const o = { s: h.shape[0], x: round1(h.x), y: round1(h.y), c: h.color, f: h.warnMs ? Math.round(Math.min(1, (now - h.bornAt) / h.warnMs) * 100) / 100 : 1, on: now >= h.activeAt && !h.visualOnly ? 1 : 0 };
        if (h.shape === 'line') { o.a = Math.round(h.angle * 1000) / 1000; o.l = Math.round(h.len); o.w = h.w; } else { o.r = h.r; if (h.shape === 'ring') o.r2 = h.r2; }
        return o;
      }) : []);
    const allMonstersJson = room.kind === 'world' ? null : monsterViews.map(v => v.json).join(',');
    for (const p of room.players.values()) {
      if (p.ws.readyState !== p.ws.OPEN) continue;
      const monstersJson = allMonstersJson ?? monsterViews
        .filter(v => Math.abs(v.m.x - p.x) <= SNAPSHOT_VIEW_HALF_W && Math.abs(v.m.y - p.y) <= SNAPSHOT_VIEW_HALF_H)
        .map(v => v.json).join(',');
      p.ws.send(`{"type":"state","players":${playersJson},"monsters":[${monstersJson}],"hazards":${hazardsJson}}`);
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
  const spawn = jitter(homeEntryFor(user));
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
    raidEntranceZone: null, activePortalId: null, homeTownPromptZone: null,
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
    homeTownName: HOME_TOWNS[user.homeTown || 'capital'].name,
    levelResetV35: levelResetV35Record(user),
  });
  sendTo(player, { type: 'welcome', id, tickMs: 1000 / TICK_RATE, self: { hp: player.hp, maxHp: player.maxHp, level: player.level } });
  const spawnRegion = regionAt(player.x, player.y);
  sendTo(player, {
    type: 'zone_change', zoneKey: spawnRegion.key, zoneName: spawnRegion.name,
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
// 전송량 절약: 배경음악 등 에셋은 브라우저가 7일간 캐시, html/js는 매번 확인하되 안 바뀌었으면 304로 본문 생략,
// 텍스트 파일은 gzip 압축(압축본은 메모리에 캐시)
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.md', '.svg']);
const gzipCache = new Map();
function serveStatic(req, res) {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.join(CLIENT_DIR, reqPath === '/' ? 'index.html' : reqPath);
  if (!filePath.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (statErr, st) => {
    if (statErr || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': reqPath.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      if (COMPRESSIBLE.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        let cached = gzipCache.get(filePath);
        if (!cached || cached.etag !== etag) { cached = { etag, body: zlib.gzipSync(data) }; gzipCache.set(filePath, cached); }
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
        res.end(cached.body);
        return;
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}
const httpServer = http.createServer(serveStatic);
// 스냅샷 JSON은 압축률이 높아서(반복되는 키 이름) 웹소켓 압축으로 전송량을 크게 줄임
const wss = new WebSocketServer({
  server: httpServer,
  perMessageDeflate: { zlibDeflateOptions: { level: 3, memLevel: 7 }, serverMaxWindowBits: 13, threshold: 256 },
});
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
      const allowedWeapon = wcat && (CLASS_WEAPON_KEYS[player.classKey] || CLASS_WEAPON_KEYS.warrior).includes(msg.itemKey);
      if (wcat && !allowedWeapon) {
        return;
      } else if (wcat) {
        if (player.gold < wcat.price) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
        player.gold -= wcat.price;
        player.inventory.push({
          id: 'w' + (nextItemId++), kind: 'weapon', key: msg.itemKey, name: wcat.name,
          atkBonus: wcat.atkBonus, element: wcat.element, enhanceLevel: 0,
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
      player.user.weapon = newWeapon;
      saveUsers();
      sendInventory(player);
    } else if (msg.type === 'use_item') {
      const idx = player.inventory.findIndex(i => i.id === msg.itemId && i.kind === 'potion');
      if (idx === -1) return;
      const item = player.inventory[idx];
      player.hp = Math.min(player.maxHp, player.hp + item.heal);
      item.qty--;
      if (item.qty <= 0) player.inventory.splice(idx, 1);
      saveUsers();
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
          listedItem = { kind: 'weapon', key: item.key, name: item.name, atkBonus: item.atkBonus, element: item.element, enhanceLevel: item.enhanceLevel };
          player.inventory.splice(idx, 1);
        } else {
          return;
        }
        const id = 'mk' + (nextMarketId++);
        marketListings.set(id, { id, sellerUsername: player.username, sellerNickname: player.name, ...listedItem, qty: listQty, price, listedAt: Date.now() });
        saveMarket();
        saveUsers();
        sendInventory(player);
        sendMarketData(player);
      } else if (msg.type === 'market_buy') {
        const listing = marketListings.get(msg.listingId);
        if (!listing) { sendTo(player, { type: 'shop_error', reason: '이미 판매되었거나 취소된 아이템입니다' }); return; }
        if (listing.sellerUsername === player.username) { sendTo(player, { type: 'shop_error', reason: '자신이 등록한 아이템은 구매할 수 없습니다' }); return; }
        if (player.gold < listing.price) { sendTo(player, { type: 'shop_error', reason: '골드가 부족합니다' }); return; }
        player.gold -= listing.price;
        grantMarketItem(player, listing);
        syncGold(player);
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
        saveUsers();
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
      const existing = user.quests[msg.questId];
      if (existing && !existing.turnedIn) return; // 이미 진행 중인 퀘스트는 중복 수락 불가
      user.quests[msg.questId] = { progress: 0, turnedIn: false }; // 완료한 퀘스트는 재수락 시 반복 가능
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
      movePlayerToRoom(player, 'world', jitter(homeEntryFor(player.user)));
    } else if (msg.type === 'set_home_town' && HOME_TOWNS[msg.townKey]) {
      if (player.homeTownPromptZone !== msg.townKey) return; // 해당 도시 분수 근처에 있을 때만 설정 가능
      player.user.homeTown = msg.townKey;
      saveUsers();
      sendTo(player, { type: 'hometown_set', townKey: msg.townKey, townName: HOME_TOWNS[msg.townKey].name });
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
