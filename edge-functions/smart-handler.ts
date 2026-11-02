// Edge Function: smart-handler — แกะลิงก์สั้นของ Google → URL ปลายทาง (ลิงก์เต็มหลัง redirect)
// ใช้โดยหน้าเว็บลูกค้าตอนวางลิงก์จุดส่ง: GET ?u=<ลิงก์> → {"final":"<URL ปลายทาง>"}
// รองรับ: maps.app.goo.gl · goo.gl · g.co · share.google (ลิงก์แชร์จากแอป Google) · google.com/maps
// โดเมนนอกรายการ → 400 (กันโดนใช้เป็นตัวกลางยิงเว็บอื่น)
//
// v3 (2026-11-02): ลิงก์แชร์ "ร้าน/สถานที่" (เช่น ค้นชื่อหอแล้วกดแชร์) ปลายทางไม่มีพิกัดใน URL — มีแค่ชื่อ + รหัสสถานที่ ftid
// → ถามข้อมูลสถานที่ต่อจาก Google (ทางเดียวกับที่หน้า Google Maps ใช้เอง) แล้วส่งพิกัดกลับมาด้วย:
//   {"final":"…","lat":16.46,"lng":102.82,"name":"ชื่อสถานที่"}
// ใช้เฉพาะเมื่อรหัสสถานที่ที่ Google ตอบ "ตรงกับในลิงก์เป๊ะ" — ไม่ตรง/อ่านไม่ได้ = ตอบแค่ final เหมือนเดิม (ไม่เดาพิกัด)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ALLOWED = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'share.google', 'google.com', 'maps.google.com'];

// หน้าเว็บเดสก์ท็อปเล็กกว่ารุ่นมือถือ ~4 เท่า (โหลดเร็วกว่า) · SOCS = ข้ามหน้าขอความยินยอมคุกกี้ของ Google
const PLACE_HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'th-TH,th;q=0.9',
  'Cookie': 'SOCS=CAI',
};

// URL มีพิกัดอยู่แล้ว (หน้าเว็บแกะเองได้) — ไม่ต้องถามต่อ
const hasCoord = (s: string) => /!3d-?\d|@-?\d{1,2}\.\d+,-?\d{1,3}\.\d+|-?\d{1,2}\.\d{4,}(?:,|%2C)\s*\+?\s*-?\d{1,3}\.\d{4,}/i.test(s);

async function placeLatLng(finalUrl: string): Promise<{ lat: number; lng: number; name: string } | null> {
  let u: URL;
  try { u = new URL(finalUrl); } catch { return null; }
  if (!/(^|\.)google\.com$/i.test(u.hostname) || !u.pathname.startsWith('/maps')) return null;
  const dm = finalUrl.match(/!1s(0x[0-9a-f]+(?::|%3A)0x[0-9a-f]+)/i); // ลิงก์แบบ /maps/place/…/data=!…!1s0x…:0x…
  const ftid = (u.searchParams.get('ftid') || (dm ? dm[1].replace(/%3A/i, ':') : '')).toLowerCase();
  if (!/^0x[0-9a-f]+:0x[0-9a-f]+$/.test(ftid)) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000); // หน้าเว็บลูกค้ารอรวม ~8-10 วิ — ส่วนนี้ต้องจบใน 6 วิ
  try {
    const page = await (await fetch(u.href, { headers: PLACE_HDR, signal: ctl.signal })).text();
    const m = page.match(/href="(\/maps\/preview\/place\?[^"]+)"/);
    if (!m) return null;
    const t = await (await fetch('https://www.google.com' + m[1].replace(/&amp;/g, '&'), { headers: PLACE_HDR, signal: ctl.signal })).text();
    const d = JSON.parse(t.slice(t.indexOf('\n') + 1)); // ตัดบรรทัดกันสคริปต์ )]}' ข้างหน้าออก
    const p = d && d[6];
    if (!p || String(p[10] || '').toLowerCase() !== ftid) return null; // ต้องเป็นสถานที่เดียวกับในลิงก์เท่านั้น
    const loc = p[9] || [];
    const lat = Number(loc[2]), lng = Number(loc[3]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { lat, lng, name: String(p[11] || '').slice(0, 80) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
    const out: Record<string, unknown> = { final: r.url };
    if (!hasCoord(r.url)) { const p = await placeLatLng(r.url); if (p) Object.assign(out, p); }
    return json(out);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
