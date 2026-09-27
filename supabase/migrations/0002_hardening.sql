-- Hardening after Supabase advisor review:
-- 1. The signup trigger function must not be callable through the REST API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 2. Evaluate auth.uid() once per query instead of once per row.
drop policy "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'projects','sources','source_segments','chunks','documents','chapters','sections','questions','flashcards','quizzes','quiz_questions','quiz_attempts','notes','bookmarks','highlights','reading_progress','conversations','messages'
  ] loop
    execute format('drop policy "owner access" on public.%I', t);
    execute format(
      'create policy "owner access" on public.%I for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- 3. Index foreign keys used by joins and cascading deletes.
create index if not exists bookmarks_chapter_id_idx on public.bookmarks(chapter_id);
create index if not exists bookmarks_project_id_idx on public.bookmarks(project_id);
create index if not exists chapters_document_id_idx on public.chapters(document_id);
create index if not exists conversations_project_id_idx on public.conversations(project_id);
create index if not exists flashcards_chapter_id_idx on public.flashcards(chapter_id);
create index if not exists highlights_chapter_id_idx on public.highlights(chapter_id);
create index if not exists highlights_project_id_idx on public.highlights(project_id);
create index if not exists messages_project_id_idx on public.messages(project_id);
create index if not exists notes_chapter_id_idx on public.notes(chapter_id);
create index if not exists questions_chapter_id_idx on public.questions(chapter_id);
create index if not exists quiz_attempts_question_id_idx on public.quiz_attempts(question_id);
create index if not exists quiz_questions_chapter_id_idx on public.quiz_questions(chapter_id);
create index if not exists quiz_questions_quiz_id_idx on public.quiz_questions(quiz_id);
create index if not exists quizzes_project_id_idx on public.quizzes(project_id);
create index if not exists reading_progress_chapter_id_idx on public.reading_progress(chapter_id);
create index if not exists reading_progress_project_id_idx on public.reading_progress(project_id);
create index if not exists source_segments_source_id_idx on public.source_segments(source_id);
