-- AI Learning Studio — initial schema
-- Every user-owned row carries user_id so Row Level Security stays a single,
-- index-backed predicate (user_id = auth.uid()) on every table.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_language text not null default 'en' check (preferred_language in ('en','hi','hinglish')),
  default_instruction text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Projects: one learning book per project
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  emoji text not null default '📘',
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  -- pipeline stage: extract | analyze | plan | write | quality | revision | finalize | done
  stage text not null default 'analyze',
  stage_detail jsonb not null default '{}'::jsonb,
  error text,
  settings jsonb not null default '{}'::jsonb,   -- styles, language, custom instruction, ai examples
  lock_until timestamptz,
  progress_percent int not null default 0,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_idx on public.projects(user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Sources and their addressable segments (timestamps / pages / paragraphs)
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('youtube','pdf','docx','txt','md','text','article','transcript')),
  title text,
  url text,
  storage_path text,
  language text,
  word_count int not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index sources_project_idx on public.sources(project_id);

create table public.source_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null,                      -- 1-based; referenced by the AI as S{idx}
  ref_label text not null,               -- "02:34–04:18", "Page 12", "¶ 4–6"
  start_sec numeric,
  end_sec numeric,
  page int,
  heading text,
  text text not null,
  unique (project_id, idx)
);

-- Processing chunks for map-reduce analysis
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null,
  segment_start int not null,
  segment_end int not null,
  word_count int not null,
  analysis jsonb,
  unique (project_id, idx)
);

-- ---------------------------------------------------------------------------
-- Generated learning document
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subtitle text,
  language text,
  plan jsonb not null default '{}'::jsonb,       -- global understanding + chapter plan
  revision jsonb not null default '{}'::jsonb,   -- quick revision, key takeaways
  quality_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null,
  plan_key text not null,
  title text not null,
  summary text,
  kind text not null default 'core',
  key_takeaway text,
  source_refs text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','written','checked')),
  qc jsonb,
  unique (project_id, idx)
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null,
  title text not null,
  summary text,
  blocks jsonb not null default '[]'::jsonb,
  source_refs text[] not null default '{}',
  unique (chapter_id, idx)
);
create index sections_project_idx on public.sections(project_id);

-- Revision questions (open questions with model answers)
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  idx int not null,
  question text not null,
  answer text not null,
  source_refs text[] not null default '{}'
);
create index questions_project_idx on public.questions(project_id);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  idx int not null,
  front text not null,
  back text not null,
  source_refs text[] not null default '{}',
  review_count int not null default 0,
  last_result text check (last_result in ('again','good','easy')),
  last_reviewed_at timestamptz
);
create index flashcards_project_idx on public.flashcards(project_id);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  idx int not null,
  kind text not null check (kind in ('mcq','true_false','short','concept')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  answer text not null,
  explanation text not null,
  source_refs text[] not null default '{}'
);
create index quiz_questions_project_idx on public.quiz_questions(project_id);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  response text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);
create index quiz_attempts_project_idx on public.quiz_attempts(project_id, user_id);

-- ---------------------------------------------------------------------------
-- Personal study layer
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete cascade,
  anchor text,                 -- block anchor ("<section_id>:<block_index>") or null for chapter notes
  quote text,                  -- the passage the note was written against
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_project_idx on public.notes(project_id, user_id);

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete cascade,
  target_type text not null check (target_type in ('chapter','paragraph','question','concept')),
  anchor text not null,
  label text not null,
  excerpt text,
  created_at timestamptz not null default now(),
  unique (user_id, project_id, anchor)
);

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete cascade,
  anchor text,
  text text not null,
  color text not null default 'yellow',
  created_at timestamptz not null default now()
);

create table public.reading_progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  percent int not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, chapter_id)
);

-- ---------------------------------------------------------------------------
-- AI tutor conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'projects','sources','source_segments','chunks','documents','chapters','sections',
    'questions','flashcards','quizzes','quiz_questions','quiz_attempts','notes',
    'bookmarks','highlights','reading_progress','conversations','messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner access" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create index if not exists %I on public.%I(user_id)', t || '_user_id_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files live under "<user_id>/..."
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('sources', 'sources', false, 52428800)
on conflict (id) do nothing;

create policy "users read own source files" on storage.objects
  for select using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users upload own source files" on storage.objects
  for insert with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own source files" on storage.objects
  for delete using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
