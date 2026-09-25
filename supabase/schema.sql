-- PixelRealm — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 실행하세요.
-- 서버는 service_role 키로만 접속하므로(클라이언트에 노출 안 됨) RLS는 켜지 않습니다.

create table if not exists users (
  username text primary key,
  salt text not null,
  password_hash text not null,
  nickname text not null,
  created_at bigint not null,
  class_key text,
  has_chosen_class boolean not null default false,
  level int not null default 1,
  exp int not null default 0,
  gold int not null default 50,
  stat_points int not null default 0,
  stats jsonb not null default '{"hp":0,"speed":0,"dmg":0,"magic":0}',
  weapon jsonb not null,
  inventory jsonb not null default '[]',
  owned_skills jsonb not null default '[]',
  equipped_skills jsonb not null default '[null,null]',
  guild_id text,
  has_map boolean not null default false,
  has_seen_tutorial boolean not null default false,
  quests jsonb not null default '{}'
);

create table if not exists guilds (
  id text primary key,
  name text not null,
  approval_required boolean not null,
  owner_username text not null,
  members jsonb not null default '[]',
  pending jsonb not null default '[]'
);

create table if not exists market_listings (
  id text primary key,
  seller_username text not null,
  seller_nickname text not null,
  kind text not null,
  key text not null,
  name text not null,
  qty int not null,
  price int not null,
  listed_at bigint not null,
  atk_bonus int,
  durability int,
  max_durability int,
  element text,
  enhance_level int,
  heal int,
  price_hint int
);
