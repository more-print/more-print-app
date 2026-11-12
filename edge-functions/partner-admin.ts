// Edge Function: partner-admin — เจ้าของ MORE PRINT จัดการบัญชีล็อกอินของร้านพาร์ทเนอร์ (ใช้จากหน้า partners.html)
// ผู้เรียกต้องล็อกอินเป็นเจ้าของ (is_admin) เท่านั้น — เช็คจาก token ที่หน้าเว็บส่งมา (แบบเดียวกับ r2-sign)
// ใช้สิทธิ์ระบบ (SUPABASE_SERVICE_ROLE_KEY ที่ Supabase ใส่ให้ฟังก์ชันเองอัตโนมัติ) — คีย์ไม่ออกไปหน้าเว็บ
//
// POST { action: 'list' }                              → { accounts: [{ uid, email, shop, last_sign_in_at, created_at }] }
// POST { action: 'create', email, password, shop }     → สร้างบัญชี (ยืนยันอีเมลให้เลย ล็อกอินได้ทันที) + ผูกกับร้าน
//                                                         อีเมลนี้มีบัญชีอยู่แล้ว (เช่นร้านสมัครเองที่ pro.html) = ผูกกับร้านให้ ไม่แตะรหัสผ่าน
// POST { action: 'password', uid, password }           → ตั้งรหัสผ่านใหม่ — เฉพาะบัญชีร้านพาร์ทเนอร์ (บัญชีเจ้าของห้ามแตะ)
// POST { action: 'unlink', uid }                       → เอาบัญชีออกจากร้าน (เข้าหลังบ้านไม่ได้อีก · บัญชียังอยู่ ผูกใหม่ได้)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL') || '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SRH = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };

async function isAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) === ANON) return false;
  try {
    const r = await fetch(`${URL_}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
    return r.ok && (await r.json()) === true;
  } catch { return false; }
}

const rest = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...SRH, ...(init.headers || {}) } });
  const t = await r.text();
  let d: unknown = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
};
const authApi = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${URL_}/auth/v1/admin/${path}`, { ...init, headers: { ...SRH, ...(init.headers || {}) } });
  const t = await r.text();
  let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
};

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
const adminUid = async (uid: string) => { const r = await rest(`admins?select=user_id&user_id=eq.${uid}`); return Array.isArray(r.data) && r.data.length > 0; };
const partnerRow = async (uid: string) => { const r = await rest(`partners?select=uid,shop&uid=eq.${uid}`); return Array.isArray(r.data) ? r.data[0] : null; };

// หา uid จากอีเมล (กรณีอีเมลนี้มีบัญชีอยู่แล้ว) — ไล่ทีละหน้า หน้าละ 200 บัญชี
async function uidByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 25; page++) {
    const r = await authApi(`users?page=${page}&per_page=200`);
    const users = (r.data && r.data.users) || [];
    const u = users.find((x: any) => String(x.email || '').toLowerCase() === email);
    if (u) return u.id;
    if (users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!SR) return json({ error: 'server-not-ready' }, 500);
    if (!(await isAdmin(req))) return json({ error: 'owner-only' }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'list') {
      const p = await rest('partners?select=uid,shop,created_at');
      const rows = Array.isArray(p.data) ? p.data as any[] : [];
      const accounts = await Promise.all(rows.map(async (row) => {
        const u = await authApi(`users/${row.uid}`);
        return { uid: row.uid, shop: row.shop, email: (u.data && u.data.email) || '(ไม่พบบัญชี)',
          last_sign_in_at: (u.data && u.data.last_sign_in_at) || null, created_at: (u.data && u.data.created_at) || row.created_at };
      }));
      return json({ accounts });
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const shop = String(body.shop || '');
      if (!isEmail(email)) return json({ error: 'bad-email' }, 400);
      const s = await rest(`shops?select=code,name&code=eq.${encodeURIComponent(shop)}`);
      const shopRow = Array.isArray(s.data) ? (s.data as any[])[0] : null;
      if (!shopRow) return json({ error: 'no-shop' }, 400);
      let uid: string | null = null, existing = false;
      if (password.length < 8) return json({ error: 'short-password' }, 400);
      const c = await authApi('users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
      if (c.ok && c.data && c.data.id) uid = c.data.id;
      else {
        const msg = JSON.stringify(c.data || '');
        if (!/already|exists|registered/i.test(msg)) return json({ error: 'create-failed', detail: msg.slice(0, 300) }, 400);
        uid = await uidByEmail(email); existing = true;
        if (!uid) return json({ error: 'create-failed', detail: 'email exists but not found' }, 400);
      }
      if (await adminUid(uid)) return json({ error: 'is-owner-account' }, 400); // บัญชีเจ้าของห้ามเอาไปเป็นบัญชีร้าน
      const ins = await rest('partners?on_conflict=uid', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ uid, name: shopRow.name, shop: shopRow.code }) });
      if (!ins.ok) return json({ error: 'link-failed', detail: JSON.stringify(ins.data).slice(0, 300) }, 400);
      return json({ ok: true, uid, existing });
    }

    if (action === 'password') {
      const uid = String(body.uid || '');
      const password = String(body.password || '');
      if (!isUuid(uid)) return json({ error: 'bad-uid' }, 400);
      if (password.length < 8) return json({ error: 'short-password' }, 400);
      if (!(await partnerRow(uid))) return json({ error: 'not-partner' }, 400);
      if (await adminUid(uid)) return json({ error: 'is-owner-account' }, 400);
      const u = await authApi(`users/${uid}`, { method: 'PUT', body: JSON.stringify({ password }) });
      if (!u.ok) return json({ error: 'update-failed', detail: JSON.stringify(u.data).slice(0, 300) }, 400);
      return json({ ok: true });
    }

    if (action === 'unlink') {
      const uid = String(body.uid || '');
      if (!isUuid(uid)) return json({ error: 'bad-uid' }, 400);
      const d = await rest(`partners?uid=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!d.ok) return json({ error: 'unlink-failed' }, 400);
      return json({ ok: true });
    }

    return json({ error: 'bad-action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
