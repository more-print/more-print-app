// Edge Function: notify-order v10 (2026-11-13: งาน Pro ใหม่ MORE PRINT จัดการเองที่ admin.html — แจ้งเข้ากลุ่มทีมหลักกลุ่มเดียวกับ Standard + ป้าย STANDARD/PRO ชัด ๆ · ไม่แจ้งร้านพาร์ทเนอร์ ยกเว้นงานเก่าที่ร้านทำ) · เดิม v9 — แจ้งเตือน LINE แยกกลุ่มตามประเภทงาน + ร้านทักลูกค้า (action=msg) + เช็คโควตา (action=quota)
// Secrets: LINE_TOKEN
//   LINE_OWNER_ID = กลุ่มทีมงาน Standard (ออเดอร์งานทั่วไป)
//   LINE_PRO_ID   = (v10 ไม่ใช้แล้ว — งาน Pro แจ้งกลุ่มเดียวกับ Standard)
//   LINE_PARTNER_ID (ไม่บังคับ) = ร้านอุดมสุข
// ?action=done + {id} → แจ้งว่างานผลิตเสร็จ/ส่งสำเร็จ เข้ากลุ่มของฝั่งนั้น ๆ
// ?action=chat + {id} → ลูกค้าแชทมาใน Live Chat → แจ้งกลุ่มให้เข้าไปตอบ (กันสแปม: แจ้งเฉพาะข้อความแรกที่ยังไม่อ่าน)
// ?action=test → ข้อความทดสอบหาเจ้าของ · ?action=cancelled + {id} → แจ้งลูกค้า (ต้องมี line_uid)
// ?action=customer-cancelled + {id} → ลูกค้ายกเลิกเองใน 10 นาที → แจ้งเจ้าของ (+พาร์ทเนอร์ถ้างาน Pro) ว่าไม่ต้องทำงานนี้
// ?action=msg + {id, text} → ร้านทักลูกค้า: push ข้อความเข้า LINE ของลูกค้า (ต้องมี line_uid) — v8
// ?action=quota → เช็คโควตาข้อความฟรี LINE OA เดือนนี้ {plan, limit, used, left} — อ่านอย่างเดียว ไม่กินโควตา — v9

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
    // รองรับหลายปลายทาง: ใส่ id คั่นด้วย , หรือเว้นบรรทัดก็ได้ (ทีมงานหลายคน / กลุ่ม LINE)
    const ids = (v) => (v || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const owners = ids(Deno.env.get('LINE_OWNER_ID'));     // กลุ่มงาน Standard
    const partners = ids(Deno.env.get('LINE_PARTNER_ID'));
    if (!token || !owners.length) return json({ error: 'missing-secrets' }, 500);
    // เลือกกลุ่มตามประเภทงาน — กลุ่ม Pro ยังไม่ตั้งค่า = ใช้กลุ่ม Standard แทน (แจ้งเตือนต้องไม่หาย)
    // v10 (เจ้าของสั่ง 2026-11-13): งาน Pro แจ้งเข้ากลุ่มทีมหลักกลุ่มเดียวกับ Standard — แยกด้วยป้ายในข้อความแทน
    const teamOf = (_isPro) => owners;
    const tagOf = (isPro) => isPro ? '🟣 [งาน PRO]' : '🔵 [งาน STANDARD]';

    const pushOne = (to, text) =>
      fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      });
    // ส่งทีเดียวหลายปลายทาง — ปลายทางไหนพัง ปลายทางอื่นยังได้รับ
    const push = async (to, text) => {
      const list = Array.isArray(to) ? to : [to];
      const rs = await Promise.all(list.map((t) => pushOne(t, text).catch(() => ({ ok: false, status: 0 }))));
      const okCount = rs.filter((r) => r.ok).length;
      return { ok: okCount > 0, status: okCount + '/' + list.length };
    };

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'new';

    if (action === 'test') {
      // v10: กลุ่มทีมหลักกลุ่มเดียวรับทั้ง Standard และ PRO (LINE_PRO_ID ไม่ใช้แล้ว)
      const r1 = await push(owners, '✅ ทดสอบสำเร็จ! กลุ่มนี้จะได้รับแจ้งเตือนออเดอร์ทั้ง 🔵 [งาน STANDARD] และ 🟣 [งาน PRO] ครับ 🖨️');
      return json({ ok: r1.ok, status: r1.status });
    }

    if (action === 'quota') {
      // เช็คโควตาข้อความฟรีของ LINE OA เดือนนี้ — เป็นแค่การอ่านตัวเลข ไม่กินโควตา
      const [qr, cr] = await Promise.all([
        fetch('https://api.line.me/v2/bot/message/quota', { headers: { Authorization: 'Bearer ' + token } }),
        fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: { Authorization: 'Bearer ' + token } }),
      ]);
      const q = await qr.json().catch(() => ({}));
      const c = await cr.json().catch(() => ({}));
      const limit = q.type === 'limited' ? q.value : null; // 'none' = แพลนไม่จำกัด
      const used = typeof c.totalUsage === 'number' ? c.totalUsage : null;
      return json({ ok: qr.ok && cr.ok, plan: q.type || 'unknown', limit, used,
        left: (limit != null && used != null) ? Math.max(0, limit - used) : null });
    }

    // ดึงออเดอร์จริงจากฐานข้อมูล (สิทธิ์ระบบ) — กันคนนอกยิงมั่ว
    const reqBody = await req.json().catch(() => ({}));
    const id = reqBody.id;
    if (!id) return json({ error: 'no-id' }, 400);
    const sbUrl = Deno.env.get('SUPABASE_URL') || '';
    const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const hdrs = { apikey: srKey, Authorization: 'Bearer ' + srKey };
    const baseCols = 'id,created_at,status,cancel_reason,line_uid,customer_fname,total,ptype,paper,addr,pickup,copies';
    // partner = งาน Pro ที่ร้านพาร์ทเนอร์ทำ (งานเก่า) — งานใหม่ว่าง · ขอพร้อม note ก่อน ไม่มีคอลัมน์ค่อยถอย
    // ขอคอลัมน์ note ด้วย — ฐานข้อมูลที่ยังไม่มีคอลัมน์นี้ให้ถอยไปขอชุดเดิม (ห้ามพังทุก action)
    let rows = await (await fetch(sbUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(id) + '&select=' + baseCols + ',note,partner', { headers: hdrs })).json();
    if (!Array.isArray(rows)) rows = await (await fetch(sbUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(id) + '&select=' + baseCols + ',note', { headers: hdrs })).json();
    if (!Array.isArray(rows)) rows = await (await fetch(sbUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(id) + '&select=' + baseCols, { headers: hdrs })).json();
    const o = Array.isArray(rows) && rows[0];
    if (!o) return json({ error: 'order-not-found' }, 404);

    if (action === 'msg') {
      // ร้านทักลูกค้าทาง LINE OA — ส่งได้เฉพาะออเดอร์จริงที่ลูกค้าล็อกอินด้วย LINE
      const t = String(reqBody.text || '').trim().slice(0, 500);
      if (!t) return json({ error: 'no-text' }, 400);
      if (!o.line_uid) return json({ ok: false, reason: 'no-line-uid' });
      const rr = await pushOne(o.line_uid,
        '💬 MORE PRINT ถึงคุณ' + (o.customer_fname || 'ลูกค้า') + ' (ออเดอร์ ' + o.id + ')\n'
        + t + '\n\n'
        + 'ตอบกลับได้ใน Live Chat: https://more-print.github.io/more-print-app/').catch(() => null);
      if (!rr) return json({ ok: false, reason: 'network' });
      if (rr.status === 429) return json({ ok: false, reason: 'quota' });
      return json({ ok: rr.ok, status: rr.status });
    }

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
      const r1 = await push(teamOf(isPro),
        tagOf(isPro) + '\n↩️ ลูกค้ายกเลิกออเดอร์ ' + o.id + ' เอง\n'
        + 'คุณ' + (o.customer_fname || 'ลูกค้า') + ' · ' + (isPro ? (o.paper || 'งาน PRO') : 'งานเอกสาร') + ' · ฿' + (o.total || 0) + '\n'
        + '⛔ ไม่ต้องทำงานนี้แล้ว — ถ้าลูกค้าโอนเงินแล้ว รอลูกค้าทักมาขอคืนครับ');
      if (isPro && o.partner && partners.length) { // แจ้งร้านเฉพาะงานที่ร้านพาร์ทเนอร์รับไปทำ (งานเก่า)
        await push(partners, '⛔ งาน PRO ' + o.id + ' ถูกยกเลิกโดยลูกค้า — ไม่ต้องผลิตครับ');
      }
      return json({ ok: r1.ok, status: r1.status });
    }

    if (action === 'chat') {
      // ลูกค้าส่งแชทใหม่ → แจ้งกลุ่ม 1 ครั้งต่อชุดข้อความ (ยังไม่เข้าไปอ่าน = ไม่แจ้งซ้ำ)
      const mr = await fetch(sbUrl + '/rest/v1/messages?order_id=eq.' + encodeURIComponent(id)
        + '&sender=eq.customer&seen_by_shop=eq.false&order=id.desc&limit=5', {
        headers: { apikey: srKey, Authorization: 'Bearer ' + srKey },
      });
      const msgs = await mr.json();
      if (!Array.isArray(msgs) || !msgs.length) return json({ ok: false, reason: 'no-unread' });
      if (msgs.length > 1) return json({ ok: false, reason: 'already-notified' });
      const isPro = o.ptype === 'pro';
      const r1 = await push(teamOf(isPro),
        tagOf(isPro) + '\n💬 ลูกค้าแชทมาใหม่ · ออเดอร์ ' + o.id + '\n'
        + 'คุณ' + (o.customer_fname || 'ลูกค้า') + ': "' + String(msgs[0].body || '').slice(0, 120) + '"\n'
        + 'เข้าไปตอบที่แท็บ 💬 แชท: https://more-print.github.io/more-print-app/admin.html');
      return json({ ok: r1.ok, status: r1.status });
    }

    if (action === 'done') {
      // งานเสร็จ/ส่งสำเร็จ → รีมาร์คเข้ากลุ่มของฝั่งนั้น (เช็คสถานะจริงจากฐานข้อมูล)
      const isPro = o.ptype === 'pro';
      const who = 'คุณ' + (o.customer_fname || 'ลูกค้า') + ' · ' + (isPro ? (o.paper || 'งาน PRO') : 'งานเอกสาร') + ' · ฿' + (o.total || 0);
      let text = null;
      if (o.status === 4) {
        text = tagOf(isPro) + '\n' + (o.pickup ? '✅ ออเดอร์ ' + o.id + ' ลูกค้ารับสินค้าแล้ว 🎉' : '✅ ออเดอร์ ' + o.id + ' จัดส่งสำเร็จแล้ว 🎉') + '\n' + who;
      } else if (o.status === 3 && o.pickup) {
        text = tagOf(isPro) + '\n📦 ออเดอร์ ' + o.id + ' ผลิตเสร็จแล้ว — รอลูกค้ามารับที่' + (isPro ? 'จุดรับงาน Pro' : 'หน้าร้าน MORE PRINT') + '\n' + who;
      }
      if (!text) return json({ ok: false, reason: 'not-done-yet' });
      const r1 = await push(teamOf(isPro), text);
      return json({ ok: r1.ok, status: r1.status });
    }

    // ออเดอร์ใหม่ → แจ้งกลุ่มทีมหลัก (Standard + Pro กลุ่มเดียวกัน แยกด้วยป้าย) — v10: ไม่แจ้งร้านพาร์ทเนอร์แล้ว (งาน Pro ใหม่ MORE PRINT จัดการเอง)
    if (o.status === 0) return json({ error: 'cancelled-order' }, 400); // ออเดอร์ที่ยกเลิกแล้วห้ามเด้งเป็น "ออเดอร์ใหม่"
    if (Date.now() - new Date(o.created_at).getTime() > 10 * 60 * 1000) return json({ error: 'too-old' }, 400);
    const isPro = o.ptype === 'pro';
    const text = tagOf(isPro) + '\n🖨️ ออเดอร์ใหม่ ' + o.id + '\n'
      + 'คุณ' + (o.customer_fname || 'ลูกค้า') + ' · ' + (isPro ? (o.paper || 'งาน PRO') : 'งานเอกสาร') + ' · ฿' + (o.total || 0) + '\n'
      // จุดรับเองแยกตามประเภทงาน (แก้ 2026-09-10): Pro = ร้านอุดมสุขปริ้นติ้ง · Standard = หน้าร้าน MORE PRINT — ต้องตรงกับป้าย addr ใน index.html
      + (o.pickup ? (isPro ? '🏪 ลูกค้ามารับเองที่จุดรับงาน Pro' : '🏪 ลูกค้ามารับหน้าร้าน MORE PRINT (หอพักบริบูรณ์เพลส)') : '📍 ' + (o.addr || '-')) + '\n'
      + (o.note ? '📝 หมายเหตุ: ' + String(o.note).slice(0, 200) + '\n' : '')
      + 'จัดการ: https://more-print.github.io/more-print-app/admin.html';
    const r1 = await push(teamOf(isPro), text);
    return json({ ok: r1.ok, status: r1.status });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
