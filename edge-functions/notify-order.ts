// Edge Function: notify-order — แจ้งเตือน LINE: ออเดอร์ใหม่ (→เจ้าของ/พาร์ทเนอร์) + ออเดอร์ถูกยกเลิก (→ลูกค้า)
// Secrets: LINE_TOKEN, LINE_OWNER_ID, (ไม่บังคับ) LINE_PARTNER_ID
// ?action=test → ข้อความทดสอบหาเจ้าของ · ?action=cancelled + {id} → แจ้งลูกค้า (ต้องมี line_uid)
// ?action=customer-cancelled + {id} → ลูกค้ายกเลิกเองใน 10 นาที → แจ้งเจ้าของ (+พาร์ทเนอร์ถ้างาน Pro) ว่าไม่ต้องทำงานนี้

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = Deno.env.get('LINE_TOKEN') || '';
    const owner = Deno.env.get('LINE_OWNER_ID') || '';
    const partner = Deno.env.get('LINE_PARTNER_ID') || '';
    if (!token || !owner) return json({ error: 'missing-secrets' }, 500);

    const push = (to, text) =>
      fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      });

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'new';

    if (action === 'test') {
      const r = await push(owner, '✅ ทดสอบระบบแจ้งเตือน MORE PRINT สำเร็จ! ออเดอร์ใหม่จะเด้งเข้าที่นี่ครับ 🖨️');
      return json({ ok: r.ok, status: r.status, detail: await r.text() });
    }

    // ดึงออเดอร์จริงจากฐานข้อมูล (สิทธิ์ระบบ) — กันคนนอกยิงมั่ว
    const { id } = await req.json();
    if (!id) return json({ error: 'no-id' }, 400);
    const sbUrl = Deno.env.get('SUPABASE_URL') || '';
    const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const r = await fetch(sbUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(id) + '&select=id,created_at,status,cancel_reason,line_uid,customer_fname,total,ptype,paper,addr,pickup,copies', {
      headers: { apikey: srKey, Authorization: 'Bearer ' + srKey },
    });
    const rows = await r.json();
    const o = Array.isArray(rows) && rows[0];
    if (!o) return json({ error: 'order-not-found' }, 404);

    if (action === 'cancelled') {
      // แจ้งลูกค้าว่าออเดอร์ถูกยกเลิก (เฉพาะลูกค้าที่ล็อกอินด้วย LINE)
      if (o.status !== 0) return json({ error: 'not-cancelled' }, 400);
      if (!o.line_uid) return json({ ok: false, reason: 'no-line-uid' });
      const r1 = await push(o.line_uid,
        '❌ ขออภัยครับ ออเดอร์ ' + o.id + ' ถูกยกเลิกโดยร้าน\n'
        + 'เหตุผล: ' + (o.cancel_reason || '-') + '\n'
        + 'โอนเงินแล้ว? ทักแชทนี้เพื่อขอเงินคืนได้เลยครับ 🙏');
      return json({ ok: r1.ok, status: r1.status });
    }

    if (action === 'customer-cancelled') {
      // ลูกค้ากดยกเลิกเองจากหน้าเว็บ → แจ้งร้านให้หยุดงานนี้ (เช็คกับฐานข้อมูลจริง กันคนนอกยิงมั่ว)
      if (o.status !== 0 || !/^ลูกค้ายกเลิกเอง/.test(o.cancel_reason || '')) return json({ error: 'not-self-cancelled' }, 400);
      if (Date.now() - new Date(o.created_at).getTime() > 30 * 60 * 1000) return json({ error: 'too-old' }, 400);
      const isPro = o.ptype === 'pro';
      const r1 = await push(owner,
        '↩️ ลูกค้ายกเลิกออเดอร์ ' + o.id + ' เอง\n'
        + 'คุณ' + (o.customer_fname || 'ลูกค้า') + ' · ' + (isPro ? '✨ PRO ' + (o.paper || '') : 'งานทั่วไป') + ' · ฿' + (o.total || 0) + '\n'
        + '⛔ ไม่ต้องทำงานนี้แล้ว — ถ้าลูกค้าโอนเงินแล้ว รอลูกค้าทักมาขอคืนครับ');
      if (isPro && partner) {
        await push(partner, '⛔ งาน PRO ' + o.id + ' ถูกยกเลิกโดยลูกค้า — ไม่ต้องผลิตครับ');
      }
      return json({ ok: r1.ok, status: r1.status });
    }

    // ออเดอร์ใหม่ → แจ้งเจ้าของ (+พาร์ทเนอร์ถ้าเป็นงาน Pro)
    if (o.status === 0) return json({ error: 'cancelled-order' }, 400); // ออเดอร์ที่ยกเลิกแล้วห้ามเด้งเป็น "ออเดอร์ใหม่"
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
