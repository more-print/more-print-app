// Edge Function: line-whoami — ตัวช่วยหา "รหัสปลายทาง" ของ LINE (ใช้ครั้งเดียวตอนตั้งค่า)
// วิธีใช้: เอา URL ของฟังก์ชันนี้ไปใส่เป็น Webhook URL ใน LINE Developers → เปิด Use webhook
//         แล้วพิมพ์อะไรก็ได้ในกลุ่ม (หรือแชทส่วนตัวกับ OA) บอทจะตอบรหัสกลับมาให้
// ตั้งค่าเสร็จแล้วปิด Use webhook หรือลบฟังก์ชันนี้ทิ้งได้เลย
Deno.serve(async (req) => {
  try {
    const token = Deno.env.get('LINE_TOKEN') || '';
    const body = await req.json().catch(() => ({}));
    for (const ev of (body.events || [])) {
      if (ev.type !== 'message' || !ev.replyToken) continue;
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId || '(ไม่พบรหัส)';
      const kind = src.groupId ? 'กลุ่ม (groupId)' : src.roomId ? 'ห้องแชท (roomId)' : 'ส่วนตัว (userId)';
      await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          replyToken: ev.replyToken,
          messages: [{ type: 'text', text: '📋 รหัสปลายทางนี้คือ ' + kind + '\n\n' + id + '\n\nก๊อปรหัสนี้ไปใส่ใน Secret ชื่อ LINE_OWNER_ID ครับ (ใส่หลายรหัสได้ คั่นด้วย ,)' }],
        }),
      });
    }
    return new Response('ok'); // LINE ต้องได้ 200 เสมอ
  } catch (e) {
    return new Response('ok');
  }
});
