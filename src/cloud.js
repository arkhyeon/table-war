// 클라우드 저장: claude.ai 아티팩트의 저장소(db)에 사람마다 따로 저장
// 휴대폰 앱처럼 브라우저 저장(localStorage)이 지워지는 곳에서도 이어하기가 되도록
// 저장 하나 = 요약 문서(save0~3) + 압축한 내용을 나눠 담은 조각 문서들
const PART = 180000; // 압축 조각 하나에 담는 글자 수 (문서 한도 256KiB 안쪽)
const PART_RAW = 60000; // 압축을 못 할 때: 한글은 글자당 3바이트라 더 잘게

let ready = null;
// 쓸 수 있으면 { db, base }, 아니면 null (아티팩트 밖·로그아웃 등)
export function cloud() {
  if (!ready) {
    ready = (async () => {
      // 페이지가 뜬 직후엔 window.claude가 아직 없을 수 있어 잠깐 기다림
      for (let i = 0; i < 30 && !window.claude?.use; i++) await new Promise((r) => setTimeout(r, 100));
      if (!window.claude?.use) return null;
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return null;
      const id = await user.id();
      return id ? { db, base: `data/users/${id}` } : null;
    })().catch(() => null);
  }
  return ready;
}

async function pack(text) {
  if (typeof CompressionStream === 'undefined') return { z: false, s: text };
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { z: true, s: btoa(bin) };
}
async function unpack(z, s) {
  if (!z) return s;
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

// 한 번에 하나씩만 저장 (같은 문서에 겹쳐 쓰지 않게), 밀린 건 마지막 것만
const queue = {};
export function cloudSave(k, data, info) {
  const q = (queue[k] = queue[k] || { busy: false, next: null });
  q.next = { data, info };
  if (q.busy) return;
  q.busy = true;
  (async () => {
    while (q.next) {
      const job = q.next;
      q.next = null;
      try {
        const c = await cloud();
        if (!c) break;
        const savedAt = Date.now();
        const { z, s } = await pack(JSON.stringify({ ...job.data, savedAt }));
        const ref = c.db.doc(`${c.base}/save${k}`);
        const size = z ? PART : PART_RAW;
        const n = Math.ceil(s.length / size) || 1;
        for (let i = 0; i < n; i++) await ref.collection('parts').doc(`p${i}`).set({ s: s.slice(i * size, (i + 1) * size) });
        await ref.set({ n, z, savedAt, info: job.info || null });
      } catch {
        /* 저장 실패는 다음 저장 때 다시 */
      }
    }
    q.busy = false;
  })();
}

// 저장 요약 목록 { 0: {savedAt, info}, ... }
export async function cloudList(count) {
  const c = await cloud();
  if (!c) return {};
  const out = {};
  await Promise.all(
    Array.from({ length: count + 1 }, (_, k) => k).map(async (k) => {
      try {
        const d = await c.db.doc(`${c.base}/save${k}`).get();
        if (d.exists) out[k] = d.data();
      } catch {
        /* 무시 */
      }
    }),
  );
  return out;
}

export async function cloudLoad(k) {
  const c = await cloud();
  if (!c) return null;
  const ref = c.db.doc(`${c.base}/save${k}`);
  const meta = await ref.get();
  if (!meta.exists) return null;
  const { n, z } = meta.data();
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => ref.collection('parts').doc(`p${i}`).get()));
  if (parts.some((p) => !p.exists)) return null;
  return JSON.parse(await unpack(z, parts.map((p) => p.data().s).join('')));
}

export async function cloudDelete(k) {
  const c = await cloud();
  if (!c) return;
  try {
    await c.db.doc(`${c.base}/save${k}`).delete();
  } catch {
    /* 무시 */
  }
}
