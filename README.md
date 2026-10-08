# Aplikasi Kasir (HTML + CSS + JavaScript + Supabase)
## Demo Apps akses disini : https://warungkuproject.netlify.app/
Dengan memasukan email: warungku@gmail.com dengan password: warungku123

Fitur: login kasir, katalog produk dengan pencarian dan kategori, keranjang, diskon,
pembayaran tunai/QRIS/transfer dengan kembalian, stok berkurang otomatis,
struk yang bisa dicetak (80 mm), riwayat transaksi dengan ringkasan penjualan,
dan kelola produk (tambah, ubah, hapus).

## 1. Siapkan Supabase
1. Buat project baru di https://supabase.com.
2. Buka **SQL Editor > New query**, tempel isi `supabase/schema.sql`, lalu **Run**.
3. Buka **Authentication > Users > Add user**, buat akun kasir (email + password, centang Auto Confirm).
4. Buka **Authentication > Sign In / Providers** (atau Settings), lalu **matikan pendaftaran publik** (Allow new users to sign up)
   agar orang asing tidak bisa membuat akun sendiri.
5. Buka **Project Settings > API**, salin **Project URL** dan **anon public key**.

## 2. Isi konfigurasi
Edit `js/config.js`, ganti `SUPABASE_URL` dan `SUPABASE_ANON_KEY`, serta nama dan alamat toko.
Jangan memakai `service_role` key di sini.

## 3. Coba di komputer
Buka folder ini dengan server statis, misalnya:
    npx serve .
lalu buka alamat yang muncul.

## 4. Deploy ke Netlify
Cara cepat: buka https://app.netlify.com/drop lalu seret folder `kasir` ke halaman itu.
Cara Git: push folder ke GitHub, **Add new site > Import an existing project**,
build command dikosongkan, publish directory `.` (sudah diatur di `netlify.toml`).

## Catatan keamanan
- Semua tabel memakai Row Level Security: hanya user yang login yang bisa membaca dan mengubah data.
- Transaksi dibuat lewat fungsi database `create_transaction`, yang memakai harga dari database
  dan mengecek stok, sehingga angka tidak bisa dimanipulasi dari browser.
