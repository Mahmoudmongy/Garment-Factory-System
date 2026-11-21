set client_min_messages = warning;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- demo production
-- Built through the RPCs so the demo data obeys exactly the same rules as the app.
do $$
declare
  v_cust uuid; v_order uuid; v_worker uuid; v_worker2 uuid;
  v_b1 uuid; v_b2 uuid; v_a uuid;
begin
  if exists (select 1 from public.production_orders) then return; end if;

  v_cust := (public.rpc_create_customer('محمود الجندي', '01011550189', 'M') ->> 'id')::uuid;
  perform public.rpc_create_customer('عبد الرحمن الجمل', '01000000001', 'AG');

  v_worker  := (public.rpc_create_employee('محمد محمود', 'worker', 'تعريش', '01011550189') ->> 'id')::uuid;
  v_worker2 := (public.rpc_create_employee('سيد الخياط', 'worker', 'خياط', '01000000002') ->> 'id')::uuid;

  perform public.rpc_set_piece_rate(v_worker, 'collar', 3.00);
  perform public.rpc_set_piece_rate(v_worker, 'chest', 2.50);
  perform public.rpc_set_piece_rate(v_worker2, 'assembly', 4.00);

  v_order := (public.rpc_create_production_order(
    v_cust, 'جاكيت تومي', 240, 130,
    'aaaaaaaa-0000-0000-0000-000000000001',
    public.fn_today() + 10, 'شريط على الكم') ->> 'id')::uuid;

  perform public.rpc_receive_fabric(v_cust, 'إسود', 400, v_order);
  perform public.rpc_receive_fabric(v_cust, 'كحلي', 300, v_order);

  perform public.rpc_execute_cutting(v_order,
    '[{"colour":"إسود","size":"M","quantity":80},
      {"colour":"إسود","size":"L","quantity":40},
      {"colour":"كحلي","size":"L","quantity":40}]'::jsonb, 40);

  -- One bundle goes out to a worker and comes back, so every screen has history.
  select id into v_b1 from public.bundles
   where order_id = v_order and size = 'M' order by code limit 1;
  v_a := (public.rpc_assign_bundle(v_b1, 'collar', v_worker) ->> 'id')::uuid;
  perform public.rpc_receive_work(v_a, 38, 2, 0, 'خياطة');

  select id into v_b2 from public.bundles
   where order_id = v_order and size = 'M' order by code offset 1 limit 1;
  perform public.rpc_assign_bundle(v_b2, 'collar', v_worker2);

  -- A second order still untouched, so the order list shows both states.
  perform public.rpc_create_production_order(
    (select id from public.customers where operating_letter = 'AG'),
    'قميص كلاسيك', 120, 85,
    'aaaaaaaa-0000-0000-0000-000000000001', public.fn_today() + 20, null);

  perform public.rpc_create_expense(
    'bbbbbbbb-0000-0000-0000-000000000001', 'كهرباء', 'فاتورة كهرباء نوفمبر', 1850);
  perform public.rpc_create_expense(
    'bbbbbbbb-0000-0000-0000-000000000001', 'إيجار', 'إيجار المصنع', 12000);
end $$;
