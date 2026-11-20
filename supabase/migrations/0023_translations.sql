-- 0023_translations.sql – M7-2: bản tiếng Anh của ô chữ tự do (TranslationPanel; Docs.gs hGetTranslations_ / hPutTranslation_).
-- Không dịch tự động: TA sao chép prompt, dán vào Claude, kiểm tra rồi dán bản tiếng Anh vào và lưu. Bản gốc tiếng Việt không đổi.
-- Trạng thái (như hệ cũ): none = chưa dịch; translated = source_hash trùng mã của nội dung tiếng Việt hiện tại; outdated = đã đổi.
-- source_hash = translationHash() của shared/attachmentRules.ts – tính ở trình duyệt (cùng hàm với hệ cũ) và gửi kèm.
-- Ghi CHỈ qua translation_save (kiểm quyền hồ sơ + ghi nhật ký TRANSLATION như hệ cũ); bỏ quyền ghi thẳng bảng.

revoke insert, update, delete on public.translations from authenticated;
drop policy if exists tr_write on public.translations;

-- các trường dịch được (= Shared.TRANSLATABLE_FIELDS)
create or replace function app.translatable_fields() returns text[] language sql immutable set search_path = ''
as $$ select array['experience_summary'] $$;

create or replace function public.translation_list(p_record_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rec jsonb;
  v_pic text;
begin
  select to_jsonb(r), r.pic into v_rec, v_pic from public.recruitment_records r where r.id = p_record_id;
  if v_rec is null or not app.can_see_record(v_pic) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng viên.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'field_key', k, 'source_text', coalesce(v_rec ->> k, ''),
             'en_text', coalesce(t.en_text, ''), 'source_hash', coalesce(t.source_hash, ''),
             'updated_by', coalesce((select p.username from public.profiles p where p.id = t.updated_by), ''),
             'updated_at', coalesce(t.updated_at::text, '')) order by o)
      from unnest(app.translatable_fields()) with ordinality as f(k, o)
      left join public.translations t on t.record_id = p_record_id and t.field_key = f.k), '[]'::jsonb);
end $$;
revoke all on function public.translation_list(bigint) from public, anon;
grant execute on function public.translation_list(bigint) to authenticated;

-- p_en_text rỗng => xóa bản dịch (như hệ cũ)
create or replace function public.translation_save(p_record_id bigint, p_field_key text, p_en_text text, p_source_hash text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_rec jsonb;
  v_pic text;
  v_code text;
  v_text text := regexp_replace(replace(coalesce(p_en_text, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g');  -- = JS .trim()
  v_old text;
  v_me public.profiles;
begin
  if not (p_field_key = any (app.translatable_fields())) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Trường này không có bản dịch.';
  end if;
  if length(v_text) > 5000 then
    raise exception 'INVALID_INPUT' using errcode = 'PT400', detail = 'Bản dịch tối đa 5000 ký tự.';
  end if;
  select to_jsonb(r), r.pic, r.candidate_code into v_rec, v_pic, v_code from public.recruitment_records r where r.id = p_record_id for update;
  if v_rec is null or not app.can_see_record(v_pic) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng viên.';
  end if;
  if v_text <> '' and btrim(coalesce(v_rec ->> p_field_key, '')) = '' then
    raise exception 'NO_SOURCE' using errcode = 'PT400', detail = 'Chưa có nội dung tiếng Việt để làm bản gốc. Hãy nhập nội dung gốc trước.';
  end if;
  select * into v_me from public.profiles where id = auth.uid() and active;
  if v_me.id is null then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Tài khoản không tồn tại hoặc đã bị khóa.';
  end if;
  select en_text into v_old from public.translations where record_id = p_record_id and field_key = p_field_key;
  if v_text = '' then
    delete from public.translations where record_id = p_record_id and field_key = p_field_key;
  else
    insert into public.translations (record_id, field_key, source_hash, en_text, updated_by, updated_at)
    values (p_record_id, p_field_key, coalesce(p_source_hash, ''), v_text, v_me.id, now())
    on conflict (record_id, field_key) do update
      set source_hash = excluded.source_hash, en_text = excluded.en_text, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_me.id, v_me.username, v_me.role, 'TRANSLATION', p_record_id, v_code,
          jsonb_build_object(p_field_key, jsonb_build_object('old', left(coalesce(v_old, ''), 200), 'new', left(v_text, 200))));
end $$;
revoke all on function public.translation_save(bigint, text, text, text) from public, anon;
grant execute on function public.translation_save(bigint, text, text, text) to authenticated;
