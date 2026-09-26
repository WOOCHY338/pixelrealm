const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const speedReadout = document.getElementById('speedReadout');
const fpsReadout = document.getElementById('fpsReadout');
const hpReadout = document.getElementById('hpReadout');
const expReadout = document.getElementById('expReadout');
const levelReadout = document.getElementById('levelReadout');
const goldReadout = document.getElementById('goldReadout');
const weaponReadout = document.getElementById('weaponReadout');
const zoneReadout = document.getElementById('zoneReadout');
const statusEl = document.getElementById('status');
const bannerEl = document.getElementById('banner');
const zoneBannerEl = document.getElementById('zoneBanner');
const leaveRaidBtn = document.getElementById('leaveRaidBtn');

const raidPromptEl = document.getElementById('raidPrompt');
const raidBrowserEl = document.getElementById('raidBrowser');
const raidRoomListEl = document.getElementById('raidRoomList');
const raidRoomEmptyEl = document.getElementById('raidRoomEmpty');
const raidLobbyPanelEl = document.getElementById('raidLobbyPanel');
const raidLobbyMembersEl = document.getElementById('raidLobbyMembers');
const raidLobbyStartBtn = document.getElementById('raidLobbyStartBtn');
const raidLobbyWaitTextEl = document.getElementById('raidLobbyWaitText');
const npcPanelEl = document.getElementById('npcPanel');
const npcPanelNameEl = document.getElementById('npcPanelName');
const npcPanelDescEl = document.getElementById('npcPanelDesc');
const npcPanelProgressEl = document.getElementById('npcPanelProgress');
const npcActionBtn = document.getElementById('npcActionBtn');

const shopPanelEl = document.getElementById('shopPanel');
const shopListEl = document.getElementById('shopList');
const shopGoldEl = document.getElementById('shopGold');
const blacksmithPanelEl = document.getElementById('blacksmithPanel');
const blacksmithGoldEl = document.getElementById('blacksmithGold');
const blacksmithWeaponNameEl = document.getElementById('blacksmithWeaponName');
const blacksmithWeaponStatEl = document.getElementById('blacksmithWeaponStat');
const blacksmithEnhanceBtn = document.getElementById('blacksmithEnhanceBtn');
const blacksmithRepairBtn = document.getElementById('blacksmithRepairBtn');
const inventoryPanelEl = document.getElementById('inventoryPanel');
const invListEl = document.getElementById('invList');
const invGoldEl = document.getElementById('invGold');
const chatLogEl = document.getElementById('chatLog');
const chatInputBarEl = document.getElementById('chatInputBar');
const chatInputEl = document.getElementById('chatInput');
const musicToggleBtn = document.getElementById('musicToggleBtn');
const classSelectOverlay = document.getElementById('classSelectOverlay');
const classReadout = document.getElementById('classReadout');
const skillReadout = document.getElementById('skillReadout');
const skillReadout2 = document.getElementById('skillReadout2');

const gameOverOverlay = document.getElementById('gameOverOverlay');
let gameOverHideTimer = null;
function showGameOverScreen() {
  gameOverOverlay.classList.remove('hidden');
  requestAnimationFrame(() => gameOverOverlay.classList.add('show'));
  clearTimeout(gameOverHideTimer);
  gameOverHideTimer = setTimeout(() => {
    gameOverOverlay.classList.remove('show');
    setTimeout(() => gameOverOverlay.classList.add('hidden'), 260);
  }, 1600);
}

// ── 튜토리얼 — 신규 계정 첫 로그인 시(또는 이전에 안 봤으면) 한 번 보여주는 단계별 안내 ──
const TUTORIAL_STEPS = [
  { title: '이동과 공격', body: 'WASD로 이동하고, 마우스 클릭 또는 스페이스바로 공격합니다.' },
  { title: '스킬 사용', body: 'E, R 키로 직업별 스킬을 사용하세요. 스킬 상점에서 새로운 스킬을 배우고 장착할 수 있습니다.' },
  { title: '성장하기', body: '몬스터를 처치하면 경험치·골드·재료를 얻습니다. 레벨업 시 생기는 스텟 포인트는 C키로 분배하세요.' },
  { title: '장비와 거래', body: '상점·대장간에서 무기를 사고 강화하세요. 거래장터(신규!)에서는 다른 플레이어와 아이템을 직접 사고팔 수 있습니다.' },
  { title: '퀘스트와 길드', body: '마을 곳곳의 NPC에게 퀘스트를 받고, 마을회관에서 길드에 가입하거나 만들어보세요.' },
  { title: '레이드', body: '레이드 접수처에서 파티를 모아보세요. 파티 레이드는 방장이 "시작"을 눌러야 전투가 시작됩니다.' },
  { title: '지도', body: 'M키로 미니맵/전체지도를 볼 수 있어요. 단, 상점에서 세계 지도를 먼저 구매해야 합니다.' },
];
let tutorialStep = 0;
let hasSeenTutorial = false;
const tutorialOverlayEl = document.getElementById('tutorialOverlay');
const tutorialStepLabelEl = document.getElementById('tutorialStepLabel');
const tutorialTitleEl = document.getElementById('tutorialTitle');
const tutorialBodyEl = document.getElementById('tutorialBody');
const tutorialDotsEl = document.getElementById('tutorialDots');
const tutorialPrevBtn = document.getElementById('tutorialPrevBtn');
const tutorialNextBtn = document.getElementById('tutorialNextBtn');
function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  tutorialStepLabelEl.textContent = `TUTORIAL ${tutorialStep + 1}/${TUTORIAL_STEPS.length}`;
  tutorialTitleEl.textContent = step.title;
  tutorialBodyEl.textContent = step.body;
  tutorialDotsEl.innerHTML = '';
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    const dot = document.createElement('span');
    if (i === tutorialStep) dot.className = 'active';
    tutorialDotsEl.appendChild(dot);
  }
  tutorialPrevBtn.disabled = tutorialStep === 0;
  tutorialNextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? '시작하기' : '다음';
}
function showTutorial() {
  tutorialStep = 0;
  renderTutorialStep();
  tutorialOverlayEl.classList.remove('hidden');
}
function closeTutorial() {
  tutorialOverlayEl.classList.add('hidden');
  hasSeenTutorial = true;
  ws.send(JSON.stringify({ type: 'tutorial_done' }));
}
document.getElementById('tutorialSkipBtn').addEventListener('click', closeTutorial);
tutorialPrevBtn.addEventListener('click', () => { if (tutorialStep > 0) { tutorialStep--; renderTutorialStep(); } });
tutorialNextBtn.addEventListener('click', () => {
  if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; renderTutorialStep(); }
  else closeTutorial();
});

const authOverlay = document.getElementById('authOverlay');
const authTitle = document.getElementById('authTitle');
const authError = document.getElementById('authError');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authNicknameRow = document.getElementById('authNicknameRow');
const authNickname = document.getElementById('authNickname');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authSwitchBtn = document.getElementById('authSwitchBtn');

const statPanelEl = document.getElementById('statPanel');
const statPointsInfo = document.getElementById('statPointsInfo');
const statRowsEl = document.getElementById('statRows');
const statPointsBtn = document.getElementById('statPointsBtn');

const skillShopPanelEl = document.getElementById('skillShopPanel');
const skillShopGoldEl = document.getElementById('skillShopGold');
const skillSlotsEl = document.getElementById('skillSlots');
const skillCatalogListEl = document.getElementById('skillCatalogList');

const guildHallPanelEl = document.getElementById('guildHallPanel');
const guildHallNoGuildEl = document.getElementById('guildHallNoGuild');
const guildHallMineEl = document.getElementById('guildHallMine');
const guildListAreaEl = document.getElementById('guildListArea');
const guildMineInfoEl = document.getElementById('guildMineInfo');
const guildInviteRowEl = document.getElementById('guildInviteRow');
const guildPendingAreaEl = document.getElementById('guildPendingArea');
const guildMemberAreaEl = document.getElementById('guildMemberArea');

const marketPanelEl = document.getElementById('marketPanel');
const marketGoldEl = document.getElementById('marketGold');
const marketItemSelectEl = document.getElementById('marketItemSelect');
const marketQtyInputEl = document.getElementById('marketQtyInput');
const marketPriceInputEl = document.getElementById('marketPriceInput');
const marketListEl = document.getElementById('marketList');
let lastMarketListings = [];

const ELEMENT_LABEL = { none: '무속성', fire: '화속성', ice: '빙속성' };
let selfGold = 0;
let selfWeapon = { name: '낡은 검', atkBonus: 0, durability: 30, maxDurability: 30, element: 'none' };
let selfInventory = [];
let showInventory = false;

// ── 직업(클래스) / 스킬 / 스텟 / 길드 ──────────────────────
const CLASS_DEFS = {
  warrior: { name: '용사' },
  archer: { name: '궁수' },
  healer: { name: '힐러' },
};
// 서버의 SKILL_DEFS와 이름/설명만 맞춘 표시용 사본(쿨타임은 서버가 skill_used로 알려줌)
const SKILL_DEFS = {
  dash: { name: '대시', classKey: 'warrior', price: 0, desc: '바라보는 방향으로 순간 돌진' },
  whirlwind: { name: '회전 베기', classKey: 'warrior', price: 200, desc: '주변 적 전체에게 피해' },
  guard: { name: '방어 태세', classKey: 'warrior', price: 250, desc: '3초간 받는 피해 절반으로 감소' },
  selfHeal: { name: '자가 치유', classKey: 'archer', price: 0, desc: '자신의 체력 회복' },
  multiShot: { name: '멀티샷', classKey: 'archer', price: 200, desc: '부채꼴로 화살 3발 발사' },
  piercingShot: { name: '관통샷', classKey: 'archer', price: 250, desc: '적을 관통하는 강력한 화살' },
  healPulse: { name: '치유의 파동', classKey: 'healer', price: 0, desc: '자신 포함 주변 아군 체력 회복' },
  barrier: { name: '보호막', classKey: 'healer', price: 250, desc: '3초간 받는 피해 절반으로 감소' },
  slowField: { name: '저주의 파동', classKey: 'healer', price: 200, desc: '주변 몬스터 이동속도 감소' },
  curse523: { name: '523의 저주', classKey: null, price: 0, desc: '주변 모든 적에게 저주를 내려 강력한 피해를 입힌다' },
};
const STAT_LABELS = { hp: '체력', speed: '속도', dmg: '대미지', magic: '마력' };
let classSelected = false;
let currentClass = null;
let skillReadyAt = [0, 0];
let equippedSkills = [null, null];
let ownedSkills = [];
let myStats = { hp: 0, speed: 0, dmg: 0, magic: 0 };
let myStatPoints = 0;
let myGuild = null; // { id, name, approvalRequired, memberCount, ownerUsername } | null
let myIsGuildOwner = false;
let myUsername = null;
const projectiles = new Map();
const skillFx = [];

let VIEW_W = window.innerWidth;
let VIEW_H = window.innerHeight;
function resizeCanvas() {
  VIEW_W = canvas.width = window.innerWidth;
  VIEW_H = canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));

let WORLD = { w: VIEW_W, h: VIEW_H, wallThickness: 24 };
let landmarks = [];
let portals = [];
let obstacles = [];
let decorations = [];
let currentZoneKey = 'capital';
let currentZoneName = '대도시';
let isRaid = false;
let TICK_MS = 1000 / 30;
const TILE = 32;
const PLAYER_R = 14;
const MONSTER_R = 12;
const SPEED = 290; // 서버와 동일 — 340은 너무 빨라서 살짝 낮춤(340 → 290)
const MOVE_ACCEL = 1000;
const MOVE_DECEL = 1500;
const SWING_MS = 150;

const camera = { x: 0, y: 0 };
let showFullMap = false;
let hasMap = false;

function updateCamera(self) {
  // 플레이어는 항상 화면 정중앙 — 월드 경계에서도 카메라를 멈추지 않는다(맵 밖은 그냥 여백으로 보임).
  const px = self ? (self.renderX ?? self.predicted.x) : WORLD.w / 2;
  const py = self ? (self.renderY ?? self.predicted.y) : WORLD.h / 2;
  camera.x = px - VIEW_W / 2;
  camera.y = py - VIEW_H / 2;
}

let selfLevel = 1;

function approach(current, target, rate, dt) {
  if (current < target) return Math.min(current + rate * dt, target);
  if (current > target) return Math.max(current - rate * dt, target);
  return current;
}

let selfId = null;
let selfExp = 0;
const players = new Map();
const monsters = new Map();
const floatingTexts = [];
const impacts = [];
const sparks = [];
const shake = { mag: 0, startAt: 0, until: 0 };
let hitStopUntil = 0;

function triggerShake(mag, ms) {
  const now = performance.now();
  shake.mag = mag;
  shake.startAt = now;
  shake.until = now + ms;
}

function spawnImpact(x, y, color) {
  impacts.push({ x, y, color, born: performance.now() });
}

function spawnSparks(x, y, color, count) {
  const born = performance.now();
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    sparks.push({ x, y, color, born, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }
}

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function playTone(freqFrom, freqTo, durationMs, volume, type) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freqFrom, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 20), t0 + durationMs / 1000);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.02);
}
function playHitSound(heavy) { playTone(heavy ? 260 : 200, heavy ? 70 : 90, heavy ? 130 : 90, heavy ? 0.3 : 0.22, 'square'); }
function playHurtSound() { playTone(140, 60, 140, 0.25, 'sawtooth'); }

// ── 지역별 배경음악 — 저작권 없는(CC0) 실제 음원 파일을 지역마다 다르게 재생, 크로스페이드로 전환 ──
// 출처는 assets/music/CREDITS.md 참고 (전부 OpenGameArt.org, CC0 Public Domain)
const MUSIC_FILES = {
  capital: 'assets/music/capital.mp3',
  frontier: 'assets/music/frontier.mp3',
  field1: 'assets/music/field1.ogg',
  field2: 'assets/music/field2.mp3',
  field3: 'assets/music/field3.wav',
  field4: 'assets/music/field4.ogg',
  field5: 'assets/music/field5.mp3',
  field6: 'assets/music/field6.ogg',
  field7: 'assets/music/field7.mp3',
  raid: 'assets/music/raid.mp3',
};
const MUSIC_VOLUME = 0.32;
const MUSIC_FADE_MS = 900;

let currentMusicKey = null;
let currentAudioEl = null;
let musicMuted = false;
let pendingMusicKey = null;

function fadeAudio(el, from, to, ms, onDone) {
  const start = performance.now();
  clearInterval(el._fadeTimer);
  el._fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / ms);
    el.volume = from + (to - from) * t;
    if (t >= 1) { clearInterval(el._fadeTimer); if (onDone) onDone(); }
  }, 40);
}

function tryPlayMusic(el, key) {
  const p = el.play();
  if (p && p.catch) p.catch(() => { pendingMusicKey = key; });
}

// 도시/필드 사이 연결 공터('wild')에서는 트랙을 바꾸지 않고 직전 지역 음악을 그대로 이어서 재생
function updateMusicForZone(zoneKey) {
  const key = MUSIC_FILES[zoneKey] ? zoneKey : currentMusicKey;
  if (!key || key === currentMusicKey) return;
  const prevEl = currentAudioEl;
  currentMusicKey = key;
  const el = new Audio(MUSIC_FILES[key]);
  el.loop = true;
  el.volume = 0;
  currentAudioEl = el;
  tryPlayMusic(el, key);
  fadeAudio(el, 0, musicMuted ? 0 : MUSIC_VOLUME, MUSIC_FADE_MS);
  if (prevEl) {
    fadeAudio(prevEl, prevEl.volume, 0, MUSIC_FADE_MS, () => prevEl.pause());
  }
}

function setMusicMuted(muted) {
  musicMuted = muted;
  if (currentAudioEl) fadeAudio(currentAudioEl, currentAudioEl.volume, muted ? 0 : MUSIC_VOLUME, 300);
}

// 첫 사용자 제스처 전에는 브라우저 자동재생 정책 때문에 재생이 막힐 수 있어, 제스처가 들어오면 재시도
function retryPendingMusic() {
  if (pendingMusicKey && currentAudioEl && currentMusicKey === pendingMusicKey) {
    tryPlayMusic(currentAudioEl, pendingMusicKey);
  }
  pendingMusicKey = null;
}

function showBanner(text) {
  bannerEl.textContent = text;
  bannerEl.style.opacity = '1';
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => { bannerEl.style.opacity = '0'; }, 2200);
}

// ── 지역 진입 배너 — 메이플식으로 새 구역에 들어갈 때마다 큼직하게 지역명을 띄움 ──
let lastZoneBannerName = null;
function announceZone(name) {
  if (!name || name === lastZoneBannerName) return;
  lastZoneBannerName = name;
  zoneBannerEl.textContent = name;
  zoneBannerEl.classList.add('show');
  clearTimeout(announceZone._t);
  announceZone._t = setTimeout(() => zoneBannerEl.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function appendChatLine(name, text) {
  const div = document.createElement('div');
  div.className = 'line';
  div.innerHTML = `<b>${escapeHtml(name)}</b>${escapeHtml(text)}`;
  chatLogEl.appendChild(div);
  while (chatLogEl.children.length > 30) chatLogEl.removeChild(chatLogEl.firstChild);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

const keys = new Set();
const KEY_MAP = {
  'w': 'up', 'arrowup': 'up',
  's': 'down', 'arrowdown': 'down',
  'a': 'left', 'arrowleft': 'left',
  'd': 'right', 'arrowright': 'right',
};

function clampToWorld(p) {
  const t = WORLD.wallThickness;
  p.x = Math.max(t + PLAYER_R, Math.min(WORLD.w - t - PLAYER_R, p.x));
  p.y = Math.max(t + PLAYER_R, Math.min(WORLD.h - t - PLAYER_R, p.y));
}

function pushOutOfCircle(p, r, obs) {
  const dx = p.x - obs.x, dy = p.y - obs.y;
  const dist = Math.hypot(dx, dy);
  const minDist = obs.r + r;
  if (dist < minDist && dist > 0) {
    const push = (minDist - dist) / dist;
    p.x += dx * push;
    p.y += dy * push;
  }
}

function resolveLandmarkCollision(p) {
  for (const lm of landmarks) {
    if (lm.kind !== 'fountain') continue;
    pushOutOfCircle(p, PLAYER_R, lm);
  }
  for (const ob of obstacles) {
    pushOutOfCircle(p, PLAYER_R, ob);
  }
}

function sendInput() {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'input',
    up: keys.has('up'), down: keys.has('down'),
    left: keys.has('left'), right: keys.has('right'),
  }));
}

function spawnFloatText(x, y, text, color, popScale) {
  floatingTexts.push({ x, y, text, color, popScale: popScale || 1, born: performance.now() });
}

function sendAttack() {
  ensureAudio();
  const self = selfId != null ? players.get(selfId) : null;
  if (self && (currentClass || 'warrior') === 'warrior') self.swingUntil = performance.now() + SWING_MS;
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'attack' }));
}

function sendSkill(slot) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (!equippedSkills[slot]) return;
  const now = performance.now();
  if (now < skillReadyAt[slot]) return;
  ws.send(JSON.stringify({ type: 'skill', slot }));
}

function updateSkillReadouts() {
  const name0 = equippedSkills[0] ? SKILL_DEFS[equippedSkills[0]].name : '(없음)';
  const name1 = equippedSkills[1] ? SKILL_DEFS[equippedSkills[1]].name : '(없음)';
  skillReadout.textContent = name0;
  skillReadout2.textContent = name1;
}

let isChatting = false;

function openChat() {
  isChatting = true;
  keys.clear();
  sendInput();
  chatInputBarEl.classList.remove('hidden');
  chatInputEl.value = '';
  chatInputEl.focus();
  if (isTouchDevice) document.getElementById('touchControls').classList.remove('show');
}
function closeChat() {
  isChatting = false;
  chatInputBarEl.classList.add('hidden');
  chatInputEl.blur();
  if (isTouchDevice) document.getElementById('touchControls').classList.add('show');
}
function sendChatMessage() {
  const text = chatInputEl.value.trim();
  if (text && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', text }));
  }
  closeChat();
}
chatInputEl.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
});

window.addEventListener('keydown', e => {
  ensureAudio();
  retryPendingMusic();
  if (!classSelected) return;
  if (e.key === 'Enter' && !isChatting) { openChat(); e.preventDefault(); return; }
  if (isChatting) return;
  const dir = KEY_MAP[e.key.toLowerCase()];
  if (dir && !keys.has(dir)) { keys.add(dir); sendInput(); e.preventDefault(); }
  if (e.key === ' ' && !e.repeat) { sendAttack(); e.preventDefault(); }
  if (e.key.toLowerCase() === 'e' && !e.repeat) { sendSkill(0); e.preventDefault(); }
  if (e.key.toLowerCase() === 'r' && !e.repeat) { sendSkill(1); e.preventDefault(); }
  if (e.key.toLowerCase() === 'm' && !e.repeat) {
    if (hasMap) showFullMap = !showFullMap;
    else showBanner('지도가 없습니다 — 상점에서 구매하세요');
  }
  if (e.key.toLowerCase() === 'b' && !e.repeat) { showInventory = !showInventory; renderInventoryPanel(); }
  if (e.key.toLowerCase() === 'c' && !e.repeat) { statPanelEl.classList.toggle('hidden'); if (!statPanelEl.classList.contains('hidden')) renderStatPanel(); }
});
window.addEventListener('keyup', e => {
  if (!classSelected || isChatting) return;
  const dir = KEY_MAP[e.key.toLowerCase()];
  if (dir && keys.has(dir)) { keys.delete(dir); sendInput(); e.preventDefault(); }
});

const mouse = { x: 0, y: 0 };
let lastSentFacing = null;
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});
canvas.addEventListener('mousedown', e => {
  retryPendingMusic();
  if (!classSelected) return;
  if (e.button === 0) sendAttack();
});

// ── 모바일 터치 컨트롤 — 왼쪽 가상 조이스틱(이동+방향) + 오른쪽 공격/스킬 버튼 ──
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
let manualFacing = null;
if (isTouchDevice) {
  document.getElementById('touchControls').classList.add('show');

  const joystickBase = document.getElementById('touchJoystickBase');
  const joystickKnob = document.getElementById('touchJoystickKnob');
  const JOY_RADIUS = 46;
  const JOY_DEADZONE = 12;
  let joyTouchId = null;
  let joyCenter = { x: 0, y: 0 };

  function updateJoystickDirection(dx, dy) {
    keys.delete('up'); keys.delete('down'); keys.delete('left'); keys.delete('right');
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_DEADZONE) {
      const ang = Math.atan2(dy, dx);
      manualFacing = ang;
      if (Math.cos(ang) > 0.35) keys.add('right');
      if (Math.cos(ang) < -0.35) keys.add('left');
      if (Math.sin(ang) > 0.35) keys.add('down');
      if (Math.sin(ang) < -0.35) keys.add('up');
    }
    sendInput();
  }

  function findTouch(e) { return [...e.changedTouches].find(t => t.identifier === joyTouchId); }

  joystickBase.addEventListener('touchstart', e => {
    ensureAudio(); retryPendingMusic();
    if (!classSelected) return;
    const touch = e.changedTouches[0];
    joyTouchId = touch.identifier;
    const rect = joystickBase.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.preventDefault();
  }, { passive: false });
  joystickBase.addEventListener('touchmove', e => {
    if (joyTouchId === null) return;
    const touch = findTouch(e);
    if (!touch) return;
    const dx = touch.clientX - joyCenter.x, dy = touch.clientY - joyCenter.y;
    const dist = Math.min(JOY_RADIUS, Math.hypot(dx, dy));
    const ang = Math.atan2(dy, dx);
    joystickKnob.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px)`;
    updateJoystickDirection(dx, dy);
    e.preventDefault();
  }, { passive: false });
  function joystickEnd(e) {
    if (joyTouchId === null || !findTouch(e)) return;
    joyTouchId = null;
    joystickKnob.style.transform = '';
    keys.delete('up'); keys.delete('down'); keys.delete('left'); keys.delete('right');
    sendInput();
    e.preventDefault();
  }
  joystickBase.addEventListener('touchend', joystickEnd, { passive: false });
  joystickBase.addEventListener('touchcancel', joystickEnd, { passive: false });

  function bindTapButton(el, onTap, repeat) {
    let repeatTimer = null;
    el.addEventListener('touchstart', e => {
      ensureAudio(); retryPendingMusic();
      e.preventDefault();
      if (!classSelected) return;
      onTap();
      if (repeat) repeatTimer = setInterval(onTap, 220);
    }, { passive: false });
    const stop = e => { if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; } if (e) e.preventDefault(); };
    el.addEventListener('touchend', stop, { passive: false });
    el.addEventListener('touchcancel', stop, { passive: false });
  }
  bindTapButton(document.getElementById('touchAttackBtn'), sendAttack, true);
  bindTapButton(document.getElementById('touchSkillEBtn'), () => sendSkill(0), false);
  bindTapButton(document.getElementById('touchSkillRBtn'), () => sendSkill(1), false);

  document.getElementById('touchInvBtn').addEventListener('touchstart', e => {
    e.preventDefault();
    showInventory = !showInventory; renderInventoryPanel();
  }, { passive: false });
  document.getElementById('touchStatBtn').addEventListener('touchstart', e => {
    e.preventDefault();
    statPanelEl.classList.toggle('hidden');
    if (!statPanelEl.classList.contains('hidden')) renderStatPanel();
  }, { passive: false });
  document.getElementById('touchMapBtn').addEventListener('touchstart', e => {
    e.preventDefault();
    if (hasMap) showFullMap = !showFullMap;
    else showBanner('지도가 없습니다 — 상점에서 구매하세요');
  }, { passive: false });
  document.getElementById('touchChatBtn').addEventListener('touchstart', e => {
    e.preventDefault();
    openChat();
  }, { passive: false });
  document.getElementById('touchFullscreenBtn').addEventListener('touchstart', e => {
    e.preventDefault();
    toggleFullscreen();
  }, { passive: false });
}

document.getElementById('raidSoloBtn').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'raid_start', mode: 'solo' }));
  raidPromptEl.classList.add('hidden');
});
document.getElementById('raidPartyBtn').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'raid_start', mode: 'party' }));
  raidPromptEl.classList.add('hidden');
});

function renderRaidLobbyPanel(info) {
  if (info.started) { raidLobbyPanelEl.classList.add('hidden'); return; }
  raidLobbyPanelEl.classList.remove('hidden');
  const isHost = info.hostId === selfId;
  raidLobbyMembersEl.innerHTML = info.members.map(m =>
    `<div class="guild-row"><span>${escapeHtml(m.name)}${m.id === info.hostId ? ' (방장)' : ''}</span></div>`
  ).join('');
  raidLobbyStartBtn.style.display = isHost ? 'block' : 'none';
  raidLobbyWaitTextEl.style.display = isHost ? 'none' : 'block';
}
raidLobbyStartBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'raid_room_start' })));

function renderNpcPanel(d) {
  npcPanelEl.classList.remove('hidden');
  npcPanelNameEl.textContent = d.npcName;
  npcPanelDescEl.textContent = d.desc;
  npcPanelProgressEl.textContent = `[${d.questName}] ${monsterName(d.monsterKind)} ${d.progress}/${d.targetCount} 처치 · 보상: ${d.rewardGold}G, ${d.rewardExp}EXP`;
  if (d.state === 'not_started') {
    npcActionBtn.textContent = '퀘스트 수락';
    npcActionBtn.disabled = false;
    npcActionBtn.onclick = () => ws.send(JSON.stringify({ type: 'quest_accept', questId: d.questId }));
  } else if (d.state === 'active') {
    npcActionBtn.textContent = '진행중';
    npcActionBtn.disabled = true;
    npcActionBtn.onclick = null;
  } else if (d.state === 'ready') {
    npcActionBtn.textContent = '퀘스트 완료 보고';
    npcActionBtn.disabled = false;
    npcActionBtn.onclick = () => ws.send(JSON.stringify({ type: 'quest_turn_in', questId: d.questId }));
  } else {
    npcActionBtn.textContent = '다시 수주하기';
    npcActionBtn.disabled = false;
    npcActionBtn.onclick = () => ws.send(JSON.stringify({ type: 'quest_accept', questId: d.questId }));
  }
}
document.getElementById('npcCloseBtn').addEventListener('click', () => npcPanelEl.classList.add('hidden'));
document.getElementById('raidCancelBtn').addEventListener('click', () => {
  raidPromptEl.classList.add('hidden');
});
document.getElementById('raidBrowserCloseBtn').addEventListener('click', () => {
  raidBrowserEl.classList.add('hidden');
});
leaveRaidBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'raid_leave' }));
});

musicToggleBtn.addEventListener('click', () => {
  ensureAudio();
  retryPendingMusic();
  setMusicMuted(!musicMuted);
  musicToggleBtn.textContent = musicMuted ? '음악: 꺼짐' : '음악: 켜짐';
});

// ── 전체화면 — 모바일에서 브라우저 주소창 등을 가려서 화면을 더 넓게 씀 ──
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (req) req.call(document.documentElement);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
}
const fullscreenBtn = document.getElementById('fullscreenBtn');
fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = document.fullscreenElement ? '전체화면 해제' : '전체화면';
});

function updateClassCardLabels() {
  document.querySelectorAll('.class-card').forEach(card => {
    const key = card.dataset.class;
    const costEl = card.querySelector('.cost');
    if (!costEl) return;
    if (!hasChosenClassEver) { costEl.textContent = ''; card.classList.remove('active'); return; }
    if (key === currentClass) { costEl.textContent = '현재 직업'; card.classList.add('active'); }
    else { costEl.textContent = `변경 비용: ${RECLASS_COST}G`; card.classList.remove('active'); }
  });
}

document.getElementById('changeClassBtn').addEventListener('click', () => {
  showBanner('직업 변경은 캐시 상품입니다 — 개발자에게 문의하세요');
});

document.querySelectorAll('.class-card').forEach(card => {
  card.addEventListener('click', () => {
    ensureAudio();
    retryPendingMusic();
    const classKey = card.dataset.class;
    if (!hasChosenClassEver) {
      // 최초 선택 — 무료, 즉시 적용(스킬 장착 정보는 서버의 class_selected 응답으로 채워짐)
      currentClass = classKey;
      classSelected = true;
      skillReadyAt = [0, 0];
      classSelectOverlay.classList.add('hidden');
      classReadout.textContent = CLASS_DEFS[classKey].name;
      ws.send(JSON.stringify({ type: 'select_class', classKey }));
    } else {
      // 이미 직업이 있음 — 변경은 서버가 골드를 확인한 뒤에만 적용(낙관적으로 먼저 바꾸지 않음)
      ws.send(JSON.stringify({ type: 'select_class', classKey }));
    }
  });
});

document.getElementById('shopCloseBtn').addEventListener('click', () => shopPanelEl.classList.add('hidden'));
document.getElementById('blacksmithCloseBtn').addEventListener('click', () => blacksmithPanelEl.classList.add('hidden'));
blacksmithEnhanceBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'blacksmith_enhance' })));
blacksmithRepairBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'blacksmith_repair' })));

let lastShopCatalog = null;

function renderShopPanel(catalog, gold) {
  shopPanelEl.classList.remove('hidden');
  shopGoldEl.textContent = gold;
  shopListEl.innerHTML = '';
  for (const item of catalog) {
    const row = document.createElement('div');
    row.className = 'item-row';
    const sub = item.kind === 'weapon'
      ? `공격력+${item.atkBonus} · 내구도${item.maxDurability} · ${ELEMENT_LABEL[item.element]}`
      : item.kind === 'map' ? '미니맵 · 전체지도(M) 잠금 해제'
      : `HP +${item.heal}`;
    row.innerHTML = `<div class="desc"><div class="name">${item.name}</div><div class="sub">${sub} · ${item.price}G</div></div>`;
    const btn = document.createElement('button');
    if (item.kind === 'map' && hasMap) {
      btn.textContent = '보유중';
      btn.disabled = true;
    } else {
      btn.textContent = '구매';
      btn.disabled = gold < item.price;
      btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'shop_buy', itemKey: item.key })));
    }
    row.appendChild(btn);
    shopListEl.appendChild(row);
  }

  const materials = selfInventory.filter(i => i.kind === 'material');
  const sellHeader = document.createElement('div');
  sellHeader.className = 'empty-hint';
  sellHeader.style.marginTop = '4px';
  sellHeader.textContent = '몬스터 부위 판매';
  shopListEl.appendChild(sellHeader);
  if (!materials.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = '팔 수 있는 재료가 없습니다.';
    shopListEl.appendChild(empty);
  }
  for (const item of materials) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<div class="desc"><div class="name">${item.name} ×${item.qty}</div><div class="sub">개당 ${item.price}G · 총 ${item.price * item.qty}G</div></div>`;
    const btn = document.createElement('button');
    btn.textContent = '판매';
    btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'sell_item', itemId: item.id })));
    row.appendChild(btn);
    shopListEl.appendChild(row);
  }
}

function renderBlacksmithPanel(weapon, gold) {
  blacksmithPanelEl.classList.remove('hidden');
  blacksmithGoldEl.textContent = gold;
  blacksmithWeaponNameEl.textContent = `${weapon.name} (+${weapon.atkBonus}, ${ELEMENT_LABEL[weapon.element]})`;
  blacksmithWeaponStatEl.textContent = `내구도 ${weapon.durability} / ${weapon.maxDurability}`;
  const enhanceCost = 30 + (weapon.enhanceLevel || 0) * 20;
  const repairCost = (weapon.maxDurability - weapon.durability) * 2;
  blacksmithEnhanceBtn.textContent = `강화 (${enhanceCost}G)`;
  blacksmithEnhanceBtn.disabled = gold < enhanceCost;
  blacksmithRepairBtn.textContent = repairCost > 0 ? `내구도 수리 (${repairCost}G)` : '내구도 최대';
  blacksmithRepairBtn.disabled = repairCost <= 0 || gold < repairCost;
}

function renderStatPanel() {
  statPointsInfo.textContent = `남은 포인트: ${myStatPoints}`;
  statRowsEl.innerHTML = '';
  for (const stat of ['hp', 'speed', 'dmg', 'magic']) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `<div>${STAT_LABELS[stat]} <span style="color:#9aa0c0;">Lv ${myStats[stat] || 0}</span></div>`;
    const btn = document.createElement('button');
    btn.textContent = '+1';
    btn.disabled = myStatPoints <= 0;
    btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'allocate_stat', stat })));
    row.appendChild(btn);
    statRowsEl.appendChild(row);
  }
}
statPointsBtn.addEventListener('click', () => { statPanelEl.classList.remove('hidden'); renderStatPanel(); });

function renderSkillShopPanel(catalog, owned, equipped, gold) {
  skillShopPanelEl.classList.remove('hidden');
  skillShopGoldEl.textContent = gold;
  ownedSkills = owned; equippedSkills = equipped;
  skillSlotsEl.innerHTML = '';
  for (let slot = 0; slot < 2; slot++) {
    const div = document.createElement('div');
    const key = equipped[slot];
    div.className = 'skill-slot' + (key ? ' filled' : '');
    div.textContent = key ? `${slot === 0 ? 'E' : 'R'}: ${SKILL_DEFS[key].name}` : `${slot === 0 ? 'E' : 'R'}: (비어있음, 클릭)`;
    div.addEventListener('click', () => {
      const options = [...owned, null];
      const idx = options.indexOf(key);
      const next = options[(idx + 1) % options.length];
      ws.send(JSON.stringify({ type: 'equip_skill', slot, skillKey: next }));
    });
    skillSlotsEl.appendChild(div);
  }
  skillCatalogListEl.innerHTML = '';
  for (const item of catalog) {
    const row = document.createElement('div');
    row.className = 'skill-catalog-row';
    const isOwned = owned.includes(item.key);
    row.innerHTML = `<div class="top"><span class="name">${item.name}${item.price === 0 ? ' (기본)' : ''}</span><span>${isOwned ? '보유중' : item.price + 'G'}</span></div><div class="desc2">${item.desc}</div>`;
    if (!isOwned && item.price > 0) {
      const btn = document.createElement('button');
      btn.textContent = '구매';
      btn.style.marginTop = '6px';
      btn.disabled = gold < item.price;
      btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'skill_buy', skillKey: item.key })));
      row.appendChild(btn);
    }
    skillCatalogListEl.appendChild(row);
  }
}
document.getElementById('skillShopCloseBtn').addEventListener('click', () => skillShopPanelEl.classList.add('hidden'));

function renderGuildList(guildsArr) {
  guildListAreaEl.innerHTML = '';
  if (!guildsArr.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = '아직 생성된 길드가 없습니다.';
    guildListAreaEl.appendChild(empty);
    return;
  }
  for (const g of guildsArr) {
    const row = document.createElement('div');
    row.className = 'guild-row';
    row.innerHTML = `<span>${escapeHtml(g.name)} (${g.memberCount}명, ${g.approvalRequired ? '승인제' : '자유가입'})</span>`;
    const btn = document.createElement('button');
    btn.textContent = g.approvalRequired ? '가입 신청' : '가입';
    btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'guild_join', guildId: g.id })));
    row.appendChild(btn);
    guildListAreaEl.appendChild(row);
  }
}

function renderGuildHallPanel(data) {
  guildHallPanelEl.classList.remove('hidden');
  myGuild = data.guild;
  myIsGuildOwner = !!data.isOwner;
  if (myGuild) {
    guildHallNoGuildEl.style.display = 'none';
    guildHallMineEl.style.display = 'block';
    guildMineInfoEl.innerHTML = `<b>${escapeHtml(myGuild.name)}</b> (${myGuild.approvalRequired ? '승인제' : '자유가입'}) — 멤버 ${myGuild.memberCount}명${myIsGuildOwner ? ' · 길드장' : ''}`;
    guildInviteRowEl.style.display = myIsGuildOwner ? 'block' : 'none';
    guildPendingAreaEl.innerHTML = '';
    if (myIsGuildOwner && data.pending && data.pending.length) {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:12px;margin:8px 0 4px;color:#9aa0c0;';
      h.textContent = '가입 대기중:';
      guildPendingAreaEl.appendChild(h);
      for (const uname of data.pending) {
        const row = document.createElement('div');
        row.className = 'guild-row';
        row.innerHTML = `<span>${escapeHtml(uname)}</span>`;
        const approveBtn = document.createElement('button');
        approveBtn.textContent = '승인';
        approveBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'guild_approve', username: uname })));
        const rejectBtn = document.createElement('button');
        rejectBtn.textContent = '거절';
        rejectBtn.style.marginLeft = '6px';
        rejectBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'guild_reject', username: uname })));
        row.appendChild(approveBtn);
        row.appendChild(rejectBtn);
        guildPendingAreaEl.appendChild(row);
      }
    }
    guildMemberAreaEl.innerHTML = '';
    if (data.members && data.members.length) {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:12px;margin:8px 0 4px;color:#9aa0c0;';
      h.textContent = `멤버 (${data.members.length}명):`;
      guildMemberAreaEl.appendChild(h);
      for (const uname of data.members) {
        const row = document.createElement('div');
        row.className = 'guild-row';
        row.innerHTML = `<span>${escapeHtml(uname)}${uname === myGuild.ownerUsername ? ' (길드장)' : ''}</span>`;
        guildMemberAreaEl.appendChild(row);
      }
    }
  } else {
    guildHallNoGuildEl.style.display = 'block';
    guildHallMineEl.style.display = 'none';
    if (data.guilds) renderGuildList(data.guilds);
  }
}
document.getElementById('guildHallCloseBtn').addEventListener('click', () => guildHallPanelEl.classList.add('hidden'));
document.getElementById('guildCreateBtn').addEventListener('click', () => {
  const name = document.getElementById('guildNameInput').value.trim();
  const approvalRequired = document.getElementById('guildApprovalCheck').checked;
  if (!name) return;
  if (!confirm(`"${name}" 길드를 생성하시겠습니까? 이름과 가입 방식은 나중에 바꿀 수 없습니다.`)) return;
  ws.send(JSON.stringify({ type: 'guild_create', name, approvalRequired }));
});
document.getElementById('guildLeaveBtn').addEventListener('click', () => {
  if (!confirm('정말 길드를 탈퇴하시겠습니까?')) return;
  ws.send(JSON.stringify({ type: 'guild_leave' }));
});
document.getElementById('guildInviteBtn').addEventListener('click', () => {
  const input = document.getElementById('guildInviteInput');
  const username = input.value.trim();
  if (!username) return;
  ws.send(JSON.stringify({ type: 'guild_invite', username }));
  input.value = '';
});

// ── 거래장터 — 인벤토리 아이템을 등록하면 다른 유저가 아무 때나 사서 갈 수 있음 ──
function marketSellableItems() {
  return selfInventory.filter(i => i.kind === 'material' || i.kind === 'potion' || i.kind === 'weapon');
}
function renderMarketSellForm() {
  const items = marketSellableItems();
  marketItemSelectEl.innerHTML = '';
  if (!items.length) {
    const opt = document.createElement('option');
    opt.textContent = '등록할 아이템이 없습니다';
    opt.disabled = true;
    marketItemSelectEl.appendChild(opt);
    return;
  }
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    const qtyLabel = item.kind === 'weapon' ? '' : ` ×${item.qty}`;
    opt.textContent = `${item.name}${qtyLabel}`;
    marketItemSelectEl.appendChild(opt);
  }
}
function renderMarketPanel(data) {
  marketPanelEl.classList.remove('hidden');
  marketGoldEl.textContent = data.gold;
  lastMarketListings = data.listings;
  renderMarketSellForm();
  marketListEl.innerHTML = '';
  if (!data.listings.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = '등록된 아이템이 없습니다.';
    marketListEl.appendChild(empty);
    return;
  }
  for (const l of data.listings) {
    const row = document.createElement('div');
    row.className = 'item-row';
    const qtyLabel = l.kind === 'weapon' ? '' : ` ×${l.qty}`;
    row.innerHTML = `<div class="desc"><div class="name">${l.name}${qtyLabel}</div><div class="sub">${l.mine ? '내 등록' : escapeHtml(l.sellerNickname)} · ${l.price}G</div></div>`;
    const btn = document.createElement('button');
    if (l.mine) {
      btn.textContent = '취소';
      btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'market_cancel', listingId: l.id })));
    } else {
      btn.textContent = '구매';
      btn.disabled = selfGold < l.price;
      btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'market_buy', listingId: l.id })));
    }
    row.appendChild(btn);
    marketListEl.appendChild(row);
  }
}
document.getElementById('marketCloseBtn').addEventListener('click', () => marketPanelEl.classList.add('hidden'));
document.getElementById('marketSellBtn').addEventListener('click', () => {
  const itemId = marketItemSelectEl.value;
  const price = parseInt(marketPriceInputEl.value, 10);
  const qty = parseInt(marketQtyInputEl.value, 10) || 1;
  if (!itemId || !price || price <= 0) { showBanner('가격을 올바르게 입력해주세요'); return; }
  ws.send(JSON.stringify({ type: 'market_sell', itemId, qty, price }));
  marketPriceInputEl.value = '';
});

function renderInventoryPanel() {
  if (!showInventory) { inventoryPanelEl.classList.add('hidden'); return; }
  inventoryPanelEl.classList.remove('hidden');
  invGoldEl.textContent = selfGold;
  invListEl.innerHTML = '';
  const weaponRow = document.createElement('div');
  weaponRow.className = 'item-row';
  weaponRow.innerHTML = `<div class="desc"><div class="name">${selfWeapon.name} (장착중)</div><div class="sub">공격력+${selfWeapon.atkBonus} · 내구도 ${selfWeapon.durability}/${selfWeapon.maxDurability} · ${ELEMENT_LABEL[selfWeapon.element]}</div></div>`;
  invListEl.appendChild(weaponRow);
  if (!selfInventory.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = '가방이 비어있습니다.';
    invListEl.appendChild(empty);
    return;
  }
  for (const item of selfInventory) {
    const row = document.createElement('div');
    row.className = 'item-row';
    if (item.kind === 'weapon') {
      row.innerHTML = `<div class="desc"><div class="name">${item.name}</div><div class="sub">공격력+${item.atkBonus} · 내구도 ${item.durability}/${item.maxDurability} · ${ELEMENT_LABEL[item.element]}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = '장착';
      btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'equip_weapon', itemId: item.id })));
      row.appendChild(btn);
    } else if (item.kind === 'potion') {
      row.innerHTML = `<div class="desc"><div class="name">${item.name} ×${item.qty}</div><div class="sub">HP +${item.heal}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = '사용';
      btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'use_item', itemId: item.id })));
      row.appendChild(btn);
    } else {
      row.innerHTML = `<div class="desc"><div class="name">${item.name} ×${item.qty}</div><div class="sub">개당 ${item.price}G · 상점에서 판매 가능</div></div>`;
    }
    invListEl.appendChild(row);
  }
}

const RECLASS_COST = 3000;
let hasChosenClassEver = false;
let authMode = 'login'; // 'login' | 'signup'

// 클라이언트와 서버(ws)가 이제 같은 포트에서 같이 서빙됨 — 페이지를 불러온 origin 그대로 접속
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_PORT = location.port ? `:${location.port}` : '';
const ws = new WebSocket(`${WS_PROTOCOL}//${location.hostname}${WS_PORT}`);

ws.addEventListener('open', () => { statusEl.textContent = '연결됨'; });
ws.addEventListener('close', () => { statusEl.textContent = '연결 끊김'; });
ws.addEventListener('error', () => { statusEl.textContent = '연결 오류'; });

function setAuthMode(mode) {
  authMode = mode;
  authError.textContent = '';
  if (mode === 'signup') {
    authTitle.textContent = '회원가입';
    authNicknameRow.classList.add('show');
    authSubmitBtn.textContent = '회원가입';
    authSwitchBtn.textContent = '이미 계정이 있으신가요? 로그인';
  } else {
    authTitle.textContent = '로그인';
    authNicknameRow.classList.remove('show');
    authSubmitBtn.textContent = '로그인';
    authSwitchBtn.textContent = '계정이 없으신가요? 회원가입';
  }
}
authSwitchBtn.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));

function submitAuth() {
  ensureAudio();
  const username = authUsername.value.trim();
  const password = authPassword.value;
  const nickname = authNickname.value.trim();
  if (!username || !password || (authMode === 'signup' && !nickname)) {
    authError.textContent = '모든 항목을 입력해주세요';
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) { authError.textContent = '서버 연결 중입니다. 잠시 후 다시 시도해주세요'; return; }
  authError.textContent = '';
  if (authMode === 'signup') ws.send(JSON.stringify({ type: 'signup', username, password, nickname }));
  else ws.send(JSON.stringify({ type: 'login', username, password }));
}
authSubmitBtn.addEventListener('click', submitAuth);
[authUsername, authPassword, authNickname].forEach(input => {
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitAuth(); } });
});

function resetRoomEntities() {
  const self = selfId != null ? players.get(selfId) : null;
  players.clear();
  monsters.clear();
  if (self) players.set(selfId, self);
}

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'welcome') {
    selfId = msg.id;
    TICK_MS = msg.tickMs;
    selfLevel = msg.self.level;
    levelReadout.textContent = selfLevel;
    players.set(selfId, {
      name: `player-${selfId}`, facing: 0,
      predicted: { x: 0, y: 0 },
      serverTarget: { x: 0, y: 0 },
      vx: 0, vy: 0,
      hp: msg.self.hp, maxHp: msg.self.maxHp,
    });
  } else if (msg.type === 'zone_change') {
    currentZoneKey = msg.zoneKey;
    currentZoneName = msg.zoneName;
    isRaid = msg.isRaid;
    if (!isRaid) raidLobbyPanelEl.classList.add('hidden');
    WORLD = msg.world;
    landmarks = msg.landmarks || [];
    portals = msg.portals || [];
    obstacles = msg.obstacles || [];
    decorations = msg.decorations || [];
    zoneReadout.textContent = currentZoneName;
    announceZone(currentZoneName);
    leaveRaidBtn.classList.toggle('hidden', !isRaid);
    raidPromptEl.classList.add('hidden');
    raidBrowserEl.classList.add('hidden');
    resetRoomEntities();
    const self = players.get(selfId);
    if (self) {
      self.predicted.x = msg.x; self.predicted.y = msg.y;
      self.serverTarget.x = msg.x; self.serverTarget.y = msg.y;
      self.vx = 0; self.vy = 0;
      self.renderX = msg.x; self.renderY = msg.y;
    }
  } else if (msg.type === 'state') {
    const now = performance.now();
    const seen = new Set();
    for (const p of msg.players) {
      seen.add(p.id);
      let entry = players.get(p.id);
      if (!entry) {
        entry = { name: p.name, facing: p.facing, prevX: p.x, prevY: p.y, recvTime: now };
        players.set(p.id, entry);
      }
      entry.name = p.name;
      entry.level = p.level;
      entry.guildTag = p.guildTag;
      entry.weaponKey = p.weaponKey;
      entry.weaponElement = p.weaponElement;
      if (p.id === selfId) {
        entry.serverTarget.x = p.x;
        entry.serverTarget.y = p.y;
        entry.hp = p.hp;
        entry.maxHp = p.maxHp;
        if (p.level !== selfLevel) { selfLevel = p.level; levelReadout.textContent = selfLevel; }
        if (p.zoneName && p.zoneName !== currentZoneName && !isRaid) {
          currentZoneName = p.zoneName;
          zoneReadout.textContent = currentZoneName;
          announceZone(currentZoneName);
        }
        if (p.zoneKey) updateMusicForZone(isRaid ? 'raid' : p.zoneKey);
      } else {
        entry.prevX = entry.renderX ?? p.x;
        entry.prevY = entry.renderY ?? p.y;
        entry.x = p.x;
        entry.y = p.y;
        entry.facing = p.facing;
        entry.hp = p.hp;
        entry.maxHp = p.maxHp;
        entry.recvTime = now;
      }
    }
    for (const id of [...players.keys()]) {
      if (!seen.has(id)) players.delete(id);
    }

    const seenM = new Set();
    for (const m of msg.monsters) {
      seenM.add(m.id);
      let entry = monsters.get(m.id);
      if (!entry) {
        entry = { kind: m.kind, isBoss: m.isBoss, isElite: m.isElite, prevX: m.x, prevY: m.y, recvTime: now };
        monsters.set(m.id, entry);
      }
      entry.prevX = entry.renderX ?? m.x;
      entry.prevY = entry.renderY ?? m.y;
      entry.x = m.x;
      entry.y = m.y;
      entry.hp = m.hp;
      entry.maxHp = m.maxHp;
      entry.phase = m.phase;
      entry.isElite = m.isElite;
      entry.recvTime = now;
    }
    for (const id of [...monsters.keys()]) {
      if (!seenM.has(id)) monsters.delete(id);
    }
  } else if (msg.type === 'attack_result') {
    let anyKill = false;
    for (const hit of msg.hits) {
      const m = monsters.get(hit.monsterId);
      if (m) {
        m.hp = hit.monsterHp;
        m.maxHp = hit.monsterMaxHp;
        m.flashUntil = performance.now() + 130;
        m.hitBorn = performance.now();
      }
      spawnFloatText(hit.x, hit.y - 14, '-' + hit.damage, '#ffd35c', hit.defeated ? 1.6 : 1.25);
      spawnImpact(hit.x, hit.y, '#ffe9a8');
      spawnSparks(hit.x, hit.y, hit.defeated ? '#ff9a4e' : '#ffe9a8', hit.defeated ? 12 : 7);
      if (hit.defeated) {
        anyKill = true;
        if (!hit.isBoss) spawnFloatText(hit.x, hit.y - 34, `+${hit.exp} EXP · +${hit.goldGain}G · ${hit.materialName} 획득`, '#8fd6ff', 1.3);
      }
    }
    if (msg.hits.length) {
      triggerShake(anyKill ? 6 : 3.5, anyKill ? 160 : 110);
      hitStopUntil = performance.now() + (anyKill ? 90 : 55);
      playHitSound(anyKill);
    }
    if (typeof msg.totalExp === 'number') selfExp = msg.totalExp;
    if (typeof msg.weaponDurability === 'number') { selfWeapon.durability = msg.weaponDurability; selfWeapon.maxDurability = msg.weaponMaxDurability; }
  } else if (msg.type === 'player_hit') {
    const self = players.get(selfId);
    if (self) {
      self.hp = msg.hp;
      self.maxHp = msg.maxHp;
      if (typeof msg.x === 'number') {
        self.predicted.x = msg.x; self.predicted.y = msg.y;
        self.serverTarget.x = msg.x; self.serverTarget.y = msg.y;
        self.vx = 0; self.vy = 0;
      }
      self.controlLockUntil = performance.now() + (msg.stunMs || 0);
      self.flashUntil = performance.now() + 140;
      const px = self.renderX ?? self.predicted.x, py = self.renderY ?? self.predicted.y;
      spawnFloatText(px, py - 14, '-' + msg.damage, '#ff6b6b');
      spawnImpact(px, py, '#ff8b8b');
      if (msg.defeated) {
        spawnFloatText(px, py - 30, '기절!', '#ff6b6b');
        showGameOverScreen();
        triggerShake(9, 260);
      } else {
        triggerShake(5, 150);
      }
      playHurtSound();
    }
  } else if (msg.type === 'swing') {
    const p = players.get(msg.id);
    if (p) p.swingUntil = performance.now() + SWING_MS;
  } else if (msg.type === 'level_up') {
    selfLevel = msg.level;
    levelReadout.textContent = selfLevel;
    const self = players.get(selfId);
    if (self) { self.hp = msg.hp; self.maxHp = msg.maxHp; }
    showBanner(`레벨 업! Lv.${msg.level}`);
  } else if (msg.type === 'raid_prompt') {
    if (msg.show) { raidPromptEl.classList.remove('hidden'); raidPromptEl.dataset.zoneKey = msg.zoneKey; }
    else raidPromptEl.classList.add('hidden');
  } else if (msg.type === 'raid_rooms') {
    raidBrowserEl.classList.remove('hidden');
    raidRoomListEl.innerHTML = '';
    if (!msg.rooms.length) {
      raidRoomEmptyEl.style.display = 'block';
    } else {
      raidRoomEmptyEl.style.display = 'none';
      for (const r of msg.rooms) {
        const row = document.createElement('div');
        row.className = 'raid-room-row';
        row.innerHTML = `<span>${r.hostName}의 방 (${r.playerCount}/${r.maxPlayers}) · ${r.started ? `보스 HP ${r.bossHpPct}%` : '대기중'}</span>`;
        const btn = document.createElement('button');
        btn.textContent = '참가';
        btn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'raid_join', raidId: r.id })));
        row.appendChild(btn);
        raidRoomListEl.appendChild(row);
      }
    }
  } else if (msg.type === 'raid_join_failed') {
    showBanner(msg.reason);
  } else if (msg.type === 'raid_room_info') {
    renderRaidLobbyPanel(msg);
  } else if (msg.type === 'raid_started') {
    raidLobbyPanelEl.classList.add('hidden');
    showBanner('레이드 시작!');
  } else if (msg.type === 'raid_win') {
    showBanner(`${msg.bossName} 처치! +${msg.exp} EXP · +${msg.goldGain}G · ${msg.materialName} 획득`);
  } else if (msg.type === 'inventory') {
    selfGold = msg.gold;
    selfWeapon = msg.weapon;
    selfInventory = msg.inventory;
    if (showInventory) renderInventoryPanel();
    if (!blacksmithPanelEl.classList.contains('hidden')) renderBlacksmithPanel(selfWeapon, selfGold);
    if (!shopPanelEl.classList.contains('hidden') && lastShopCatalog) renderShopPanel(lastShopCatalog, selfGold);
    if (!marketPanelEl.classList.contains('hidden')) renderMarketSellForm();
  } else if (msg.type === 'shop_open') {
    lastShopCatalog = msg.catalog;
    if (typeof msg.hasMap === 'boolean') hasMap = msg.hasMap;
    renderShopPanel(msg.catalog, msg.gold);
  } else if (msg.type === 'map_purchased') {
    hasMap = true;
    showBanner('세계 지도를 구매했습니다! M키로 열어보세요');
    if (!shopPanelEl.classList.contains('hidden') && lastShopCatalog) renderShopPanel(lastShopCatalog, selfGold);
  } else if (msg.type === 'blacksmith_open') {
    renderBlacksmithPanel(msg.weapon, msg.gold);
  } else if (msg.type === 'shop_error') {
    showBanner(msg.reason);
  } else if (msg.type === 'healed') {
    const self = players.get(selfId);
    if (self) {
      self.hp = msg.hp;
      self.maxHp = msg.maxHp;
      const px = self.renderX ?? self.predicted.x, py = self.renderY ?? self.predicted.y;
      spawnFloatText(px, py - 14, '+' + msg.amount, '#7fd08a');
    }
  } else if (msg.type === 'chat') {
    appendChatLine(msg.name, msg.text);
    const p = players.get(msg.id);
    if (p) p.chatBubble = { text: msg.text, until: performance.now() + 4000 };
  } else if (msg.type === 'auth_error') {
    authError.textContent = msg.reason;
  } else if (msg.type === 'auth_ok') {
    myUsername = msg.username;
    authOverlay.classList.add('hidden');
    myStatPoints = msg.statPoints || 0;
    myStats = msg.stats || { hp: 0, speed: 0, dmg: 0, magic: 0 };
    ownedSkills = msg.ownedSkills || [];
    equippedSkills = msg.equippedSkills || [null, null];
    selfGold = msg.gold || 0;
    goldReadout.textContent = selfGold;
    statPointsBtn.textContent = `스텟 (${myStatPoints})`;
    myGuild = msg.guild || null;
    myIsGuildOwner = !!msg.isGuildOwner;
    hasMap = !!msg.hasMap;
    hasSeenTutorial = !!msg.hasSeenTutorial;
    if (msg.hasChosenClass) {
      currentClass = msg.classKey;
      hasChosenClassEver = true;
      classSelected = true;
      skillReadyAt = [0, 0];
      classSelectOverlay.classList.add('hidden');
      classReadout.textContent = CLASS_DEFS[msg.classKey].name;
      updateSkillReadouts();
      if (!hasSeenTutorial) showTutorial();
    } else {
      classSelectOverlay.classList.remove('hidden');
    }
    updateClassCardLabels();
  } else if (msg.type === 'class_selected') {
    const self = players.get(selfId);
    if (self) { self.hp = msg.hp; self.maxHp = msg.maxHp; }
    currentClass = msg.classKey;
    hasChosenClassEver = true;
    classSelected = true;
    skillReadyAt = [0, 0];
    ownedSkills = msg.ownedSkills || [];
    equippedSkills = msg.equippedSkills || [null, null];
    classSelectOverlay.classList.add('hidden');
    classReadout.textContent = CLASS_DEFS[msg.classKey].name;
    updateSkillReadouts();
    if (typeof msg.gold === 'number') { selfGold = msg.gold; goldReadout.textContent = selfGold; }
    updateClassCardLabels();
    if (!hasSeenTutorial) showTutorial();
  } else if (msg.type === 'class_change_denied') {
    showBanner(msg.reason);
  } else if (msg.type === 'stats_update') {
    myStats = msg.stats;
    myStatPoints = msg.statPoints;
    statPointsBtn.textContent = `스텟 (${myStatPoints})`;
    renderStatPanel();
    const self = players.get(selfId);
    if (self) { self.hp = msg.hp; self.maxHp = msg.maxHp; }
  } else if (msg.type === 'skill_shop_open') {
    renderSkillShopPanel(msg.catalog, msg.ownedSkills, msg.equippedSkills, msg.gold);
  } else if (msg.type === 'skill_shop_update') {
    ownedSkills = msg.ownedSkills;
    equippedSkills = msg.equippedSkills;
    selfGold = msg.gold; goldReadout.textContent = selfGold;
    updateSkillReadouts();
    if (!skillShopPanelEl.classList.contains('hidden')) {
      const catalog = Object.entries(SKILL_DEFS).filter(([, d]) => d.classKey === currentClass).map(([key, d]) => ({ key, ...d }));
      renderSkillShopPanel(catalog, ownedSkills, equippedSkills, selfGold);
    }
  } else if (msg.type === 'market_data') {
    selfGold = msg.gold;
    renderMarketPanel(msg);
  } else if (msg.type === 'guild_hall_open') {
    renderGuildHallPanel(msg);
  } else if (msg.type === 'guild_status') {
    myGuild = msg.guild;
    myIsGuildOwner = !!msg.isOwner;
    if (!guildHallPanelEl.classList.contains('hidden')) {
      renderGuildHallPanel({ guild: msg.guild, isOwner: msg.isOwner, members: msg.members || [], pending: msg.pending || [], guilds: null });
    }
  } else if (msg.type === 'guild_list') {
    renderGuildList(msg.guilds);
  } else if (msg.type === 'guild_error') {
    showBanner(msg.reason);
  } else if (msg.type === 'npc_dialogue') {
    renderNpcPanel(msg);
  } else if (msg.type === 'quest_complete') {
    showBanner(`퀘스트 완료: ${msg.questName} (+${msg.rewardGold}G, +${msg.rewardExp}EXP)`);
  } else if (msg.type === 'projectile_spawn') {
    projectiles.set(msg.id, {
      x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, ownerId: msg.ownerId, classKey: msg.classKey,
      maxLife: msg.maxLife, bornAt: performance.now(), tag: msg.tag || null, trail: [],
    });
  } else if (msg.type === 'projectile_hit') {
    projectiles.delete(msg.id);
    spawnSparks(msg.x, msg.y, '#ffe27a', 5);
  } else if (msg.type === 'projectile_pierce') {
    spawnSparks(msg.x, msg.y, '#ffe27a', 3);
  } else if (msg.type === 'skill_fx') {
    if (msg.skill === 'dash') spawnSparks(msg.x, msg.y, '#e0a458', 6);
    else skillFx.push({ skill: msg.skill, id: msg.id, x: msg.x, y: msg.y, radius: msg.radius, born: performance.now() });
  } else if (msg.type === 'skill_used') {
    skillReadyAt[msg.slot] = performance.now() + msg.cooldownMs;
  }
});

// 서버의 지역 박스와 동일한 값(미니맵·바닥 색 계산용) — v3.1: 사용자가 그려준 지도대로 재배치
const WORLD_SCALE = 2;
function S(n) { return n * WORLD_SCALE; }
const CAPITAL_BOX = { xMin: S(100), xMax: S(1300), yMin: S(3600), yMax: S(4700) };
const FIELD1_BOX = { xMin: S(100), xMax: S(1300), yMin: S(2400), yMax: S(3600) };
const FIELD2_BOX = { xMin: S(100), xMax: S(1300), yMin: S(1300), yMax: S(2400) };
const FIELD4_BOX = { xMin: S(100), xMax: S(1300), yMin: S(100), yMax: S(1300) };
const SECOND_CITY_BOX = { xMin: S(1300), xMax: S(2500), yMin: S(100), yMax: S(1300) };
const VILLAGE_BOX = { xMin: S(1300), xMax: S(2000), yMin: S(1300), yMax: S(1900) };
const GREEN_FOREST_BOX = { xMin: S(1300), xMax: S(2500), yMin: S(1900), yMax: S(3000) };
const WATER_TEMPLE_BOX = { xMin: S(1300), xMax: S(2500), yMin: S(3000), yMax: S(4700) };
const FIELD6_BOX = { xMin: S(2500), xMax: S(3700), yMin: S(100), yMax: S(2600) };
const FIELD3_BOX = { xMin: S(2500), xMax: S(3700), yMin: S(2600), yMax: S(4700) };
const FIELD5_BOX = { xMin: S(3700), xMax: S(4700), yMin: S(100), yMax: S(1700) };
const FIELD7_BOX = { xMin: S(3700), xMax: S(4700), yMin: S(1700), yMax: S(4700) };
function inBox(x, y, b) { return x >= b.xMin && x < b.xMax && y >= b.yMin && y < b.yMax; }

// 밝고 경쾌한 판타지 톤(메이플스토리풍) — [기본색A, 기본색B, 포인트 텍스처색]
// 메이플스토리풍: 채도는 있되 파스텔처럼 너무 밝지 않은 톤. [기본, 보조, 포인트]
const REGION_PALETTE = {
  void: ['#a9cfe0', '#9fc4d6'],
  capital: ['#93938d', '#84847e', '#6f6f68'],
  frontier: ['#a9b4bd', '#9ba7b1', '#828f9a'],
  village: ['#a3a878', '#94996a', '#7c8055'],       // 마을 — 소박한 흙빛 초원
  greenforest: ['#2f6b3a', '#295f33', '#1f4a28'],   // 그린 숲 — 짙은 숲
  watertemple: ['#4a8ca0', '#417d90', '#356875'],   // 물의 신전 — 푸른 유적
  field1: ['#5ea23f', '#549236', '#e8c23f'],   // 들꽃 초원 — 잔디 + 노란 꽃
  field2: ['#c2812f', '#b17225', '#8a5620'],   // 황혼 언덕 — 노을빛 들판
  field3: ['#3f8a6f', '#357a61', '#2a6350'],   // 축축한 습지
  field4: ['#bb9a54', '#ac8c48', '#8c6f38'],   // 메마른 협곡
  field5: ['#b9d4e0', '#a9c7d6', '#e8f5fb'],   // 얼어붙은 봉우리
  field6: ['#c97b3e', '#b96c30', '#8f5324'],   // 불타는 사막
  field7: ['#8f78a0', '#7e6a90', '#63536f'],   // 잊혀진 폐허
  wild: ['#749456', '#6b8a4d'],
};

function regionTint(x, y) {
  if (WORLD.w <= VIEW_W) return REGION_PALETTE.void;
  if (inBox(x, y, CAPITAL_BOX)) return REGION_PALETTE.capital;
  if (inBox(x, y, SECOND_CITY_BOX)) return REGION_PALETTE.frontier;
  if (inBox(x, y, VILLAGE_BOX)) return REGION_PALETTE.village;
  if (inBox(x, y, GREEN_FOREST_BOX)) return REGION_PALETTE.greenforest;
  if (inBox(x, y, WATER_TEMPLE_BOX)) return REGION_PALETTE.watertemple;
  if (inBox(x, y, FIELD1_BOX)) return REGION_PALETTE.field1;
  if (inBox(x, y, FIELD2_BOX)) return REGION_PALETTE.field2;
  if (inBox(x, y, FIELD3_BOX)) return REGION_PALETTE.field3;
  if (inBox(x, y, FIELD4_BOX)) return REGION_PALETTE.field4;
  if (inBox(x, y, FIELD5_BOX)) return REGION_PALETTE.field5;
  if (inBox(x, y, FIELD6_BOX)) return REGION_PALETTE.field6;
  if (inBox(x, y, FIELD7_BOX)) return REGION_PALETTE.field7;
  return REGION_PALETTE.wild;
}

// ── 도트 느낌 바닥 패턴: 8x8 픽셀 그리드를 오프스크린 캔버스에 한 번만 그리고
// CanvasPattern으로 반복 — 타일마다 매 프레임 그리지 않아서 가볍다.
function hash01(n) {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

function buildTilePattern(key, base, alt, accent) {
  const size = 32, cells = 8, px = size / cells;
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const octx = off.getContext('2d');
  octx.fillStyle = base;
  octx.fillRect(0, 0, size, size);
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const h = hash01((r * 8 + c) * 12.9898 + key.length * 78.233);
      if (h < 0.10) { octx.fillStyle = accent; octx.fillRect(c * px, r * px, px, px); }
      else if (h < 0.34) { octx.fillStyle = alt; octx.fillRect(c * px, r * px, px, px); }
    }
  }
  return ctx.createPattern(off, 'repeat');
}

const TILE_PATTERNS = {};
function ensureTilePatterns() {
  if (Object.keys(TILE_PATTERNS).length) return;
  for (const key of Object.keys(REGION_PALETTE)) {
    const [base, alt, accent] = REGION_PALETTE[key];
    TILE_PATTERNS[key] = buildTilePattern(key, base, alt || base, accent || alt || base);
  }
}

const FIELD_BOXES_CLIENT = {
  field1: FIELD1_BOX, field2: FIELD2_BOX, field3: FIELD3_BOX, field4: FIELD4_BOX,
  field5: FIELD5_BOX, field6: FIELD6_BOX, field7: FIELD7_BOX,
};

const REGION_BOXES = [
  // 필드(자연 지형)를 먼저 그리고 도시(인공 광장)를 맨 위에 덮어써서,
  // 필드의 울퉁불퉁한 해안선이 도시 쪽으로 넉넉히 뻗어나가도 도시 광장은 항상 깔끔하게 유지됨
  ['field1', FIELD1_BOX], ['field2', FIELD2_BOX], ['field3', FIELD3_BOX], ['field4', FIELD4_BOX],
  ['field5', FIELD5_BOX], ['field6', FIELD6_BOX], ['field7', FIELD7_BOX],
  ['village', VILLAGE_BOX], ['greenforest', GREEN_FOREST_BOX], ['watertemple', WATER_TEMPLE_BOX],
  ['capital', CAPITAL_BOX], ['frontier', SECOND_CITY_BOX],
];

// ── 필드 지역의 경계를 각진 네모가 아니라 자연스러운 해안선처럼 울퉁불퉁하게, 서로 맞닿게 ──
// (도시 두 곳은 사람이 지은 반듯한 광장이라 그대로 사각형으로 남겨둠)
const BLOB_JITTER = 90 * WORLD_SCALE; // 지역이 2배 커진 만큼 해안선 굴곡도 비례해서 키움
function buildBlobPath(box, seedStr, jitter, segPerSide) {
  let seed = 0;
  for (let c = 0; c < seedStr.length; c++) seed += seedStr.charCodeAt(c) * (c + 7);
  let idx = 0;
  const nextJitter = () => { idx += 1; return (hash01(seed * 0.037 + idx * 12.9898) - 0.5) * 2 * jitter; };
  const w = box.xMax - box.xMin, h = box.yMax - box.yMin;
  const pts = [];
  for (let i = 0; i <= segPerSide; i++) pts.push({ x: box.xMin + w * (i / segPerSide), y: box.yMin + nextJitter() });
  for (let i = 1; i <= segPerSide; i++) pts.push({ x: box.xMax + nextJitter(), y: box.yMin + h * (i / segPerSide) });
  for (let i = 1; i <= segPerSide; i++) pts.push({ x: box.xMax - w * (i / segPerSide), y: box.yMax + nextJitter() });
  for (let i = 1; i < segPerSide; i++) pts.push({ x: box.xMin + nextJitter(), y: box.yMax - h * (i / segPerSide) });

  const path = new Path2D();
  const n = pts.length;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = mid(pts[n - 1], pts[0]);
  path.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const cur = pts[i], next = pts[(i + 1) % n];
    const m = mid(cur, next);
    path.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
  }
  path.closePath();
  return path;
}

const REGION_BLOB_PATHS = {};
function ensureBlobPaths() {
  if (Object.keys(REGION_BLOB_PATHS).length) return;
  for (const [key, box] of REGION_BOXES) {
    if (!key.startsWith('field')) continue;
    REGION_BLOB_PATHS[key] = buildBlobPath(box, key, BLOB_JITTER, 9);
  }
}

function drawFloor() {
  ensureTilePatterns();
  ensureBlobPaths();
  const vx0 = camera.x, vy0 = camera.y, vx1 = camera.x + VIEW_W, vy1 = camera.y + VIEW_H;

  if (isRaid) {
    // 레이드 아레나 — 원래 그 필드와 같은 바닥 테마를 그대로 써서 "이어지는 공간"처럼 보이게
    const raidKey = TILE_PATTERNS[currentZoneKey] ? currentZoneKey : 'wild';
    ctx.fillStyle = TILE_PATTERNS[raidKey];
    ctx.fillRect(vx0, vy0, VIEW_W, VIEW_H);
    drawArenaMarking();
    return;
  }

  const bgKey = WORLD.w <= VIEW_W ? 'void' : 'wild';
  ctx.fillStyle = TILE_PATTERNS[bgKey];
  ctx.fillRect(vx0, vy0, VIEW_W, VIEW_H);

  if (WORLD.w <= VIEW_W) return;
  const pad = BLOB_JITTER + 10;
  for (const [key, box] of REGION_BOXES) {
    const blob = REGION_BLOB_PATHS[key];
    const bx0 = blob ? box.xMin - pad : box.xMin, by0 = blob ? box.yMin - pad : box.yMin;
    const bx1 = blob ? box.xMax + pad : box.xMax, by1 = blob ? box.yMax + pad : box.yMax;
    const ix0 = Math.max(vx0, bx0), iy0 = Math.max(vy0, by0);
    const ix1 = Math.min(vx1, bx1), iy1 = Math.min(vy1, by1);
    if (ix1 <= ix0 || iy1 <= iy0) continue;
    ctx.fillStyle = TILE_PATTERNS[key];
    if (blob) {
      ctx.save();
      ctx.clip(blob);
      ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      ctx.restore();
    } else {
      ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    }
  }
}

function drawArenaMarking() {
  const cx = WORLD.w / 2, cy = WORLD.h / 2;
  ctx.strokeStyle = 'rgba(20, 16, 10, 0.35)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 220, 150, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 235, 0, Math.PI * 2);
  ctx.stroke();
}

function drawWalls() {
  const t = WORLD.wallThickness;
  ctx.fillStyle = '#8a7c66';
  ctx.fillRect(0, 0, WORLD.w, t);
  ctx.fillRect(0, WORLD.h - t, WORLD.w, t);
  ctx.fillRect(0, 0, t, WORLD.h);
  ctx.fillRect(WORLD.w - t, 0, t, WORLD.h);
}

function drawPortalLabel(x, y, text, color) {
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const BUILDING_TYPES = new Set(['shop', 'blacksmith', 'skill_shop', 'guild_hall', 'raid_list', 'market']);
function drawNpcSprite(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 15, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6a5a8a';
  ctx.beginPath();
  ctx.moveTo(-11, 14); ctx.lineTo(11, 14); ctx.lineTo(7, -6); ctx.lineTo(-7, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e0c8a0';
  ctx.beginPath();
  ctx.arc(0, -12, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawPortals() {
  for (const p of portals) {
    const cx = p.x + p.w / 2;
    if (p.action.type === 'npc') {
      drawNpcSprite(cx, p.y + p.h / 2 + 10);
      drawPortalLabel(cx, p.y - 6, p.label, '#ffffff');
    } else if (BUILDING_TYPES.has(p.action.type)) {
      drawBuilding(cx, p.y + p.h, p.action.type);
      drawPortalLabel(cx, p.y + p.h - TOWER_H - 12, p.label, '#ffffff');
    } else {
      ctx.fillStyle = 'rgba(224,85,78,0.5)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#c9453d';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      drawPortalLabel(cx, p.y + p.h / 2 + 4, p.label, '#ffffff');
    }
  }
}

function drawLandmarks(now) {
  for (const landmark of landmarks) {
    if (landmark.kind === 'fountain') {
      ctx.fillStyle = '#3d5a80';
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, landmark.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#98c1d9';
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, landmark.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else if (landmark.kind === 'raid_entrance') {
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      ctx.fillStyle = `rgba(120, 60, 140, ${0.35 + pulse * 0.15})`;
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, landmark.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c589ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, landmark.r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e5cfff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('레이드 입구', landmark.x, landmark.y + landmark.r + 16);
    }
  }
}

// ── 도트 스프라이트: 문자 그리드를 그대로 사각 픽셀로 찍는다(메이플식 '덩어리 픽셀' 느낌) ──
function drawPixelGrid(cx, cy, rows, palette, px) {
  const h = rows.length, w = rows[0].length;
  const startX = cx - (w * px) / 2;
  const startY = cy - h * px;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = palette[ch];
      ctx.fillRect(Math.round(startX + c * px), Math.round(startY + r * px), px, px);
    }
  }
  return { w: w * px, h: h * px };
}

const TREE_GRID = [
  '....A....',
  '...AAA...',
  '..AABAA..',
  '.AAAAAAA.',
  'AABAAABAA',
  '.AAAAAAA.',
  '..AAAAA..',
  '....C....',
  '....C....',
];
const ROCK_GRID = [
  '..AAA..',
  '.AAAAA.',
  'AABAABA',
  'AAAAAAA',
  '.ABAAB.',
  '..AAA..',
];
const HOUSE_GRID = [
  '..RRRRRR..',
  '.RRRRRRRR.',
  'RRRRRRRRRR',
  'RRRRRRRRRR',
  '.WWWWWWWW.',
  '.WWwwwwWW.',
  '.WWwwwwWW.',
  '.WWWDDWWW.',
  '.WWWDDWWW.',
  '.WWWDDWWW.',
];
// ── 대도시용 대형 건물(상점/대장간/스킬상점/회관/접수처) — 층을 더 쌓아 '진짜 도시' 느낌을 내는 큰 타워형 그리드 ──
const TOWER_GRID = [
  '...RRRR...',
  '..RRRRRR..',
  '.RRRRRRRR.',
  'RRRRRRRRRR',
  'RRRRRRRRRR',
  '.WWWWWWWW.',
  '.WWwwwwWW.',
  '.WWwwwwWW.',
  '.WWWWWWWW.',
  '.WWwwwwWW.',
  '.WWwwwwWW.',
  '.WWWWWWWW.',
  '.WWWDDWWW.',
  '.WWWDDWWW.',
  '.WWWDDWWW.',
];
const TOWER_PX = 7;
const TOWER_H = TOWER_GRID.length * TOWER_PX;

const TREE_TINTS = {
  field1: { A: '#4f9c3a', B: '#3d7e2c', C: '#7a5230' },
  field2: { A: '#a8963f', B: '#8c7a2f', C: '#6e4a28' },
  field3: { A: '#3a8f7a', B: '#2c7060', C: '#5c4530' },
  field5: { A: '#cfe6ee', B: '#aecdd9', C: '#8a7460' },
  greenforest: { A: '#2e7d3a', B: '#1f5e2a', C: '#4a3420' },
  default: { A: '#4f9c3a', B: '#3d7e2c', C: '#7a5230' },
};
const ROCK_TINTS = {
  field4: { A: '#a68a5c', B: '#8a7048' },
  field6: { A: '#b3684a', B: '#8f5138' },
  field7: { A: '#8c7f96', B: '#6e6478' },
  default: { A: '#9a9a94', B: '#7c7c76' },
};

function regionKeyAt(x, y) {
  for (const [key, box] of REGION_BOXES) if (inBox(x, y, box)) return key;
  return 'wild';
}

const STRUCTURE_GRID = [
  '..PPPP..',
  '.PPSPPS.',
  '.PPPPPP.',
  '..PSPP..',
  '..PPPP..',
  '..PSPP..',
  '.PPPPPP.',
  '.PPPPPP.',
];
const STRUCTURE_PALETTE = { P: '#9a9488', S: '#7c7668' };

// ── 지역별 테마 구조물 — 장애물 종류를 다양하게 만들어 필드마다 다른 볼거리를 준다 ──
const FENCE_GRID = [
  'P.....P',
  'P.....P',
  'PSSSSSP',
  'P.....P',
  'PSSSSSP',
  'P.....P',
  'P.....P',
];
const FENCE_PALETTE = { P: '#a9815a', S: '#7a5a34' };

const TOTEM_GRID = [
  '..PP..',
  '.PPPP.',
  '.PEEP.',
  '.PPPP.',
  '.PCCP.',
  '.PPPP.',
  '.PEEP.',
  '..PP..',
];
const TOTEM_PALETTE = { P: '#6e4a2c', E: '#e0c840', C: '#3f8a6f' };

const CAMPFIRE_GRID = [
  '..f..',
  '.fFf.',
  '.FFF.',
  'LLLLL',
  'L.L.L',
];
const CAMPFIRE_PALETTE = { f: '#ffd27a', F: '#ff8a3d', L: '#5a4022' };

const CAIRN_GRID = [
  '.A.',
  'AAA',
  '.B.',
  'BBB',
  'CCC',
];
const CAIRN_PALETTE = { A: '#e3f1f7', B: '#b9d4e0', C: '#8fa8b6' };

const CACTUS_GRID = [
  '..A..',
  'A.A.A',
  'A.A.A',
  'AAAAA',
  '..A..',
  '..A..',
  '..A..',
];
const CACTUS_PALETTE = { A: '#3f8a4a' };

const RUIN_WALL_GRID = [
  'PPPP.PPP',
  'PPPPSPPP',
  'PP...PPP',
  'PPPPPPPP',
  'PP.PPPS.',
  'PPPPPPPP',
];
const RUIN_WALL_PALETTE = { P: '#8f78a0', S: '#63536f' };

// ── 도시용 장식 구조물 — 진짜 도시처럼 민가·시장 좌판을 채워 넣음 ──
const STALL_GRID = [
  'AABBAABB',
  'AABBAABB',
  '........',
  '..PPPP..',
  '..P..P..',
  '..P..P..',
];
const STALL_PALETTE = { A: '#c94b3d', B: '#e8dcc0', P: '#5a4022' };

const HOUSE_PALETTES_CITY = [
  { R: '#8a4a3a', W: '#e6dcb8', w: '#bfe3f2', D: '#5a3a22' },
  { R: '#4a7a3a', W: '#e6dcb8', w: '#bfe3f2', D: '#5a3a22' },
  { R: '#6a4a8a', W: '#e6dcb8', w: '#bfe3f2', D: '#5a3a22' },
  { R: '#c9a23a', W: '#e0d8b0', w: '#bfe3f2', D: '#5a3a22' },
];

const STONE_WALL_GRID = [
  'AAAAAAAA',
  'ABBBBBBA',
  'AAAAAAAA',
  'ABBBBBBA',
  'AAAAAAAA',
];
const STONE_WALL_PALETTE = { A: '#8a8a86', B: '#75756f' };

const STRUCTURE_KINDS = {
  structure: { grid: STRUCTURE_GRID, palette: STRUCTURE_PALETTE, px: 4, shadowW: 18 },
  fence: { grid: FENCE_GRID, palette: FENCE_PALETTE, px: 4, shadowW: 22 },
  totem: { grid: TOTEM_GRID, palette: TOTEM_PALETTE, px: 4, shadowW: 14 },
  campfire: { grid: CAMPFIRE_GRID, palette: CAMPFIRE_PALETTE, px: 4, shadowW: 18 },
  cairn: { grid: CAIRN_GRID, palette: CAIRN_PALETTE, px: 5, shadowW: 16 },
  cactus: { grid: CACTUS_GRID, palette: CACTUS_PALETTE, px: 4, shadowW: 14 },
  ruinWall: { grid: RUIN_WALL_GRID, palette: RUIN_WALL_PALETTE, px: 4, shadowW: 24 },
  stall: { grid: STALL_GRID, palette: STALL_PALETTE, px: 5, shadowW: 30 },
  wallSeg: { grid: STONE_WALL_GRID, palette: STONE_WALL_PALETTE, px: 6, shadowW: 40 },
};

function drawObstacle(ob) {
  const themed = STRUCTURE_KINDS[ob.kind];
  const shadowW = themed ? themed.shadowW : ob.kind === 'tree' ? 22 : ob.kind === 'house' ? 54 : 20;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(ob.x, ob.y + 4, shadowW / 2, shadowW / 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (ob.kind === 'tree') {
    const tint = TREE_TINTS[regionKeyAt(ob.x, ob.y)] || TREE_TINTS.default;
    drawPixelGrid(ob.x, ob.y + 4, TREE_GRID, tint, 4);
  } else if (ob.kind === 'house') {
    const pal = HOUSE_PALETTES_CITY[Math.floor(pseudoRandom01(ob.x, ob.y) * HOUSE_PALETTES_CITY.length)];
    drawPixelGrid(ob.x, ob.y + 6, HOUSE_GRID, pal, 6);
  } else if (themed) {
    drawPixelGrid(ob.x, ob.y + 4, themed.grid, themed.palette, themed.px);
  } else {
    const tint = ROCK_TINTS[regionKeyAt(ob.x, ob.y)] || ROCK_TINTS.default;
    drawPixelGrid(ob.x, ob.y + 4, ROCK_GRID, tint, 4);
  }
}

const FLOWER_GRID = ['.F.', 'FFF', '.G.'];
const DIRT_GRID = ['.DD.', 'DDDd', 'dDDD', '.DD.'];
const FLOWER_COLORS = ['#ff8fb0', '#ffe27a', '#ffffff', '#c48fff'];

function pseudoRandom01(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const LAMP_GRID = ['.L.', '.L.', 'PPP', '.P.', '.P.'];
const LAMP_PALETTE = { L: '#ffe27a', P: '#4a453c' };

function drawDecoration(dec) {
  if (dec.kind === 'flower') {
    const color = FLOWER_COLORS[Math.floor(pseudoRandom01(dec.x, dec.y) * FLOWER_COLORS.length)];
    drawPixelGrid(dec.x, dec.y + 2, FLOWER_GRID, { F: color, G: '#3d7e2c' }, 3);
  } else if (dec.kind === 'dirt') {
    drawPixelGrid(dec.x, dec.y + 2, DIRT_GRID, { D: '#8a6f4c', d: '#71592f' }, 4);
  } else if (dec.kind === 'lamp') {
    ctx.fillStyle = 'rgba(255, 226, 122, 0.18)';
    ctx.beginPath();
    ctx.arc(dec.x, dec.y - 14, 20, 0, Math.PI * 2);
    ctx.fill();
    drawPixelGrid(dec.x, dec.y + 2, LAMP_GRID, LAMP_PALETTE, 4);
  }
}

const BUILDING_PALETTES = {
  shop: { R: '#3d6fa8', W: '#e6dcb8', w: '#bfe3f2', D: '#7a5230' },
  blacksmith: { R: '#a8442f', W: '#d9cdb0', w: '#6e6a66', D: '#5a4022' },
  skill_shop: { R: '#6a3d9e', W: '#e0d8ec', w: '#c9a8f0', D: '#4a2a6e' },
  guild_hall: { R: '#a88a2f', W: '#e6dcc0', w: '#e8c878', D: '#6e5420' },
  raid_list: { R: '#7a4a3a', W: '#d9c8a8', w: '#e0857a', D: '#5a3a28' },
  market: { R: '#2f8a5a', W: '#e0e6c8', w: '#ffe27a', D: '#3a5a2a' },
};

function drawBuilding(cx, cy, kind) {
  const pal = BUILDING_PALETTES[kind] || BUILDING_PALETTES.shop;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6, 42, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPixelGrid(cx, cy + 6, TOWER_GRID, pal, TOWER_PX);
  // 옥상 간판 — 대도시 느낌을 주는 네온풍 상호명 표시
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(cx - 3, cy + 6 - TOWER_H - 10, 6, 10);
}

function drawHpBar(x, y, w, hp, maxHp, big) {
  const h = big ? 8 : 5;
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  ctx.fillStyle = '#12131c';
  ctx.fillRect(x - w / 2, y, w, h);
  ctx.fillStyle = pct <= 0.25 ? '#e0554e' : pct <= 0.5 ? '#e08a4e' : '#7fd08a';
  ctx.fillRect(x - w / 2, y, w * pct, h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2, y, w, h);
}

function drawChatBubble(x, y, text) {
  ctx.font = '12px sans-serif';
  const padX = 8, padY = 5;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 18;
  const bx = x - w / 2, by = y - 46;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(bx, by, w, h, 6) : ctx.rect(bx, by, w, h);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#23253a';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, by + h - padY);
}

function drawSwing(x, y, facing) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  // 베기 궤적 — 은은한 부채꼴 채움
  ctx.fillStyle = 'rgba(255, 230, 160, 0.35)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 48, -0.95, 0.95);
  ctx.closePath();
  ctx.fill();
  // 칼날 궤적 — 검광(흰빛 스트로크) + 잔광(금빛 스트로크)
  ctx.strokeStyle = 'rgba(255, 245, 210, 0.55)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0, 0, 40, -0.7, 0.7);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 47, -0.85, 0.85);
  ctx.stroke();
  ctx.restore();
}

// ── 장착 무기 디자인 — 도형 기반(도트 아님)으로 손에 든 검을 표현, 등급별로 형태·색이 다름 ──
const WEAPON_VISUALS = {
  starter:         { len: 15, width: 3.2, blade: '#9a958a', edge: '#c4beb0', hilt: '#5a4a34' },
  silverSword:     { len: 17, width: 3.4, blade: '#c7ced8', edge: '#eef2f7', hilt: '#4a4a52' },
  goldSword:       { len: 18, width: 3.6, blade: '#e0c258', edge: '#fff0b0', hilt: '#5a4420' },
  flameSword:      { len: 17, width: 3.6, blade: '#e0542f', edge: '#ffcf94', hilt: '#3a2418', glow: 'rgba(255,110,40,0.5)' },
  frostSword:      { len: 17, width: 3.6, blade: '#7fd0ec', edge: '#e4f8ff', hilt: '#26333a', glow: 'rgba(120,210,255,0.5)' },
  steelSword:      { len: 20, width: 3.8, blade: '#8a97a8', edge: '#e4eaf2', hilt: '#2e2e34' },
  diamondSword:    { len: 21, width: 4.0, blade: '#bfe9f5', edge: '#ffffff', hilt: '#33424a', glow: 'rgba(180,235,255,0.45)' },
  radiantSword:    { len: 23, width: 4.2, blade: '#fff2b8', edge: '#ffffff', hilt: '#6a5a2a', glow: 'rgba(255,235,160,0.6)' },
  windBreathSword: { len: 25, width: 4.2, blade: '#9ef2c8', edge: '#eafff2', hilt: '#2c4a3a', glow: 'rgba(140,255,200,0.5)', wispy: true },
  masterySword:    { len: 28, width: 4.6, blade: '#3a1a5e', edge: '#ff6ad5', hilt: '#1a0a2a', glow: 'rgba(255,90,220,0.55)', sparkle: true },
};
function drawWeaponInHand(weaponKey) {
  const now = performance.now();
  const wv = WEAPON_VISUALS[weaponKey] || WEAPON_VISUALS.starter;
  const baseX = 9;
  const tipX = baseX + wv.len;

  if (wv.glow) {
    ctx.fillStyle = wv.glow;
    ctx.beginPath();
    ctx.arc((baseX + tipX) / 2, 0, wv.len * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = wv.hilt;
  ctx.fillRect(baseX - 4, -1.6, 5, 3.2);
  ctx.fillRect(baseX, -4, 1.6, 8);

  ctx.fillStyle = wv.blade;
  ctx.beginPath();
  ctx.moveTo(baseX + 1, -wv.width / 2);
  ctx.lineTo(tipX - 3, -wv.width / 2);
  ctx.lineTo(tipX, 0);
  ctx.lineTo(tipX - 3, wv.width / 2);
  ctx.lineTo(baseX + 1, wv.width / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = wv.edge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseX + 1, 0);
  ctx.lineTo(tipX, 0);
  ctx.stroke();

  if (wv.sparkle) {
    const s = 0.5 + 0.5 * Math.sin(now / 130);
    ctx.fillStyle = `rgba(255,255,255,${0.4 + s * 0.5})`;
    ctx.beginPath();
    ctx.arc(baseX + wv.len * 0.6, -wv.width * 0.7, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wv.wispy) {
    ctx.strokeStyle = 'rgba(200,255,225,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const off = Math.sin(now / 150 + i * 2) * 3;
      ctx.beginPath();
      ctx.moveTo(baseX + wv.len * 0.4, off - 2 - i * 3);
      ctx.lineTo(baseX + wv.len * 0.75, off + 2 - i * 3);
      ctx.stroke();
    }
  }
}

// ── 캐릭터: 도트 그리드 대신 도형(원·삼각형) 조합 — 최종 컨셉으로 확정 ──
function drawPlayer(x, y, facing, name, isSelf, swinging, flashing, weaponKey) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 11, 12.6, 5.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(facing || 0);
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_R + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(30,26,20,0.55)';
  ctx.fill();
  ctx.fillStyle = flashing ? '#ff8b8b' : (isSelf ? '#e0a458' : '#7fb8a0');
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isSelf ? '#ffd699' : '#cdeee0';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawWeaponInHand(weaponKey || 'starter');

  ctx.restore();

  if (swinging) drawSwing(x, y, facing || 0);

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeText(name + (isSelf ? ' (나)' : ''), x, y - 24);
  ctx.fillStyle = '#f0f1fa';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name + (isSelf ? ' (나)' : ''), x, y - 24);
}

const MONSTER_COLORS = {
  slime: { body: '#5a9c4a', hi: '#8fd67c', flash: '#e8fbd8', flashHi: '#ffffff' },
  mushroom: { body: '#b5652f', hi: '#e8a45c', flash: '#ffe4c2', flashHi: '#ffffff' },
  wolf: { body: '#6a6d7a', hi: '#a3a7ba', flash: '#e8e9f0', flashHi: '#ffffff' },
  frog: { body: '#2f8f6a', hi: '#6cd6a8', flash: '#d8fff0', flashHi: '#ffffff' },
  scorpion: { body: '#a68c3d', hi: '#e0c878', flash: '#fff2c2', flashHi: '#ffffff' },
  bat: { body: '#4a3d6e', hi: '#8a78c4', flash: '#e4dcff', flashHi: '#ffffff' },
  golem: { body: '#5c5c52', hi: '#9a9a88', flash: '#e8e8d8', flashHi: '#ffffff' },
  iceSlimeKing: { body: '#3d6f9e', hi: '#8fd0ec', flash: '#eaf7ff', flashHi: '#ffffff' },
  flameAlphaWolf: { body: '#8f3020', hi: '#e8703a', flash: '#ffd8a8', flashHi: '#ffffff' },
  swampFrogKing: { body: '#1f6a4e', hi: '#4fcf9e', flash: '#d8fff0', flashHi: '#ffffff' },
  canyonScorpionKing: { body: '#8a5a1f', hi: '#e8b84f', flash: '#fff2c2', flashHi: '#ffffff' },
  frostBatLord: { body: '#3a2f6e', hi: '#9a8ce0', flash: '#e4dcff', flashHi: '#ffffff' },
  magmaGolem: { body: '#7a2010', hi: '#ff7a3a', flash: '#ffd8a8', flashHi: '#ffffff' },
  ruinGuardian: { body: '#5a4f6e', hi: '#9a8cb0', flash: '#e8e0f0', flashHi: '#ffffff' },
  // 필드 정예 몬스터 — 원래 잡몹 색을 좀 더 짙고 진하게, 금빛 하이라이트로 구분
  slimeChief: { body: '#3a7a2c', hi: '#ffd45c', flash: '#f2ffd8', flashHi: '#ffffff' },
  wolfAlpha: { body: '#4a4d5e', hi: '#ffd45c', flash: '#e8e9f0', flashHi: '#ffffff' },
  bogQueen: { body: '#1f6a4e', hi: '#ffd45c', flash: '#d8fff0', flashHi: '#ffffff' },
  sandstalker: { body: '#7a6420', hi: '#ffd45c', flash: '#fff2c2', flashHi: '#ffffff' },
  frostReaver: { body: '#332a5e', hi: '#ffd45c', flash: '#e4dcff', flashHi: '#ffffff' },
  duneWarden: { body: '#443f38', hi: '#ffd45c', flash: '#e8e8d8', flashHi: '#ffffff' },
  ruinSentinel: { body: '#443f38', hi: '#ffd45c', flash: '#e8e8d8', flashHi: '#ffffff' },
  // 마을/그린 숲/물의 신전 — 새 지역 몬스터
  goblin: { body: '#5a7a3a', hi: '#a8d67c', flash: '#e8fbd8', flashHi: '#ffffff' },
  treant: { body: '#4a3420', hi: '#7a9c4a', flash: '#e8f0d8', flashHi: '#ffffff' },
  naga: { body: '#2f6a8f', hi: '#6cc4e8', flash: '#d8f4ff', flashHi: '#ffffff' },
  goblinWarlord: { body: '#3a5a1c', hi: '#ffd45c', flash: '#e8fbd8', flashHi: '#ffffff' },
  ancientTreantLord: { body: '#2e2010', hi: '#ffd45c', flash: '#e8f0d8', flashHi: '#ffffff' },
  abyssalNaga: { body: '#1a3a5e', hi: '#ffd45c', flash: '#d8f4ff', flashHi: '#ffffff' },
  goblinChief: { body: '#3a5a1c', hi: '#ffd45c', flash: '#e8fbd8', flashHi: '#ffffff' },
  ancientTreant: { body: '#3a2c18', hi: '#ffd45c', flash: '#e8f0d8', flashHi: '#ffffff' },
  nagaPriestess: { body: '#1f5a7e', hi: '#ffd45c', flash: '#d8f4ff', flashHi: '#ffffff' },
};

function drawMonster(x, y, kind, hp, maxHp, flashing, squashX, squashY, isBoss, phase, now, isElite) {
  const c = MONSTER_COLORS[kind] || MONSTER_COLORS.slime;
  const r = isBoss ? MONSTER_R * 1.9 : isElite ? MONSTER_R * 1.4 : MONSTER_R;

  if (isBoss && (phase === 'telegraph' || phase === 'dash')) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 60);
    ctx.strokeStyle = `rgba(255, 90, 90, ${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 8 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isElite) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    ctx.strokeStyle = `rgba(255, 212, 92, ${0.55 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squashX || 1, squashY || 1);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.75, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(20,18,14,0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 0, r + 1.3, r * 0.85 + 1.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = flashing ? c.flash : c.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = flashing ? c.flashHi : c.hi;
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.25, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1c2a18';
  ctx.beginPath();
  ctx.arc(-r * 0.33, r * 0.08, r * 0.13, 0, Math.PI * 2);
  ctx.arc(r * 0.33, r * 0.08, r * 0.13, 0, Math.PI * 2);
  ctx.fill();

  if (isBoss) {
    // 왕관 — 도형(삼각형 3개)으로 표시
    ctx.fillStyle = '#ffd45c';
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -r * 0.8);
    ctx.lineTo(-r * 0.25, -r * 1.2);
    ctx.lineTo(-r * 0.1, -r * 0.8);
    ctx.closePath();
    ctx.moveTo(-r * 0.12, -r * 0.8);
    ctx.lineTo(0, -r * 1.35);
    ctx.lineTo(r * 0.12, -r * 0.8);
    ctx.closePath();
    ctx.moveTo(r * 0.1, -r * 0.8);
    ctx.lineTo(r * 0.25, -r * 1.2);
    ctx.lineTo(r * 0.4, -r * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  if (hp != null && maxHp) {
    if (isBoss) {
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const bossName = MONSTER_COLORS[kind] ? monsterName(kind) : kind;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(bossName, x, y - r - 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(bossName, x, y - r - 22);
      drawHpBar(x, y - r - 16, 70, hp, maxHp, true);
    } else if (isElite) {
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      const eliteName = monsterName(kind);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(eliteName, x, y - r - 18);
      ctx.fillStyle = '#ffd45c';
      ctx.fillText(eliteName, x, y - r - 18);
      drawHpBar(x, y - r - 12, 46, hp, maxHp, false);
    } else {
      drawHpBar(x, y - r - 12, 28, hp, maxHp, false);
    }
  }
}

function monsterName(kind) {
  return {
    slime: '슬라임', mushroom: '버섯', wolf: '들개', frog: '개구리', scorpion: '전갈', bat: '박쥐', golem: '골렘',
    iceSlimeKing: '얼음 슬라임 킹', flameAlphaWolf: '불꽃 들개 대장',
    slimeChief: '점액 대장', wolfAlpha: '외눈 들개 우두머리', bogQueen: '늪지 여왕개구리', sandstalker: '쌍갈래 전갈',
    frostReaver: '서리 박쥐 떼대장', duneWarden: '사막 골렘 수문장', ruinSentinel: '폐허의 파수병',
    swampFrogKing: '독늪 개구리왕', canyonScorpionKing: '모래폭풍 전갈왕', frostBatLord: '서리 박쥐 군주',
    magmaGolem: '용암 골렘', ruinGuardian: '폐허의 수호자',
    goblin: '고블린', treant: '덩굴괴물', naga: '물의 정령',
    goblinWarlord: '고블린 대장', ancientTreantLord: '고대 정령수', abyssalNaga: '심연의 나가',
    goblinChief: '고블린 우두머리', ancientTreant: '늙은 덩굴괴물', nagaPriestess: '나가 여사제',
  }[kind] || kind;
}

function drawImpacts(now) {
  for (let i = impacts.length - 1; i >= 0; i--) {
    const im = impacts[i];
    const age = now - im.born;
    if (age > 220) { impacts.splice(i, 1); continue; }
    const t = age / 220;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = im.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(im.x, im.y, 6 + t * 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawSparks(now) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    const age = now - s.born;
    if (age > 320) { sparks.splice(i, 1); continue; }
    const t = age / 1000;
    const x = s.x + s.vx * t;
    const y = s.y + s.vy * t + 60 * t * t;
    ctx.globalAlpha = 1 - age / 320;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ── 원거리 공격 투사체(화살/마법탄) — 서버가 준 시작 속도로 클라이언트가 직접 시뮬레이션(도형으로 표현) ──
const PROJECTILE_TINTS = {
  multi: { glow: 'rgba(126, 224, 120, 0.4)', shaft: '#8fd67e', head: '#d8f5c8' },
  pierce: { glow: 'rgba(160, 220, 255, 0.5)', shaft: '#bfe8ff', head: '#ffffff' },
  default: { glow: 'rgba(255, 210, 120, 0.35)', shaft: '#caa15a', head: '#e8dcc0' },
};
function drawProjectiles(now) {
  for (const [id, proj] of projectiles) {
    const age = now - proj.bornAt;
    if (age > proj.maxLife) { projectiles.delete(id); continue; }
    const t = age / 1000;
    const x = proj.x + proj.vx * t, y = proj.y + proj.vy * t;
    const angle = Math.atan2(proj.vy, proj.vx);

    // 잔상 트레일 — 화살/구슬 뒤로 옅어지는 자취를 남겨 속도감을 줌
    proj.trail.push({ x, y, born: now });
    while (proj.trail.length && now - proj.trail[0].born > 140) proj.trail.shift();
    for (let i = 0; i < proj.trail.length; i++) {
      const pt = proj.trail[i];
      const trailAge = (now - pt.born) / 140;
      const tint = proj.classKey === 'healer' ? 'rgba(126, 224, 189,' : PROJECTILE_TINTS[proj.tag] ? PROJECTILE_TINTS[proj.tag].glow.replace(/[\d.]+\)$/, '') : 'rgba(255, 210, 120,';
      ctx.fillStyle = `${tint}${(1 - trailAge) * 0.25})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5 * (1 - trailAge * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (proj.classKey === 'healer') {
      ctx.fillStyle = 'rgba(126, 224, 189, 0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a8f0d4';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const tint = PROJECTILE_TINTS[proj.tag] || PROJECTILE_TINTS.default;
      if (proj.tag) {
        ctx.fillStyle = tint.glow;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = tint.shaft;
      ctx.lineWidth = proj.tag === 'pierce' ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.fillStyle = tint.head;
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(4, -4);
      ctx.lineTo(4, 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// 치유류 스킬에 곁들이는 반짝이 파티클 — 메이플식 힐 이펙트 느낌
function drawRisingSparkles(cx, cy, spread, t, rgb) {
  const count = 6;
  for (let s = 0; s < count; s++) {
    const seed = s * 47.13;
    const ang = (Math.sin(seed) * 0.5 + 0.5) * Math.PI * 2;
    const dist = (Math.cos(seed * 1.7) * 0.5 + 0.5) * spread * 0.8;
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist - t * 26;
    ctx.fillStyle = `rgba(${rgb}, ${(1 - t) * 0.8})`;
    ctx.beginPath();
    ctx.arc(px, py, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSkillFx(now) {
  for (let i = skillFx.length - 1; i >= 0; i--) {
    const fx = skillFx[i];
    const age = now - fx.born;
    if (fx.skill === 'healPulse') {
      if (age > 500) { skillFx.splice(i, 1); continue; }
      const t = age / 500;
      ctx.strokeStyle = `rgba(126, 224, 189, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, (fx.radius || 150) * t, 0, Math.PI * 2);
      ctx.stroke();
      drawRisingSparkles(fx.x, fx.y, fx.radius || 150, t, '167, 240, 200');
    } else if (fx.skill === 'selfHeal') {
      if (age > 450) { skillFx.splice(i, 1); continue; }
      const t = age / 450;
      ctx.strokeStyle = `rgba(126, 224, 189, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 20 + t * 12, 0, Math.PI * 2);
      ctx.stroke();
      drawRisingSparkles(fx.x, fx.y, 26, t, '167, 240, 200');
    } else if (fx.skill === 'whirlwind') {
      if (age > 380) { skillFx.splice(i, 1); continue; }
      const t = age / 380;
      const r = (fx.radius || 75) * (0.4 + t * 0.6);
      ctx.strokeStyle = `rgba(255, 180, 90, ${1 - t})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // 회전하는 칼날 궤적 — 빙글빙글 도는 느낌을 강조
      const blades = 6;
      for (let s = 0; s < blades; s++) {
        const ang = (s / blades) * Math.PI * 2 + t * 9;
        ctx.strokeStyle = `rgba(255, 230, 170, ${0.8 * (1 - t)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, ang, ang + 0.5);
        ctx.stroke();
      }
    } else if (fx.skill === 'guard' || fx.skill === 'barrier') {
      if (age > 3000) { skillFx.splice(i, 1); continue; }
      const owner = players.get(fx.id);
      const cx = owner && owner.renderX != null ? owner.renderX : fx.x;
      const cy = owner && owner.renderY != null ? owner.renderY : fx.y;
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      const fade = age > 2600 ? 1 - (age - 2600) / 400 : 1;
      const color = fx.skill === 'barrier' ? '140, 190, 255' : '255, 190, 110';
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = `rgba(${color}, ${0.12 * fade})`;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${color}, ${(0.45 + pulse * 0.35) * fade})`;
      ctx.lineWidth = 2;
      ctx.rotate(now / 900);
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const ang = (s / 6) * Math.PI * 2;
        const px = Math.cos(ang) * 24, py = Math.sin(ang) * 24;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    } else if (fx.skill === 'multiShot') {
      if (age > 260) { skillFx.splice(i, 1); continue; }
      const t = age / 260;
      const facing = fx.facing || 0;
      for (const off of [-0.3, 0, 0.3]) {
        const ang = facing + off;
        ctx.strokeStyle = `rgba(150, 230, 140, ${0.8 * (1 - t)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * 14, fx.y + Math.sin(ang) * 14);
        ctx.lineTo(fx.x + Math.cos(ang) * (14 + 30 * t), fx.y + Math.sin(ang) * (14 + 30 * t));
        ctx.stroke();
      }
    } else if (fx.skill === 'piercingShot') {
      if (age > 260) { skillFx.splice(i, 1); continue; }
      const t = age / 260;
      const facing = fx.facing || 0;
      ctx.strokeStyle = `rgba(190, 232, 255, ${0.9 * (1 - t)})`;
      ctx.lineWidth = 5 * (1 - t * 0.5);
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y);
      ctx.lineTo(fx.x + Math.cos(facing) * (20 + 60 * t), fx.y + Math.sin(facing) * (20 + 60 * t));
      ctx.stroke();
    } else if (fx.skill === 'slowField') {
      if (age > 500) { skillFx.splice(i, 1); continue; }
      const t = age / 500;
      ctx.strokeStyle = `rgba(150, 120, 220, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, (fx.radius || 160) * t, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.skill === 'curse523') {
      const DUR = 650;
      if (age > DUR) { skillFx.splice(i, 1); continue; }
      const t = age / DUR;
      const r = (fx.radius || 260) * Math.min(1, t * 1.4);
      ctx.save();
      ctx.fillStyle = `rgba(60, 0, 90, ${0.28 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(210, 90, 255, ${0.9 * (1 - t)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      const spikes = 8;
      for (let s = 0; s < spikes; s++) {
        const ang = (s / spikes) * Math.PI * 2 + t * 2;
        const inner = r * 0.5, outer = r * (1 + 0.15 * Math.sin(t * 20 + s));
        ctx.strokeStyle = `rgba(180, 60, 255, ${0.7 * (1 - t)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * inner, fx.y + Math.sin(ang) * inner);
        ctx.lineTo(fx.x + Math.cos(ang) * outer, fx.y + Math.sin(ang) * outer);
        ctx.stroke();
      }
      // "523" 대사 텍스트 — 팍 튀어나왔다가 사라지는 스킬 연출
      const textDur = 550;
      if (age <= textDur) {
        const tt = age / textDur;
        const popIn = Math.min(1, tt / 0.22);
        const scale = 0.5 + popIn * 0.9 - (tt > 0.7 ? (tt - 0.7) / 0.3 * 0.25 : 0);
        const textAlpha = tt < 0.72 ? 1 : Math.max(0, 1 - (tt - 0.72) / 0.28);
        ctx.translate(fx.x, fx.y - 44);
        ctx.scale(scale, scale);
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 7;
        ctx.strokeStyle = `rgba(25, 0, 35, ${textAlpha})`;
        ctx.strokeText('523', 0, 0);
        ctx.fillStyle = `rgba(224, 130, 255, ${textAlpha})`;
        ctx.fillText('523', 0, 0);
      }
      ctx.restore();
    } else {
      skillFx.splice(i, 1);
    }
  }
}

function drawOverviewBox(mx, my, scaleX, scaleY, box, color, blobKey) {
  ctx.fillStyle = color;
  const blob = blobKey && REGION_BLOB_PATHS[blobKey];
  if (blob) {
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(scaleX, scaleY);
    ctx.fill(blob);
    ctx.restore();
  } else {
    ctx.fillRect(mx + box.xMin * scaleX, my + box.yMin * scaleY, (box.xMax - box.xMin) * scaleX, (box.yMax - box.yMin) * scaleY);
  }
}

// 필드마다 소재지 역할을 하는 도시로 흙길이 이어진다는 설정 — 레이드 접수처가 있는 도시와 동일
const FIELD_HUB_BOX = {
  field1: CAPITAL_BOX, field2: CAPITAL_BOX, field3: CAPITAL_BOX,
  field4: SECOND_CITY_BOX, field5: SECOND_CITY_BOX, field6: SECOND_CITY_BOX, field7: SECOND_CITY_BOX,
};
function regionCenter(box) { return { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 }; }

function drawWorldOverview(mx, my, mw, mh, showLabels) {
  ensureBlobPaths();
  const scaleX = mw / WORLD.w, scaleY = mh / WORLD.h;
  // 지도 배경을 검은 허공이 아니라 실제 필드 사이를 채우는 초록 들판 톤으로 — 지역들이 하나로 이어진 땅처럼 보이게
  ctx.fillStyle = '#4c6b3d';
  ctx.fillRect(mx, my, mw, mh);
  if (WORLD.w > VIEW_W) {
    // 각 필드에서 담당 도시까지 이어지는 흙길 — 지역이 뚝뚝 끊긴 섬이 아니라 서로 연결된 세계임을 보여줌
    ctx.strokeStyle = 'rgba(154, 118, 74, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    for (const [key, box] of Object.entries(FIELD_BOXES_CLIENT)) {
      const hub = FIELD_HUB_BOX[key];
      const c1 = regionCenter(box), c2 = regionCenter(hub);
      ctx.beginPath();
      ctx.moveTo(mx + c1.x * scaleX, my + c1.y * scaleY);
      ctx.lineTo(mx + c2.x * scaleX, my + c2.y * scaleY);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    drawOverviewBox(mx, my, scaleX, scaleY, FIELD1_BOX, REGION_PALETTE.field1[0], 'field1');
    drawOverviewBox(mx, my, scaleX, scaleY, FIELD2_BOX, REGION_PALETTE.field2[0], 'field2');
    drawOverviewBox(mx, my, scaleX, scaleY, FIELD3_BOX, REGION_PALETTE.field3[0], 'field3');
    drawOverviewBox(mx, my, scaleX, scaleY, FIELD4_BOX, REGION_PALETTE.field4[0], 'field4');
    drawOverviewBox(mx, my, scaleX, scaleY, FIELD5_BOX, REGION_PALETTE.field5[0], 'field5');
    drawOverviewBox(mx, my, scaleX, scaleY, FIELD6_BOX, REGION_PALETTE.field6[0], 'field6');
    drawOverviewBox(mx, my, scaleX, scaleY, FIELD7_BOX, REGION_PALETTE.field7[0], 'field7');
    drawOverviewBox(mx, my, scaleX, scaleY, VILLAGE_BOX, REGION_PALETTE.village[0], 'village');
    drawOverviewBox(mx, my, scaleX, scaleY, GREEN_FOREST_BOX, REGION_PALETTE.greenforest[0], 'greenforest');
    drawOverviewBox(mx, my, scaleX, scaleY, WATER_TEMPLE_BOX, REGION_PALETTE.watertemple[0], 'watertemple');
    drawOverviewBox(mx, my, scaleX, scaleY, CAPITAL_BOX, REGION_PALETTE.capital[0]);
    drawOverviewBox(mx, my, scaleX, scaleY, SECOND_CITY_BOX, REGION_PALETTE.frontier[0]);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);

  for (const lm of landmarks) {
    if (lm.kind !== 'fountain') continue; // 레이드 입구는 지도에 표시하지 않음 — 직접 찾아야 함
    ctx.fillStyle = '#98c1d9';
    ctx.beginPath();
    ctx.arc(mx + lm.x * scaleX, my + lm.y * scaleY, showLabels ? 4 : 2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const [id, p] of players) {
    if (p.renderX == null) continue;
    ctx.fillStyle = id === selfId ? '#ffd699' : '#7fb8a0';
    ctx.beginPath();
    ctx.arc(mx + p.renderX * scaleX, my + p.renderY * scaleY, id === selfId ? (showLabels ? 5 : 2.5) : (showLabels ? 3.5 : 1.8), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + camera.x * scaleX, my + camera.y * scaleY, VIEW_W * scaleX, VIEW_H * scaleY);

  if (showLabels && WORLD.w > VIEW_W) {
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#33352f';
    const cx = b => mx + (b.xMin + b.xMax) / 2 * scaleX;
    const cy = b => my + (b.yMin + b.yMax) / 2 * scaleY;
    const labelBoxes = [
      [FIELD1_BOX, '들꽃 초원'], [FIELD2_BOX, '황혼 언덕'], [FIELD3_BOX, '축축한 습지'], [FIELD4_BOX, '메마른 협곡'],
      [FIELD5_BOX, '얼어붙은 봉우리'], [FIELD6_BOX, '불타는 사막'], [FIELD7_BOX, '잊혀진 폐허'],
      [VILLAGE_BOX, '마을'], [GREEN_FOREST_BOX, '그린 숲'], [WATER_TEMPLE_BOX, '물의 신전'],
      [CAPITAL_BOX, '대도시'], [SECOND_CITY_BOX, '변방 도시'],
    ];
    for (const [box, name] of labelBoxes) {
      ctx.strokeText(name, cx(box), cy(box) + 4);
      ctx.fillText(name, cx(box), cy(box) + 4);
    }
  }
}

function drawMinimap() {
  if (WORLD.w <= VIEW_W) return;
  const mw = 130, mh = 130, mx = VIEW_W - mw - 12, my = 12;
  ctx.fillStyle = 'rgba(10,11,18,0.8)';
  ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
  drawWorldOverview(mx, my, mw, mh, false);
  ctx.fillStyle = '#9aa0c0';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('M: 전체 지도', mx + mw / 2, my + mh + 14);
}

function drawFullMap() {
  ctx.fillStyle = 'rgba(8, 9, 15, 0.88)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const mh = 440, mw = 440, mx = (VIEW_W - mw) / 2, my = (VIEW_H - mh) / 2 + 6;
  ctx.fillStyle = '#e8e9f5';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('전체 지도 (M으로 닫기)', VIEW_W / 2, my - 14);
  drawWorldOverview(mx, my, mw, mh, true);
}

function drawFloatingTexts(now) {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const t = floatingTexts[i];
    const age = now - t.born;
    if (age > 700) { floatingTexts.splice(i, 1); continue; }
    const alpha = 1 - age / 700;
    const popT = Math.min(1, age / 110);
    const overshoot = popT < 1 ? 1 + (1 - popT) * 0.8 : 1;
    const scale = t.popScale * overshoot;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = t.color;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.translate(t.x, t.y - (age / 700) * 26);
    ctx.scale(scale, scale);
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
}

const CORRECTION_PER_SEC = 10;

function updateSelf(dt, self) {
  const locked = performance.now() < (self.controlLockUntil || 0);
  let dx = 0, dy = 0;
  if (!locked) {
    if (keys.has('up')) dy -= 1;
    if (keys.has('down')) dy += 1;
    if (keys.has('left')) dx -= 1;
    if (keys.has('right')) dx += 1;
  }
  let targetVx = 0, targetVy = 0;
  const hasInput = dx !== 0 || dy !== 0;
  if (hasInput) {
    const len = Math.hypot(dx, dy);
    targetVx = (dx / len) * SPEED;
    targetVy = (dy / len) * SPEED;
  }
  const rate = hasInput ? MOVE_ACCEL : MOVE_DECEL;
  self.vx = approach(self.vx, targetVx, rate, dt);
  self.vy = approach(self.vy, targetVy, rate, dt);
  self.predicted.x += self.vx * dt;
  self.predicted.y += self.vy * dt;

  clampToWorld(self.predicted);
  resolveLandmarkCollision(self.predicted);
  clampToWorld(self.predicted);

  const errX = self.serverTarget.x - self.predicted.x;
  const errY = self.serverTarget.y - self.predicted.y;
  const errDist = Math.hypot(errX, errY);
  if (errDist > 60) {
    self.predicted.x = self.serverTarget.x;
    self.predicted.y = self.serverTarget.y;
  } else {
    const k = Math.min(1, CORRECTION_PER_SEC * dt);
    self.predicted.x += errX * k;
    self.predicted.y += errY * k;
  }

  self.renderX = self.predicted.x;
  self.renderY = self.predicted.y;
  if (isTouchDevice) {
    if (manualFacing !== null) self.facing = manualFacing;
  } else {
    const worldMouseX = mouse.x + camera.x, worldMouseY = mouse.y + camera.y;
    self.facing = Math.atan2(worldMouseY - self.renderY, worldMouseX - self.renderX);
  }
  if (lastSentFacing === null || Math.abs(self.facing - lastSentFacing) > 0.03) {
    lastSentFacing = self.facing;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'aim', facing: self.facing }));
  }
}

function updateRemote(now, p) {
  const t = TICK_MS > 0 ? Math.min(1, (now - p.recvTime) / TICK_MS) : 1;
  p.renderX = p.prevX + (p.x - p.prevX) * t;
  p.renderY = p.prevY + (p.y - p.prevY) * t;
}

let lastTime = performance.now();
let fpsFrames = 0, fpsTimer = 0, fpsShown = 0;

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  fpsFrames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsShown = Math.round(fpsFrames / fpsTimer);
    fpsFrames = 0;
    fpsTimer = 0;
  }

  const inHitStop = now < hitStopUntil;
  const self = selfId != null ? players.get(selfId) : null;
  if (!inHitStop) {
    updateCamera(self);
    if (self) updateSelf(dt, self);
    for (const [id, p] of players) {
      if (id !== selfId) updateRemote(now, p);
    }
    for (const m of monsters.values()) updateRemote(now, m);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  let shakeX = 0, shakeY = 0;
  if (now < shake.until) {
    const frac = (shake.until - now) / (shake.until - shake.startAt);
    const mag = shake.mag * frac;
    shakeX = (Math.random() * 2 - 1) * mag;
    shakeY = (Math.random() * 2 - 1) * mag;
  }
  ctx.translate(Math.round(shakeX - camera.x), Math.round(shakeY - camera.y));

  drawFloor();
  for (const dec of decorations) drawDecoration(dec);
  drawPortals();
  drawLandmarks(now);
  for (const ob of obstacles) drawObstacle(ob);
  drawWalls();
  for (const m of monsters.values()) {
    if (m.renderX == null) continue;
    const flashing = m.flashUntil && now < m.flashUntil;
    let squashX = 1, squashY = 1;
    if (m.hitBorn) {
      const age = now - m.hitBorn;
      if (age < 150) {
        const t = age / 150;
        const wobble = Math.sin(t * Math.PI);
        squashX = 1 + wobble * 0.28;
        squashY = 1 - wobble * 0.28;
      }
    }
    drawMonster(m.renderX, m.renderY, m.kind, m.hp, m.maxHp, flashing, squashX, squashY, m.isBoss, m.phase, now, m.isElite);
  }
  for (const [id, p] of players) {
    if (p.renderX == null) continue;
    const swinging = p.swingUntil && now < p.swingUntil;
    const flashing = p.flashUntil && now < p.flashUntil;
    const tag = `Lv.${p.level || 1} ${p.guildTag ? `[${p.guildTag}] ` : ''}${p.name}`;
    drawPlayer(p.renderX, p.renderY, p.facing, tag, id === selfId, swinging, flashing, p.weaponKey, p.weaponElement);
    if (p.chatBubble && now < p.chatBubble.until) drawChatBubble(p.renderX, p.renderY, p.chatBubble.text);
  }
  drawSkillFx(now);
  drawProjectiles(now);
  drawSparks(now);
  drawImpacts(now);
  drawFloatingTexts(now);
  ctx.restore();

  if (hasMap) drawMinimap();
  if (hasMap && showFullMap) drawFullMap();

  speedReadout.textContent = players.size + '명 접속';
  fpsReadout.textContent = fpsShown || '-';
  if (self) hpReadout.textContent = `${Math.round(self.hp)} / ${self.maxHp}`;
  expReadout.textContent = selfExp;
  goldReadout.textContent = selfGold;
  weaponReadout.textContent = `${selfWeapon.name} (${selfWeapon.durability}/${selfWeapon.maxDurability})`;
  if (currentClass) {
    [0, 1].forEach(slot => {
      const el = slot === 0 ? skillReadout : skillReadout2;
      const skillKey = equippedSkills[slot];
      if (!skillKey) { el.textContent = '(없음)'; return; }
      const remain = skillReadyAt[slot] - now;
      const name = SKILL_DEFS[skillKey].name;
      el.textContent = remain > 0 ? `${name} (${(remain / 1000).toFixed(1)}초)` : `${name} 준비됨`;
    });
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
