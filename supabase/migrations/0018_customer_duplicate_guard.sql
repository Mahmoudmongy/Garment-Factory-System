-- إنشاء عميل كان بيقبل نفس الاسم أو نفس التليفون مرتين. الاستيراد بيمرّر
-- سطور الملف واحد واحد، فرفع نفس الملف مرتين كان بيضاعف العملاء. الحماية
-- بقت في القاعدة نفسها، مش في الواجهة بس.
create or replace function public.rpc_create_customer(
  p_name text, p_phone text default null, p_letter text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_letter text; v_phone text;
begin
  perform public.fn_require_permission('customer.create');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;

  v_phone := nullif(trim(coalesce(p_phone, '')), '');

  if exists (select 1 from public.customers where trim(name) = trim(p_name)) then
    perform public.fn_raise('E_CUSTOMER_EXISTS', trim(p_name));
  end if;
  if v_phone is not null
     and exists (select 1 from public.customers where trim(phone) = v_phone) then
    perform public.fn_raise('E_CUSTOMER_EXISTS', v_phone);
  end if;

  if p_letter is null then
    -- Derive a short unique letter from the name so the operator need not think about it.
    v_letter := upper(left(regexp_replace(coalesce(p_name,''), '[^A-Za-z\u0600-\u06FF]', '', 'g'), 1));
    if v_letter !~ '^[A-Z]$' then v_letter := 'C'; end if;
    while exists (select 1 from public.customers where operating_letter = v_letter) loop
      v_letter := chr(ascii(v_letter) + 1);
      if v_letter > 'Z' then perform public.fn_raise('E_LETTERS_EXHAUSTED'); end if;
    end loop;
  else
    v_letter := upper(trim(p_letter));
    if exists (select 1 from public.customers where operating_letter = v_letter) then
      perform public.fn_raise('E_LETTER_TAKEN', v_letter);
    end if;
  end if;

  insert into public.customers (code, operating_letter, name, phone)
  values (public.fn_next_code('CUS'), v_letter, trim(p_name), v_phone)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'operating_letter', v_letter,
    'code', (select code from public.customers where id = v_id));
end $$;
