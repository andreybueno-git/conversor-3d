/* OS ARQUIVOS QUE O CONVERSOR GRAVA: STL binário, 3MF e o ZIP de "baixar
   todos". TS puro, sem dependência.

   Data fixa (1/1/1980) nos ZIPs: o mesmo modelo dá o mesmo arquivo. */

let tabela: Uint32Array | null = null;

/** CRC-32 do ZIP, incremental (passe o valor anterior). */
export function crc32(dados: Uint8Array, anterior = 0): number {
  if (!tabela) {
    tabela = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c >>> 0;
    }
  }
  let c = (anterior ^ 0xffffffff) >>> 0;
  for (let i = 0; i < dados.length; i++) c = tabela[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const CABECALHO_STL = "Conversor 3D | mm | Z-up";

/** STL binário de uma sopa (9 números por triângulo): 84 + 50 × triângulos bytes. */
export function gravarStl(sopa: Float32Array): Uint8Array {
  const n = Math.floor(sopa.length / 9);
  const arquivo = new Uint8Array(84 + 50 * n);
  arquivo.fill(0x20, 0, 80);
  arquivo.set(new TextEncoder().encode(CABECALHO_STL), 0);
  const d = new DataView(arquivo.buffer);
  d.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const p = t * 9;
    const ux = sopa[p + 3] - sopa[p], uy = sopa[p + 4] - sopa[p + 1], uz = sopa[p + 5] - sopa[p + 2];
    const vx = sopa[p + 6] - sopa[p], vy = sopa[p + 7] - sopa[p + 1], vz = sopa[p + 8] - sopa[p + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    const o = 84 + t * 50;
    d.setFloat32(o, nx / m, true);
    d.setFloat32(o + 4, ny / m, true);
    d.setFloat32(o + 8, nz / m, true);
    for (let e = 0; e < 9; e++) d.setFloat32(o + 12 + e * 4, sopa[p + e], true);
  }
  return arquivo;
}

/* ── ZIP ──────────────────────────────────────────────────────────────── */

interface EntradaPronta {
  nome: Uint8Array;
  crc: number;
  tamanho: number;
  /** o conteúdo como vai no arquivo (comprimido ou não) */
  dados: Uint8Array;
  metodo: 0 | 8;
}

const DATA_DOS = (0 << 9) | (1 << 5) | 1;

function montarZip(entradas: EntradaPronta[]): Uint8Array {
  if (entradas.length > 0xffff) throw new Error("Arquivos demais para um ZIP só.");
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const local = new Uint8Array(30 + e.nome.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);                 // nome em UTF-8
    l.setUint16(8, e.metodo, true);
    l.setUint16(12, DATA_DOS, true);
    l.setUint32(14, e.crc, true);
    l.setUint32(18, e.dados.length, true);
    l.setUint32(22, e.tamanho, true);
    l.setUint16(26, e.nome.length, true);
    local.set(e.nome, 30);
    const central = new Uint8Array(46 + e.nome.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, e.metodo, true);
    c.setUint16(14, DATA_DOS, true);
    c.setUint32(16, e.crc, true);
    c.setUint32(20, e.dados.length, true);
    c.setUint32(24, e.tamanho, true);
    c.setUint16(28, e.nome.length, true);
    c.setUint32(42, deslocamento, true);
    central.set(e.nome, 46);
    locais.push(local, e.dados);
    centrais.push(central);
    deslocamento += local.length + e.dados.length;
    if (deslocamento > 0xffffffff) throw new Error("O conjunto passa de 4 GB: baixe um arquivo de cada vez.");
  }
  const tamanhoCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, entradas.length, true);
  f.setUint16(10, entradas.length, true);
  f.setUint32(12, tamanhoCentral, true);
  f.setUint32(16, deslocamento, true);
  const partes = [...locais, ...centrais, fim];
  const zip = new Uint8Array(partes.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const b of partes) { zip.set(b, o); o += b.length; }
  return zip;
}

/** ZIP sem compressão (os STL e 3MF já vêm prontos: comprimir de novo só gasta tempo). */
export function gravarZip(arquivos: readonly { nome: string; dados: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  return montarZip(arquivos.map((a) => ({ nome: enc.encode(a.nome), crc: crc32(a.dados), tamanho: a.dados.length, dados: a.dados, metodo: 0 })));
}

/** Comprime (deflate cru) pedaços de texto, com o CRC e o tamanho do original. */
async function comprimir(nome: string, pedacos: Iterable<string>): Promise<EntradaPronta> {
  const cs = new CompressionStream("deflate-raw");
  const escritor = cs.writable.getWriter();
  const saidas: Uint8Array[] = [];
  const leitura = (async () => {
    const leitor = cs.readable.getReader();
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      saidas.push(value);
    }
  })();
  const enc = new TextEncoder();
  let crc = 0;
  let tamanho = 0;
  for (const s of pedacos) {
    const b = enc.encode(s);
    crc = crc32(b, crc);
    tamanho += b.length;
    await escritor.write(b);
  }
  await escritor.close();
  await leitura;
  const dados = new Uint8Array(saidas.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const b of saidas) { dados.set(b, o); o += b.length; }
  return { nome: enc.encode(nome), crc, tamanho, dados, metodo: 8 };
}

/* ── 3MF ──────────────────────────────────────────────────────────────── */

const TIPOS = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELACOES = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O centro da mesa onde o item é posto (mm): o fatiador o recentraliza na mesa dele de qualquer jeito. */
const CENTRO = 128;

/* 9 algarismos significativos devolvem exatamente o mesmo float32: o 3MF guarda
   a coordenada com a precisão inteira do arquivo, sem arredondar a peça */
const num = (v: number) => String(+v.toPrecision(9));

/* o XML sai aos pedaços: 1 milhão de triângulos são ~70 MB de texto */
function* modelo(p: Float32Array, t: Uint32Array, titulo: string): Generator<string> {
  yield `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xml(titulo)}</metadata>
<metadata name="Application">Conversor 3D</metadata>
<resources>
<object id="1" type="model" name="${xml(titulo)}">
<mesh>
<vertices>
`;
  const LOTE = 20000;
  const nv = p.length / 3;
  for (let i = 0; i < nv; i += LOTE) {
    let s = "";
    for (let v = i; v < Math.min(nv, i + LOTE); v++) s += `<vertex x="${num(p[v * 3])}" y="${num(p[v * 3 + 1])}" z="${num(p[v * 3 + 2])}"/>\n`;
    yield s;
  }
  yield "</vertices>\n<triangles>\n";
  const nt = t.length / 3;
  for (let i = 0; i < nt; i += LOTE) {
    let s = "";
    for (let k = i; k < Math.min(nt, i + LOTE); k++) s += `<triangle v1="${t[k * 3]}" v2="${t[k * 3 + 1]}" v3="${t[k * 3 + 2]}"/>\n`;
    yield s;
  }
  yield `</triangles>
</mesh>
</object>
</resources>
<build>
<item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${CENTRO} ${CENTRO} 0"/>
</build>
</model>`;
}

/** O 3MF (um ZIP com o modelo em XML, unidade milímetro) de uma malha indexada. */
export async function gravar3mf(posicoes: Float32Array, indices: Uint32Array, titulo: string): Promise<Uint8Array> {
  return montarZip([
    await comprimir("[Content_Types].xml", [TIPOS]),
    await comprimir("_rels/.rels", [RELACOES]),
    await comprimir("3D/3dmodel.model", modelo(posicoes, indices, titulo)),
  ]);
}
