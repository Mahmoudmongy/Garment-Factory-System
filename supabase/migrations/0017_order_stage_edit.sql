-- ============================================================================
-- 0017 — تعديل مراحل أمر تشغيل بعد إنشائه.
-- المرجع بيسمح بتعديل سعر القطعة وميعاد كل مرحلة وقت إنشاء الأمر،
-- والمراحل بتتنسخ من القالب. الدالة دي بتحدّث النسخة المنسوخة على الأمر.
-- ============================================================================

insert into public.permissions (code, group_ar, name_ar, sort_order)
values ('production.order.stage.edit', 'أوامر التشغيل', 'تعديل مراحل الأمر', 43)
on conflict (code) do nothing;

create or replace function public.rpc_update_order_stages(
  p_order uuid, p_stages jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_seq int; v_count int := 0;
begin
  perform public.fn_require_permission('production.order.stage.edit');

  if not exists (select 1 from public.production_orders where id = p_order) then
    perform public.fn_raise('E_NOT_FOUND');
  end if;

  -- المراحل اللي بدأت خلاص مش بتتعدّل: تغيير سعرها بيغيّر حساب أجور اتقبضت.
  for v_row in select * from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) loop
    v_seq := (v_row ->> 'seq')::int;

    if exists (select 1 from public.work_assignments
                where order_id = p_order and stage_code = (v_row ->> 'code')) then
      perform public.fn_raise('E_STAGE_LOCKED');
    end if;

    update public.production_order_stages
       set piece_price = coalesce((v_row ->> 'piece_price')::numeric, piece_price),
           due_date = coalesce((v_row ->> 'due_date')::date, due_date)
     where order_id = p_order and seq = v_seq;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('updated', v_count);
end $$;

grant execute on function public.rpc_update_order_stages(uuid, jsonb) to authenticated;
