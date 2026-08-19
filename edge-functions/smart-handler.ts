// Edge Function: smart-handler — แกะลิงก์สั้นของ Google → URL ปลายทาง (ลิงก์เต็มหลัง redirect)
// ใช้โดยหน้าเว็บลูกค้าตอนวางลิงก์จุดส่ง: GET ?u=<ลิงก์> → {"final":"<URL ปลายทาง>"}
// รองรับ: maps.app.goo.gl · goo.gl · g.co · share.google (ลิงก์แชร์จากแอป Google) · google.com/maps
// โดเมนนอกรายการ → 400 (กันโดนใช้เป็นตัวกลางยิงเว็บอื่น)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ALLOWED = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'share.google', 'google.com', 'maps.google.com'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const u = new URL(req.url).searchParams.get('u') || '';
    let target: URL;
    try { target = new URL(u); } catch { return json({ error: 'bad-url' }, 400); }
    if (target.protocol !== 'https:') return json({ error: 'url not allowed' }, 400);
    const host = target.hostname.toLowerCase();
    if (!ALLOWED.some((d) => host === d || host.endsWith('.' + d))) return json({ error: 'url not allowed' }, 400);

    // ตาม redirect ไปจนสุดทาง — ตั้งเวลาหมดเขต 12 วิ กันค้าง
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(target.href, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
        'Accept-Language': 'th-TH,th;q=0.9',
      },
    });
    clearTimeout(timer);
    return json({ final: r.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
