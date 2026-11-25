-- 0035_delegation_rpcs.sql – TA quản lý nhóm (pic_delegations) dùng được file/giấy tờ/HR/xác nhận tuyển/ứng tuyển
-- của PIC được ủy quyền: thay điều kiện "pic = pic_code của actor" bằng app.manages(pic_code, pic) (0032).
-- Viết lại thân hàm bằng replace trên định nghĩa hiện hành; sai chuỗi thì dừng (không áp một nửa).
do $$
declare
  t record; d text; n text;
begin
  for t in select * from (values
    ('public', 'application_convert', 'r.pic = v_me.pic_code', 'app.manages(v_me.pic_code, r.pic)'),
    ('public', 'application_cv', 'a.pic = v_actor.pic_code', 'app.manages(v_actor.pic_code, a.pic)'),
    ('public', 'file_list', 'v_rec.pic = v_actor.pic_code', 'app.manages(v_actor.pic_code, v_rec.pic)'),
    ('public', 'file_open', 'v_rec.pic = v_actor.pic_code', 'app.manages(v_actor.pic_code, v_rec.pic)'),
    ('public', 'hire_confirm', 'v_cur.pic = v_actor.pic_code', 'app.manages(v_actor.pic_code, v_cur.pic)'),
    ('public', 'hr_info_write', 'v_cur.pic = v_actor.pic_code', 'app.manages(v_actor.pic_code, v_cur.pic)'),
    ('app', 'file_record', 'v.pic = p_actor.pic_code', 'app.manages(p_actor.pic_code, v.pic)')
  ) as x(sch, fn, a, b)
  loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = t.sch and p.proname = t.fn;
    n := replace(d, t.a, t.b);
    if d is null or n = d then raise exception '0035: pattern not found in %.%', t.sch, t.fn; end if;
    execute n;
  end loop;
end $$;
