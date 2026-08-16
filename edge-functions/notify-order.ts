// Edge Function: notify-order — แจ้งเตือนเข้า LINE เมื่อมีออเดอร์ใหม่
// Secrets ที่ต้องตั้ง: LINE_TOKEN (channel access token), LINE_OWNER_ID (User ID เจ้าของ)
// (ไม่บังคับ) LINE_PARTNER_ID = User ID ร้านอุดมสุข — ถ้าตั้งไว้ งาน Pro จะแจ้งเขาด้วย
// เรียกทดสอบ: ?action=test → ส่งข้อความทดสอบหาเจ้าของทันที

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = Deno.env.get('LINE_TOKEN') || '';
    const owner = Deno.env.get('LINE_OWNER_ID') || '';
    const partner = Deno.env.get('LINE_PARTNER_ID') || '';
    if (!token || !owner) return json({ error: 'missing-secrets' }, 500);

    const push = (to: string, text: string) =>
      fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      });

    const url = new URL(req.url);
    if (url.searchParams.get('action') === 'test') {
      const r = await push(owner, '✅ ทดสอบระบบแจ้งเตือน MORE PRINT สำเร็จ! ออเดอร์ใหม่จะเด้งเข้าที่นี่ครับ 🖨️');
      return json({ ok: r.ok, status: r.status, detail: await r.text() });
    }

    // ตรวจกับฐานข้อมูลจริงก่อนแจ้ง — กันคนนอกยิงสแปม (ต้องเป็นออเดอร์ที่มีจริงและเพิ่งสั่ง)
    const { id } = await req.json();
    if (!id) return json({ error: 'no-id' }, 400);
    const sbUrl = Deno.env.get('SUPABASE_URL') || '';
    const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const r = await fetch(sbUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(id) + '&select=id,created_at,customer_fname,total,ptype,paper,addr,pickup,copies,delivery_cost', {
      headers: { apikey: srKey, Authorization: 'Bearer ' + srKey },
    });
    const rows = await r.json();
    const o = Array.isArray(rows) && rows[0];
    if (!o) return json({ error: 'order-not-found' }, 404);
    if (Date.now() - new Date(o.created_at).getTime() > 10 * 60 * 1000) return json({ error: 'too-old' }, 400);

    const isPro = o.ptype === 'pro';
    const text = '🖨️ ออเดอร์ใหม่ ' + o.id + '\n'
      + 'คุณ' + (o.customer_fname || 'ลูกค้า') + ' · ' + (isPro ? '✨ PRO ' + (o.paper || '') : 'งานทั่วไป') + ' · ฿' + (o.total || 0) + '\n'
      + (o.pickup ? '🏪 ลูกค้ามารับเองที่อุดมสุข' : '📍 ' + (o.addr || '-')) + '\n'
      + 'จัดการ: https://more-print.github.io/more-print-app/' + (isPro ? 'commission' : 'admin') + '.html';
    const r1 = await push(owner, text);
    if (isPro && partner) {
      await push(partner, '✨ งาน PRO ใหม่ ' + o.id + '\n' + (o.paper || '') + ' × ' + (o.copies || 1) + ' ชุด'
        + (o.pickup ? '\n🏪 ลูกค้าจะมารับเองที่ร้าน' : '\n🛵 MORE PRINT จะมารับไปส่ง')
        + '\nเปิดงาน: https://more-print.github.io/more-print-app/pro.html');
    }
    return json({ ok: r1.ok, status: r1.status });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
