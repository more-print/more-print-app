// Edge Function: line-whoami — ตัวช่วยหา "รหัสปลายทาง" ของ LINE (ใช้ครั้งเดียวตอนตั้งค่า)
// ตอบกลับในแชทที่พิมพ์ + ส่งซ้ำเข้า LINE เจ้าของ (LINE_OWNER_ID) เผื่อการตอบในกลุ่มติดสิทธิ์
Deno.serve(async (req) => {
  const token = Deno.env.get('LINE_TOKEN') || '';
  const owner = (Deno.env.get('LINE_OWNER_ID') || '').split(/[,\s]+/).filter(Boolean)[0] || '';
  const log = [];
  try {
    const body = await req.json().catch(() => ({}));
    const events = body.events || [];
    log.push('events=' + events.length);
    if (!token) log.push('NO_LINE_TOKEN');

    for (const ev of events) {
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId || '(ไม่พบรหัส)';
      const kind = src.groupId ? 'กลุ่ม (groupId)' : src.roomId ? 'ห้องแชท (roomId)' : 'ส่วนตัว (userId)';
      log.push(ev.type + ':' + kind + ':' + id);
      const text = '📋 รหัสปลายทางนี้คือ ' + kind + '\n\n' + id
        + '\n\nก๊อปรหัสนี้ไปใส่ใน Secret ชื่อ LINE_OWNER_ID ครับ (ใส่หลายรหัสได้ คั่นด้วย ,)';

      // 1) ตอบในแชทที่พิมพ์มา
      if (ev.replyToken) {
        const r = await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text }] }),
        });
        log.push('reply=' + r.status + (r.ok ? '' : ' ' + (await r.text()).slice(0, 120)));
      }
      // 2) ส่งซ้ำเข้า LINE เจ้าของ (จะได้เห็นรหัสแน่ ๆ แม้ตอบในกลุ่มไม่ได้)
      if (owner && id !== owner) {
        const r2 = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ to: owner, messages: [{ type: 'text', text: '🔎 พบรหัสปลายทางใหม่\n' + text }] }),
        });
        log.push('push=' + r2.status);
      }
    }
    console.log('line-whoami', log.join(' | '));
    return new Response(JSON.stringify({ ok: true, log }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.log('line-whoami ERROR', String(e), log.join(' | '));
    return new Response(JSON.stringify({ ok: true, error: String(e), log }), { headers: { 'Content-Type': 'application/json' } });
  }
});
