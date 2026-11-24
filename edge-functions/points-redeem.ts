// Edge Function: points-redeem — ลูกค้าแลกแต้มเป็นคูปองเข้า "คูปองของฉัน" (เจ้าของสั่ง 2026-11-24)
// แต้มมีมูลค่าเหมือนเงิน → ยืนยันตัวตนกับ LINE จริงก่อนทุกครั้ง (ไม่เชื่อรหัสที่หน้าเว็บส่งมา)
//   1) ตรวจ access token ของ LIFF กับ LINE ว่าออกให้ช่องทาง LINE Login ของร้านจริง
//   2) ขอโปรไฟล์จาก LINE ด้วย token นั้น → ได้ userId ตัวจริง
//   3) เรียก RPC redeem_points ด้วยสิทธิ์ระบบ (SUPABASE_SERVICE_ROLE_KEY ที่ Supabase ใส่ให้ฟังก์ชันเองอัตโนมัติ — คีย์ไม่ออกไปหน้าเว็บ)
//
// POST { access_token, reward } → { ok, title, balance } | { error }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CHANNEL_ID = '2010897028'; // LINE Login channel ของ LIFF ร้าน (ข้อมูลสาธารณะ ไม่ใช่รหัสลับ)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!SR) return json({ error: 'server-not-ready' }, 500);
    const body = await req.json().catch(() => ({}));
    const token = String(body.access_token || '');
    const reward = Number(body.reward);
    if (!token || !Number.isInteger(reward) || reward <= 0) return json({ error: 'bad-request' }, 400);

    // 1) token ต้องออกให้ช่องทางของร้าน และยังไม่หมดอายุ
    const v = await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token));
    const vj = await v.json().catch(() => ({}));
    if (!v.ok || String(vj.client_id) !== CHANNEL_ID || !(Number(vj.expires_in) > 0)) return json({ error: 'line-token' }, 401);

    // 2) userId ตัวจริงจาก LINE
    const p = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + token } });
    const pj = await p.json().catch(() => ({}));
    if (!p.ok || !pj.userId) return json({ error: 'line-profile' }, 401);

    // 3) แลกแต้ม (ตัดแต้ม + สร้างคูปองส่วนตัว + ใส่กระเป๋า ในธุรกรรมเดียว)
    const r = await fetch(URL_ + '/rest/v1/rpc/redeem_points', {
      method: 'POST',
      headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid_in: pj.userId, reward_in: reward }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) return json({ error: 'db', detail: JSON.stringify(d).slice(0, 300) }, 500);
    return json(d);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
