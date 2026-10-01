# Jii Panel — ประตูหน้าบ้านของจี้ (GM) ใน Obsidian

> ปลั๊กอิน Obsidian ขนาดเล็ก ทำหน้าที่เป็นประตูติดต่อจี้ (GM ของ Open Minis) โดยตรงจาก vault
> ติดตั้งผ่าน **BRAT** ได้ทันที — ไม่ต้องรอ publish ถึง community store

## ติดตั้งผ่าน BRAT
1. เปิด Command palette → `BRAT: Add beta plugin`
2. ใส่ `peachtukta1014/obsidian-jii-panel`
3. เปิดใช้งานปลั๊กอิน "Jii Panel" ใน Settings → Community plugins
4. กดไอคอน **Jii Panel** ที่แถบข้าง (หรือ command `เปิด Jii Panel`)

## ปุ่มในแผง (v1.0)
| ปุ่ม | ทำอะไร |
|---|---|
| พูดกับจี้ 💬 | พิมพ์ข้อความ ส่งตรงเข้าแชท GM — จี้รับงานทันที |
| ส่งโน้ตปัจจุบันเข้าระบบ 📄 | ส่งโน้ตที่เปิดอยู่เข้า pipeline กลางให้จี้จัดเก็บ |
| เพิ่ม token ใหม่ 🔐 | ฝาก token เข้าตู้เซฟ VM — ค่าไม่ถูกบันทึกใน vault |
| เปิดหมายเหตุทีม 📋 | สร้าง/เปิด `Jii Hub/Team Status.md` |

## ความปลอดภัย
- ค่า token จากปุ่ม "เพิ่ม token ใหม่" ไหลผ่านช่องทางกลางของโปรเจคเอง (Firebase private) ไปเก็บที่ VM root-only เท่านั้น — ไม่มีการบันทึกค่าใน vault, โน้ต, หรือ log
- ตัวปลั๊กอินไม่เก็บค่า token ใน settings (ปุ่มพิมพ์รหัสจะล้างค่าทันทีหลังส่ง)

## Technical
- Plain JS (no build step), uses `requestUrl` (bypasses CORS) → `hqWebhookIngest` (asia-southeast1) → `webhookInbox` (Firestore) → VM hq-core → Jii GM channel.
- Events: `jii_request`, `note_drop`, `secret_intake`.
- Optional bearer token via Settings → Jii Panel if `WEBHOOK_INGEST_TOKEN` is enabled on the ingest function.

## Roadmap
- v1.1: ปุ่มสถานะทีมแบบ live (ดึงจาก VM), push ขึ้น Google Drive แบบกดเอง (ตามกฎไหลทางเดียว), ตั้งชื่อ secret พร้อม scope
- v1.2: ผู้ส่งงานให้ลูกมือทีมโดยตรงจากแผงเดียว

Owner: peachtukta1014 · Built by Jii (GM), 2026-10-01 · Thai/EN