-- =====================================================================
--  Skema database aplikasi kasir
--  Jalankan seluruh file ini di Supabase > SQL Editor > New query > Run
-- =====================================================================

-- 1. TABEL ------------------------------------------------------------

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(trim(name)) > 0),
  category    text        not null default 'Umum',
  price       numeric(12,0) not null check (price >= 0),
  stock       integer     not null default 0 check (stock >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  invoice_no     text        not null unique,
  subtotal       numeric(12,0) not null,
  discount       numeric(12,0) not null default 0,
  total          numeric(12,0) not null,
  paid           numeric(12,0) not null,
  change         numeric(12,0) not null,
  payment_method text        not null default 'cash',
  cashier_email  text,
  created_at     timestamptz not null default now()
);

create table if not exists public.transaction_items (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  product_name   text not null,
  price          numeric(12,0) not null,
  qty            integer not null check (qty > 0),
  subtotal       numeric(12,0) not null
);

create index if not exists idx_transactions_created_at on public.transactions (created_at desc);
create index if not exists idx_items_transaction on public.transaction_items (transaction_id);

create sequence if not exists public.invoice_seq;

-- 2. KEAMANAN (Row Level Security) -----------------------------------
-- Hanya user yang sudah login (authenticated) yang boleh mengakses data.

alter table public.products           enable row level security;
alter table public.transactions       enable row level security;
alter table public.transaction_items  enable row level security;

drop policy if exists "products_all_auth" on public.products;
create policy "products_all_auth" on public.products
  for all to authenticated using (true) with check (true);

-- Transaksi hanya boleh dibaca. Pembuatan lewat fungsi create_transaction().
drop policy if exists "transactions_read_auth" on public.transactions;
create policy "transactions_read_auth" on public.transactions
  for select to authenticated using (true);

drop policy if exists "items_read_auth" on public.transaction_items;
create policy "items_read_auth" on public.transaction_items
  for select to authenticated using (true);

-- 3. FUNGSI TRANSAKSI (atomik: cek stok, simpan, kurangi stok) -------

create or replace function public.create_transaction(
  p_items    jsonb,
  p_discount numeric default 0,
  p_paid     numeric default 0,
  p_method   text    default 'cash'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item     jsonb;
  v_prod     public.products%rowtype;
  v_qty      integer;
  v_subtotal numeric := 0;
  v_discount numeric := greatest(coalesce(p_discount, 0), 0);
  v_total    numeric;
  v_trx_id   uuid := gen_random_uuid();
  v_invoice  text;
  v_created  timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Silakan login terlebih dahulu';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang masih kosong';
  end if;

  if p_method not in ('cash', 'qris', 'transfer') then
    raise exception 'Metode pembayaran tidak dikenal';
  end if;

  -- Validasi stok dan hitung subtotal memakai harga dari database
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Jumlah barang tidak valid';
    end if;

    select * into v_prod from public.products
      where id = (v_item->>'id')::uuid
      for update;

    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Stok "%" tidak cukup (sisa %)', v_prod.name, v_prod.stock;
    end if;

    v_subtotal := v_subtotal + v_prod.price * v_qty;
  end loop;

  if v_discount > v_subtotal then
    v_discount := v_subtotal;
  end if;
  v_total := v_subtotal - v_discount;

  if p_paid < v_total then
    raise exception 'Uang diterima kurang dari total';
  end if;

  v_invoice := 'INV-'
    || to_char(v_created at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
    || lpad(nextval('public.invoice_seq')::text, 5, '0');

  insert into public.transactions
    (id, invoice_no, subtotal, discount, total, paid, change, payment_method, cashier_email, created_at)
  values
    (v_trx_id, v_invoice, v_subtotal, v_discount, v_total, p_paid, p_paid - v_total,
     p_method, auth.jwt()->>'email', v_created);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::integer;
    select * into v_prod from public.products where id = (v_item->>'id')::uuid;

    insert into public.transaction_items
      (transaction_id, product_id, product_name, price, qty, subtotal)
    values
      (v_trx_id, v_prod.id, v_prod.name, v_prod.price, v_qty, v_prod.price * v_qty);

    update public.products set stock = stock - v_qty where id = v_prod.id;
  end loop;

  return json_build_object(
    'id',             v_trx_id,
    'invoice_no',     v_invoice,
    'subtotal',       v_subtotal,
    'discount',       v_discount,
    'total',          v_total,
    'paid',           p_paid,
    'change',         p_paid - v_total,
    'payment_method', p_method,
    'created_at',     v_created
  );
end;
$$;

revoke all on function public.create_transaction(jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.create_transaction(jsonb, numeric, numeric, text) to authenticated;

-- 4. DATA CONTOH (boleh dihapus) --------------------------------------

insert into public.products (name, category, price, stock) values
  ('Kopi Susu Gula Aren', 'Minuman', 18000, 40),
  ('Es Teh Manis',        'Minuman',  6000, 60),
  ('Air Mineral 600 ml',  'Minuman',  4000, 100),
  ('Nasi Goreng Spesial', 'Makanan', 25000, 25),
  ('Mie Ayam Bakso',      'Makanan', 20000, 30),
  ('Roti Bakar Cokelat',  'Camilan', 15000, 20),
  ('Kentang Goreng',      'Camilan', 14000, 35);


-- 1. Tambahkan kolom image_url ke tabel products (jika belum ada)
alter table public.products 
  add column if not exists image_url text;

-- 2. Buat Storage Bucket khusus untuk gambar produk secara publik
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- 3. Kebijakan Keamanan Storage (RLS untuk Bucket product-images)

-- Izinkan siapa saja (publik) melihat/mengunduh gambar produk
drop policy if exists "Public Access Product Images" on storage.objects;
create policy "Public Access Product Images"
  on storage.objects for select
  using ( bucket_id = 'product-images' );

-- Izinkan user yang sudah login (authenticated) untuk mengunggah gambar
drop policy if exists "Authenticated Upload Product Images" on storage.objects;
create policy "Authenticated Upload Product Images"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id = 'product-images' );

-- Izinkan user yang sudah login untuk memperbarui gambar
drop policy if exists "Authenticated Update Product Images" on storage.objects;
create policy "Authenticated Update Product Images"
  on storage.objects for update
  to authenticated
  using ( bucket_id = 'product-images' );

-- Izinkan user yang sudah login untuk menghapus gambar
drop policy if exists "Authenticated Delete Product Images" on storage.objects;
create policy "Authenticated Delete Product Images"
  on storage.objects for delete
  to authenticated
  using ( bucket_id = 'product-images' );