// ── 영속성 계층 ─────────────────────────────────────────
// SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 있으면 Supabase(Postgres)를 쓰고,
// 없으면 기존처럼 로컬 JSON 파일로 동작한다(로컬 개발 시 Supabase 없이도 그대로 돌아가게).
import fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
export const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (useSupabase) {
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[db] Supabase 연결 사용');
} else {
  console.log('[db] SUPABASE_URL/SUPABASE_SERVICE_KEY 없음 — 로컬 JSON 파일로 동작');
}

const USERS_FILE = new URL('./users.json', import.meta.url);
const GUILDS_FILE = new URL('./guilds.json', import.meta.url);
const MARKET_FILE = new URL('./market.json', import.meta.url);

// ── 유저 ─────────────────────────────────────────────
function userRowToObj(r) {
  return {
    username: r.username, salt: r.salt, passwordHash: r.password_hash, nickname: r.nickname,
    createdAt: Number(r.created_at), online: false,
    classKey: r.class_key, hasChosenClass: r.has_chosen_class,
    level: r.level, exp: r.exp, gold: r.gold, statPoints: r.stat_points,
    stats: r.stats, weapon: r.weapon, inventory: r.inventory,
    ownedSkills: r.owned_skills, equippedSkills: r.equipped_skills,
    guildId: r.guild_id, hasMap: r.has_map, hasSeenTutorial: r.has_seen_tutorial,
    quests: r.quests || {},
  };
}
function userObjToRow(u) {
  return {
    username: u.username, salt: u.salt, password_hash: u.passwordHash, nickname: u.nickname,
    created_at: u.createdAt, class_key: u.classKey, has_chosen_class: u.hasChosenClass,
    level: u.level, exp: u.exp, gold: u.gold, stat_points: u.statPoints,
    stats: u.stats, weapon: u.weapon, inventory: u.inventory,
    owned_skills: u.ownedSkills, equipped_skills: u.equippedSkills,
    guild_id: u.guildId, has_map: u.hasMap, has_seen_tutorial: u.hasSeenTutorial,
    quests: u.quests || {},
  };
}

export async function loadUsers() {
  if (useSupabase) {
    const { data, error } = await supabase.from('users').select('*');
    if (error) { console.error('[db] users 로드 실패', error); return new Map(); }
    return new Map(data.map(r => [r.username, userRowToObj(r)]));
  }
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')))); }
  catch { return new Map(); }
}
export function saveUsers(usersMap) {
  if (useSupabase) {
    const rows = [...usersMap.values()].map(userObjToRow);
    if (rows.length) supabase.from('users').upsert(rows).then(({ error }) => { if (error) console.error('[db] users 저장 실패', error); });
    return;
  }
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(usersMap))); }
  catch (e) { console.error('users.json 저장 실패', e); }
}

// ── 길드 ─────────────────────────────────────────────
function guildRowToObj(r) {
  return { id: r.id, name: r.name, approvalRequired: r.approval_required, ownerUsername: r.owner_username, members: r.members, pending: r.pending };
}
function guildObjToRow(g) {
  return { id: g.id, name: g.name, approval_required: g.approvalRequired, owner_username: g.ownerUsername, members: g.members, pending: g.pending };
}
export async function loadGuilds() {
  if (useSupabase) {
    const { data, error } = await supabase.from('guilds').select('*');
    if (error) { console.error('[db] guilds 로드 실패', error); return new Map(); }
    return new Map(data.map(r => [r.id, guildRowToObj(r)]));
  }
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(GUILDS_FILE, 'utf8')))); }
  catch { return new Map(); }
}
// 길드는 삭제(탈퇴로 해체)도 있어서 매번 전체를 지우고 다시 넣는 방식으로 동기화한다(길드 수가 적어 비용 문제 없음)
export function saveGuilds(guildsMap) {
  if (useSupabase) {
    const rows = [...guildsMap.values()].map(guildObjToRow);
    supabase.from('guilds').delete().neq('id', '__none__')
      .then(() => rows.length ? supabase.from('guilds').insert(rows) : null)
      .then(res => { if (res && res.error) console.error('[db] guilds 저장 실패', res.error); })
      .catch(e => console.error('[db] guilds 저장 실패', e));
    return;
  }
  try { fs.writeFileSync(GUILDS_FILE, JSON.stringify(Object.fromEntries(guildsMap))); }
  catch (e) { console.error('guilds.json 저장 실패', e); }
}

// ── 거래장터 ───────────────────────────────────────────
function marketRowToObj(r) {
  return {
    id: r.id, sellerUsername: r.seller_username, sellerNickname: r.seller_nickname,
    kind: r.kind, key: r.key, name: r.name, qty: r.qty, price: r.price, listedAt: Number(r.listed_at),
    atkBonus: r.atk_bonus ?? undefined, durability: r.durability ?? undefined, maxDurability: r.max_durability ?? undefined,
    element: r.element ?? undefined, enhanceLevel: r.enhance_level ?? undefined, heal: r.heal ?? undefined, priceHint: r.price_hint ?? undefined,
  };
}
function marketObjToRow(l) {
  return {
    id: l.id, seller_username: l.sellerUsername, seller_nickname: l.sellerNickname,
    kind: l.kind, key: l.key, name: l.name, qty: l.qty, price: l.price, listed_at: l.listedAt,
    atk_bonus: l.atkBonus ?? null, durability: l.durability ?? null, max_durability: l.maxDurability ?? null,
    element: l.element ?? null, enhance_level: l.enhanceLevel ?? null, heal: l.heal ?? null, price_hint: l.priceHint ?? null,
  };
}
export async function loadMarket() {
  if (useSupabase) {
    const { data, error } = await supabase.from('market_listings').select('*');
    if (error) { console.error('[db] market 로드 실패', error); return new Map(); }
    return new Map(data.map(r => [r.id, marketRowToObj(r)]));
  }
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(MARKET_FILE, 'utf8')))); }
  catch { return new Map(); }
}
// 거래장터도 등록/취소/구매로 계속 없어지므로 길드와 같은 방식(전체 교체)으로 동기화
export function saveMarket(marketMap) {
  if (useSupabase) {
    const rows = [...marketMap.values()].map(marketObjToRow);
    supabase.from('market_listings').delete().neq('id', '__none__')
      .then(() => rows.length ? supabase.from('market_listings').insert(rows) : null)
      .then(res => { if (res && res.error) console.error('[db] market 저장 실패', res.error); })
      .catch(e => console.error('[db] market 저장 실패', e));
    return;
  }
  try { fs.writeFileSync(MARKET_FILE, JSON.stringify(Object.fromEntries(marketMap))); }
  catch (e) { console.error('market.json 저장 실패', e); }
}
