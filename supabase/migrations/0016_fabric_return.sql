-- ============================================================================
-- 0016 — مرتجع قماش للعميل.
-- جدول الحركات كان بيقبل movement = 'return' من الأول، لكن مفيش دالة بترجّعه.
-- المرجع فيه زر «مرتجع للعميل» في المخزن، فبنضيف الدالة اللي بتخدمه.
-- ============================================================================

insert into public.permissions (code, group_ar, label_ar, sort_order)
values ('production.fabric.return', 'المخزن', 'مرتجع قماش للعميل', 74)
on conflict (code) do nothing;

create or replace function public.rpc_return_fabric(
  p_customer uuid, p_colour text, p_quantity numeric,
  p_order uuid default null, p_date date default null,
  p_notes text default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_balance numeric;
begin
  perform public.fn_require_permission('production.fabric.return');
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  if coalesce(trim(p_colour), '') = '' then perform public.fn_raise('E_COLOUR_REQUIRED'); end if;

  if p_key is not null then
    perform public.fn_idempotency_lock('customer_fabric_movements', p_key);
    select id into v_id from public.customer_fabric_movements where idempotency_key = p_key;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;

  -- مينفعش نرجّع أكتر من اللي عندنا، وإلا الرصيد يبقى سالب من غير سبب.
  select coalesce(sum(quantity), 0) into v_balance
    from public.customer_fabric_movements
   where customer_id = p_customer and colour = trim(p_colour);
  if v_balance < p_quantity then perform public.fn_raise('E_FABRIC_SHORT'); end if;

  insert into public.customer_fabric_movements
    (customer_id, colour, quantity, movement, production_order_id, txn_date, notes, idempotency_key)
  values (p_customer, trim(p_colour), -p_quantity, 'return', p_order,
          coalesce(p_date, public.fn_today()), p_notes, p_key)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

grant execute on function public.rpc_return_fabric(uuid, text, numeric, uuid, date, text, text)
  to authenticated;
