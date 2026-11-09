# Aplikasi Kasir (HTML + CSS + JavaScript + Firebase)
## Demo Apps akses di sini : https://warungkuid.vercel.app/
Dengan memasukan email: admin@warungku.com dengan password: warungku123

Fitur: login kasir, katalog produk dengan pencarian dan kategori, keranjang, diskon,
pembayaran tunai/QRIS/transfer dengan kembalian, stok berkurang otomatis,
struk yang bisa dicetak (80 mm), riwayat transaksi dengan ringkasan penjualan,
dan kelola produk (tambah, ubah, hapus).

## 1. Siapkan Firebase
1. Buat project baru di https://console.firebase.google.com/.
2. Aktifkan **Firestore Database** dan **Storage** (saat ditanya *security rules*, pilih **Start in test mode**).
3. Aktifkan **Authentication**, masuk ke tab *Sign-in method*, dan nyalakan **Email/Password**.
4. Di menu Authentication, pindah ke tab **Users > Add user**, lalu buat akun kasir (email + password).
5. Buka **Project Settings** (ikon gir di kiri atas), scroll ke bagian *Your apps*, daftarkan aplikasi web (`</>`), dan salin blok kode `firebaseConfig`.

## 2. Isi konfigurasi
Edit `js/config.js`, masukkan data kode yang disalin tadi ke dalam `FIREBASE_CONFIG`, serta sesuaikan nama dan alamat toko.

## 3. Coba di komputer
Karena aplikasi ini menggunakan modul JavaScript (`type="module"`), file tidak bisa dibuka dengan sekadar klik ganda (dobel klik).
Gunakan server statis:
- **VS Code:** Instal ekstensi **Live Server**, klik kanan pada `index.html`, lalu pilih "Open with Live Server".
- **Terminal/CMD:** Ketik `npx serve .` lalu buka alamat lokal yang muncul di browser.

## 4. Deploy ke Vercel
Cara mudah agar online 24 jam tanpa kendala auto-pause:
1. Push semua file kode ke repositori GitHub milikmu.
2. Buka https://vercel.com/ dan login.
3. Klik **Add New > Project**, lalu **Import** repositori GitHub tersebut.
4. Biarkan semua pengaturan *default* (Framework Preset: Other), lalu klik **Deploy**.

## Catatan keamanan
- Pengurangan stok dan pencatatan transaksi dieksekusi secara serentak menggunakan sistem **Write Batch** Firestore untuk mencegah data bentrok atau transaksi ganda.
- Saat ini database menggunakan "Test Mode" untuk mempermudah pengaturan awal. Untuk keamanan penuh di tahap *production*, sangat disarankan untuk mengatur **Firestore Security Rules** agar hanya *user* (kasir) yang sudah *login* yang dapat membaca dan mengubah data.
