// Edge Function: r2-sign — ออก "ลิงก์ชั่วคราว" (presigned URL) ให้เบราว์เซอร์อัปโหลด/เปิดไฟล์บน Cloudflare R2 ตรง ๆ
// ไฟล์ไม่วิ่งผ่าน Supabase เลย = ไม่กิน Egress/Storage ของ Supabase (2026-10-30)
//
// วางในหน้า Edge Functions ของ Supabase: สร้างฟังก์ชันชื่อ r2-sign · ปิด "Verify JWT" (ลูกค้าไม่ได้ล็อกอิน — ฟังก์ชันเช็คสิทธิ์เอง)
// ตั้ง Secrets 4 ตัว (คัดลอกค่าจากไฟล์ .env ในเครื่อง — ห้ามใส่ในโค้ด/ห้าม commit):
//   R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET
// (SUPABASE_URL / SUPABASE_ANON_KEY มีให้อัตโนมัติในทุก Edge Function)
//
// action:
//   put    — ใครก็ขอได้สำหรับ kind 'pdf' (≤50MB, application/pdf) และ 'slip' (≤10MB, image/*) → คีย์สุ่มที่ฝั่งนี้สร้างเอง
//            kind 'media' / 'payout' ต้องเป็นเจ้าของร้าน (is_admin)
//   get    — เจ้าของร้าน หรือร้านพาร์ทเนอร์ (is_admin / is_partner) เท่านั้น → ลิงก์เปิดไฟล์อายุ 1 ชั่วโมง
//   delete — เจ้าของร้านเท่านั้น และลบได้เฉพาะคีย์ที่ขึ้นต้น pdf/ (สลิปห้ามลบด้วยฟังก์ชันนี้ ตามกติกาเจ้าของ)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── AWS Signature V4 แบบ query string (R2 ใช้ S3 API · region = auto) — WebCrypto ล้วน ไม่มี dependency ──
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const hmac = async (key: ArrayBuffer | Uint8Array, msg: string) => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
};
const uriEnc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const pathEnc = (p: string) => p.split('/').map(uriEnc).join('/');

export async function presign(opts: {
  method: string; host: string; path: string; accessKey: string; secretKey: string;
  region: string; expires: number; now?: Date; signedHeaders?: Record<string, string>;
}): Promise<string> {
  const now = opts.now || new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const headers: Record<string, string> = { host: opts.host, ...(opts.signedHeaders || {}) };
  const hNames = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const lower: Record<string, string> = {}; Object.entries(headers).forEach(([k, v]) => { lower[k.toLowerCase()] = String(v).trim(); });
  const q: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${opts.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(opts.expires),
    'X-Amz-SignedHeaders': hNames.join(';'),
  };
  const canonQuery = Object.keys(q).sort().map(k => `${uriEnc(k)}=${uriEnc(q[k])}`).join('&');
  const canonHeaders = hNames.map(h => `${h}:${lower[h]}\n`).join('');
  const canonReq = [opts.method, pathEnc(opts.path), canonQuery, canonHeaders, hNames.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonReq)].join('\n');
  let k = await hmac(enc.encode('AWS4' + opts.secretKey), dateStamp);
  k = await hmac(k, opts.region); k = await hmac(k, 's3'); k = await hmac(k, 'aws4_request');
  const sig = hex(await hmac(k, toSign));
  return `https://${opts.host}${pathEnc(opts.path)}?${canonQuery}&X-Amz-Signature=${sig}`;
}

// ── เช็คสิทธิ์ผู้เรียกจาก token ที่หน้าเว็บส่งมา (บัญชี Supabase Auth ของหลังบ้าน) ──
async function roleOf(req: Request): Promise<{ admin: boolean; partner: boolean }> {
  const auth = req.headers.get('authorization') || '';
  const url = Deno.env.get('SUPABASE_URL') || '', anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) === anon) return { admin: false, partner: false };
  const call = async (fn: string) => {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
      return r.ok && (await r.json()) === true;
    } catch { return false; }
  };
  const admin = await call('is_admin');
  return { admin, partner: admin ? false : await call('is_partner') };
}

const KINDS: Record<string, { max: number; type: RegExp; cache: string; admin?: boolean }> = {
  pdf:    { max: 50 * 1024 * 1024, type: /^application\/pdf$/, cache: 'private, max-age=31536000, immutable' },
  slip:   { max: 10 * 1024 * 1024, type: /^image\//,             cache: 'private, max-age=31536000, immutable' },
  payout: { max: 10 * 1024 * 1024, type: /^image\//,             cache: 'private, max-age=31536000, immutable', admin: true },
  media:  { max: 30 * 1024 * 1024, type: /^(image|video)\//,     cache: 'public, max-age=31536000, immutable', admin: true },
};
const rand = () => [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
const safeName = (n: string) => String(n || 'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const acct = Deno.env.get('R2_ACCOUNT_ID') || '', ak = Deno.env.get('R2_ACCESS_KEY_ID') || '';
    const sk = Deno.env.get('R2_SECRET_ACCESS_KEY') || '', bucket = Deno.env.get('R2_BUCKET') || '';
    if (!acct || !ak || !sk || !bucket) return json({ error: 'missing-secrets' }, 500);
    const host = `${acct}.r2.cloudflarestorage.com`;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'put') {
      const kind = KINDS[body.kind];
      if (!kind) return json({ error: 'bad-kind' }, 400);
      if (kind.admin && !(await roleOf(req)).admin) return json({ error: 'forbidden' }, 403);
      const size = Number(body.size), type = String(body.contentType || '');
      if (!(size > 0) || size > kind.max) return json({ error: 'too-large', max: kind.max }, 400);
      if (!kind.type.test(type)) return json({ error: 'bad-type' }, 400);
      const ym = new Date().toISOString().slice(0, 7).replace('-', '');
      const key = `${body.kind}/${ym}/${rand()}/${safeName(body.name)}`;
      // ลงนาม content-length ด้วย = อัปได้เฉพาะไฟล์ขนาดที่แจ้งไว้เป๊ะ (กันใช้ลิงก์อัปไฟล์ใหญ่กว่าที่อนุญาต)
      const url = await presign({ method: 'PUT', host, path: `/${bucket}/${key}`, accessKey: ak, secretKey: sk, region: 'auto', expires: 900, signedHeaders: { 'content-length': String(size) } });
      return json({ key, url, headers: { 'Content-Type': type, 'Cache-Control': kind.cache } });
    }

    if (action === 'get') {
      const key = String(body.key || '');
      if (!/^(pdf|slip|payout|media)\//.test(key)) return json({ error: 'bad-key' }, 400);
      if (!key.startsWith('media/')) { const r = await roleOf(req); if (!r.admin && !r.partner) return json({ error: 'forbidden' }, 403); }
      const url = await presign({ method: 'GET', host, path: `/${bucket}/${key}`, accessKey: ak, secretKey: sk, region: 'auto', expires: 3600 });
      return json({ url, expiresIn: 3600 });
    }

    if (action === 'delete') {
      if (!(await roleOf(req)).admin) return json({ error: 'forbidden' }, 403);
      const keys: string[] = (Array.isArray(body.keys) ? body.keys : []).map(String).slice(0, 50);
      const bad = keys.filter(k => !k.startsWith('pdf/'));
      if (bad.length) return json({ error: 'only-pdf-keys', bad }, 400); // สลิปห้ามลบ
      const done: string[] = [], failed: string[] = [];
      for (const key of keys) {
        const url = await presign({ method: 'DELETE', host, path: `/${bucket}/${key}`, accessKey: ak, secretKey: sk, region: 'auto', expires: 300 });
        const r = await fetch(url, { method: 'DELETE' });
        (r.ok || r.status === 404 ? done : failed).push(key);
      }
      return json({ deleted: done, failed });
    }

    if (action === 'head') { // เช็คว่าไฟล์ยังอยู่ไหม (ใช้ตอนย้ายไฟล์/ตรวจ) — เจ้าของเท่านั้น
      if (!(await roleOf(req)).admin) return json({ error: 'forbidden' }, 403);
      const key = String(body.key || '');
      const url = await presign({ method: 'HEAD', host, path: `/${bucket}/${key}`, accessKey: ak, secretKey: sk, region: 'auto', expires: 300 });
      const r = await fetch(url, { method: 'HEAD' });
      return json({ exists: r.ok, size: Number(r.headers.get('content-length') || 0), etag: r.headers.get('etag') });
    }

    return json({ error: 'bad-action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
