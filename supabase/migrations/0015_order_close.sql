-- ============================================================================
-- 0015 — إقفال الأمر.
-- المرجع فيه زر «إقفال الأمر» يحوّل الأمر من مفتوح لمكتمل؛ كان ناقص هنا.
-- (تفصيل التكلفة ومصفوفة المقاسات بيتحسبوا في الواجهة من البيانات الموجودة،
--  فمش محتاجين views إضافية.)
-- ============================================================================

insert into public.permissions (code, group_ar, name_ar, sort_order)
values ('production.order.close', 'أوامر التشغيل', 'إقفال أمر', 73)
on conflict (code) do nothing;

-- الأوامر المقفولة بتتحول لـ completed، وده اللي بيخلي ربح الأمر يتحسب نهائي.
create or replace function public.rpc_close_production_order(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_qty numeric; v_ready numeric;
begin
  perform public.fn_require_permission('production.order.close');

  select quantity into v_qty from public.production_orders where id = p_id;
  if v_qty is null then perform public.fn_raise('E_NOT_FOUND'); end if;

  select coalesce(sum(b.quantity), 0) into v_ready
    from public.bundles b where b.order_id = p_id and b.status = 'finished';
  if v_ready < v_qty then perform public.fn_raise('E_ORDER_NOT_FINISHED'); end if;

  update public.production_orders
     set status = 'completed', closed_at = now()
   where id = p_id and status = 'open';
  if not found then perform public.fn_raise('E_ORDER_NOT_OPEN'); end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.rpc_close_production_order(uuid) to authenticated;
