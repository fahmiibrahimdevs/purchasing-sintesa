# Procura — Purchasing Workspace

Aplikasi internal untuk mencatat pembelian, mengelola master supplier dan project, menghubungkan faktur pajak ke barang pembelian, serta menelusuri riwayat faktur.

## Teknologi

- Client: React, TypeScript, Vite, Tailwind CSS, TanStack Query
- Server: Bun, Hono
- Database: MySQL 8 atau MariaDB 10.6+
- Login: sesi database dengan cookie HTTP-only

## Setup dan instalasi lokal

### Prasyarat

- Bun 1.2 atau lebih baru
- MySQL 8 atau MariaDB 10.6 atau lebih baru

### 1. Buat database dan user aplikasi

Masuk ke MySQL/MariaDB sebagai administrator, lalu jalankan SQL berikut. Ganti password contoh dengan password acak yang hanya dipakai aplikasi ini.

```sql
CREATE DATABASE purchasing_tax_invoice CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'purchasing_app'@'127.0.0.1' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ACAK';
GRANT ALL PRIVILEGES ON purchasing_tax_invoice.* TO 'purchasing_app'@'127.0.0.1';
```

### 2. Siapkan environment

```sh
cp server/.env.example server/.env
```

Edit `server/.env`. Isi setidaknya `DB_PASSWORD`, `INITIAL_ADMIN_EMAIL`, dan `INITIAL_ADMIN_PASSWORD`. Password administrator minimal 12 karakter dan jangan gunakan nilai contoh dari `.env.example`.

### 3. Pasang dependency dan buat administrator pertama

```sh
bun install
bun run seed:admin
```

Perintah `seed:admin` menjalankan migrasi database dan hanya membuat administrator jika tabel pengguna masih kosong.

### 4. Jalankan untuk pengembangan

```sh
bun run dev
```

Buka [http://localhost:5173](http://localhost:5173). Vite meneruskan permintaan `/api` ke server di port 3006.

Untuk menjalankan build produksi secara lokal:

```sh
bun run build
bun run start
```

File lampiran disimpan terpisah dari file publik. Secara lokal lokasinya `server/storage/private`; lokasi tersebut dapat diubah dengan `PRIVATE_STORAGE_PATH`.

## Deploy ke VPS Ubuntu

Contoh ini menggunakan domain `pembelian.fahmiibrahim.my.id`, Nginx, MariaDB, systemd, dan HTTPS dari Let's Encrypt. Siapkan VPS Ubuntu 22.04 atau lebih baru dengan akses `sudo`.

### Prasyarat domain dan jaringan

1. Buat DNS **A record** `pembelian.fahmiibrahim.my.id` yang menunjuk ke IP publik VPS.
2. Pastikan port TCP **80** dan **443** dapat diakses dari internet. Port aplikasi 3006 hanya digunakan oleh Nginx secara lokal dan tidak perlu dibuka ke publik.
3. Jangan lanjutkan permintaan sertifikat sebelum DNS domain mengarah ke VPS dan propagasinya selesai.

### 1. Pasang paket server

Jika belum tersedia, pasang Bun, Git, Nginx, MariaDB, Certbot, dan plugin Nginx Certbot. Bun dapat dipasang dari instruksi resmi di [bun.sh](https://bun.sh/docs/installation).

```sh
sudo apt update
sudo apt install -y git nginx mariadb-server certbot python3-certbot-nginx
```

### 2. Clone aplikasi dan build client

```sh
sudo install -d -o root -g root -m 0755 /var/www/projects
sudo git clone https://github.com/fahmiibrahimdevs/purchasing-sintesa.git /var/www/projects/purchasing-sintesa
cd /var/www/projects/purchasing-sintesa
sudo bun install --frozen-lockfile
sudo bun run build
```

### 3. Buat akun service dan database

Buat akun Linux khusus agar proses aplikasi tidak berjalan sebagai root:

```sh
sudo useradd --system --home /var/lib/purchasing-tax-invoice --create-home --shell /usr/sbin/nologin pti-app
sudo install -d -o pti-app -g pti-app -m 0700 /var/lib/purchasing-tax-invoice/private
```

Buat password acak untuk user database, lalu jalankan SQL berikut sebagai administrator MariaDB. Simpan password tersebut karena akan dipakai pada environment aplikasi.

```sql
CREATE DATABASE purchasing_tax_invoice CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'purchasing_app'@'127.0.0.1' IDENTIFIED BY 'PASSWORD_DATABASE_ACAK';
GRANT ALL PRIVILEGES ON purchasing_tax_invoice.* TO 'purchasing_app'@'127.0.0.1';
```

Jangan gunakan ulang database atau user yang sudah dipakai aplikasi lain.

### 4. Isi environment produksi dan buat Admin pertama

Salin contoh environment, edit nilainya, lalu batasi akses file agar rahasia tidak dapat dibaca pengguna lain:

```sh
cd /var/www/projects/purchasing-sintesa
sudo cp server/.env.example server/.env
sudoedit server/.env
sudo chown root:root server/.env
sudo chmod 600 server/.env
```

Isi konfigurasi produksi berikut. Gunakan password database dan password Admin yang kuat serta berbeda.

```dotenv
PORT=3006
NODE_ENV=production
COOKIE_SECURE=true
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=purchasing_app
DB_PASSWORD=PASSWORD_DATABASE_ACAK
DB_NAME=purchasing_tax_invoice
SESSION_TTL_HOURS=12
PRIVATE_STORAGE_PATH=/var/lib/purchasing-tax-invoice/private
INITIAL_ADMIN_NAME=Administrator
INITIAL_ADMIN_EMAIL=admin@pembelian.fahmiibrahim.my.id
INITIAL_ADMIN_PASSWORD=PASSWORD_ADMIN_ACAK_MINIMAL_12_KARAKTER
```

> Simpan email dan password Admin awal di password manager sebelum melanjutkan. Buat akun tersebut dan migrasikan skema:

```sh
cd /var/www/projects/purchasing-sintesa
sudo bun run seed:admin
```

Setelah berhasil, hapus tiga baris `INITIAL_ADMIN_...` dari `server/.env` agar password awal tidak tersimpan di environment service. Database password dan konfigurasi lain tetap disimpan di file tersebut.

### 5. Pasang service systemd dan situs Nginx

File konfigurasi contoh ada di folder `deploy/`. Pasang service dan konfigurasi HTTP:

```sh
sudo install -m 0644 deploy/purchasing-tax-invoice.service /etc/systemd/system/purchasing-tax-invoice.service
sudo install -m 0644 deploy/pembelian.fahmiibrahim.my.id.nginx /etc/nginx/sites-available/pembelian.fahmiibrahim.my.id
sudo ln -s /etc/nginx/sites-available/pembelian.fahmiibrahim.my.id /etc/nginx/sites-enabled/pembelian.fahmiibrahim.my.id
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now purchasing-tax-invoice.service
sudo systemctl reload nginx
```

Jika file situs atau service dengan nama tersebut sudah ada, periksa terlebih dahulu dan jangan menimpanya.

### 6. Aktifkan HTTPS dan verifikasi

Setelah service merespons melalui HTTP dan DNS sudah benar, minta sertifikat serta pengalihan HTTP ke HTTPS:

```sh
sudo certbot --nginx --redirect -d pembelian.fahmiibrahim.my.id
curl -fsS https://pembelian.fahmiibrahim.my.id/api/health
sudo systemctl status purchasing-tax-invoice.service --no-pager
```

Respons health yang berhasil adalah `{"status":"ok","service":"purchasing-tax-invoice"}`. Certbot memasang jadwal pembaruan sertifikat otomatis.

### Deploy pembaruan berikutnya

Sebelum memperbarui aplikasi produksi, buat backup database dan folder lampiran. Lalu jalankan:

```sh
cd /var/www/projects/purchasing-sintesa
sudo git pull --ff-only origin main
sudo bun install --frozen-lockfile
sudo bun run build
sudo systemctl restart purchasing-tax-invoice.service
curl -fsS https://pembelian.fahmiibrahim.my.id/api/health
```

Migrasi database yang belum diterapkan berjalan otomatis saat service mulai. Data database dan lampiran berada di luar hasil build agar tetap ada saat kode diperbarui.

### Pemeliharaan

- Log aplikasi: `sudo journalctl -u purchasing-tax-invoice.service -n 100 --no-pager`
- Status service: `sudo systemctl status purchasing-tax-invoice.service --no-pager`
- File konfigurasi rahasia: `/var/www/projects/purchasing-sintesa/server/.env` (mode `600`)
- File lampiran privat: `/var/lib/purchasing-tax-invoice/private`
- Backup database dan lampiran secara berkala ke penyimpanan terpisah dari VPS.

## Peran pengguna

- `PURCHASING`: mencatat pembelian dan lampiran dokumen sumber.
- `TAX_STAFF`: mengelola faktur pajak dan tindak lanjutnya.
- `ADMIN`: mengelola pengguna, Master Data, serta riwayat audit.

Rincian cakupan MVP ada di [`docs/mvp-scope.md`](docs/mvp-scope.md).

## Data demo

`bun run seed:demo` membuat dataset demo ringkas jika master data belum tersedia. Jangan jalankan perintah reset demo pada database produksi.
