// ── MORE PRINT — การตั้งค่าเชื่อมต่อ ─────────────────────────────
// ใส่ค่าจาก Supabase (Settings → API) เพื่อเปิดใช้ฐานข้อมูลกลาง
// ปล่อยว่างไว้ = แอปทำงานโหมดออฟไลน์ / หลังบ้านโชว์ข้อมูลตัวอย่าง
window.MP_CONFIG = {
  SUPABASE_URL: 'https://plfghesoscfqdlthkzwq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_iEj1XajKaIxwmM0t2smNLA_OQNgh06j',
  ADMIN_PIN: '2468',       // รหัสเข้าหน้าหลังบ้าน (เปลี่ยนได้)
  LIFF_ID: '2010897028-o3azGJrL', // LINE Login (LIFF) ของ channel MORE PRINT
  LINE_OA_ID: '@346kifvy', // LINE OA ของร้าน
  LINE_OA_URL: 'https://line.me/R/ti/p/@346kifvy',
  R2_UPLOADS: true          // ไฟล์งาน PDF + สลิปของออเดอร์ใหม่อัปเข้า Cloudflare R2 ผ่าน Edge Function r2-sign (2026-10-30) — false = กลับไปใช้ Supabase Storage
};
