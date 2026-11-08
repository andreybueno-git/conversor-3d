/* O glTF ANTES DO LEITOR: todo .gltf e todo .glb vira um GLB de um buffer só,
   sem material, sem textura e sem imagem. TS puro (o vitest confere).

   Por quê: o leitor do three busca buffer e imagem por endereço (fetch, <img>),
   e uma CSP fechada (a de quem hospedar a página) pode barrar `blob:` e `data:`. Montando o
   GLB aqui, o leitor recebe tudo num ArrayBuffer e não busca nada. O .bin que
   a pessoa soltou junto entra pelo nome; o embutido em `data:` é decodificado
   aqui. Material e textura não importam para STL e 3MF (só a forma).

   Malha comprimida (Draco, meshopt) precisa de WebAssembly, que esta rota não
   compila: a tela diz o que fazer em vez de falhar calada. */

const MAGICO = 0x46546c67;          // "glTF"
const PEDACO_JSON = 0x4e4f534a;
const PEDACO_BIN = 0x004e4942;

export class ErroDoGltf extends Error {}

const COMPRIMIDOS: Record<string, string> = {
  KHR_draco_mesh_compression: "Draco",
  EXT_meshopt_compression: "meshopt",
  KHR_meshopt_compression: "meshopt",
};

/* o que só serve à aparência: some junto com os materiais */
const DE_APARENCIA = /^(KHR_materials_|KHR_texture_|EXT_texture_|MSFT_texture_|KHR_lights_)/;

interface JsonGltf {
  asset?: { version?: string };
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  meshes?: { primitives?: Record<string, unknown>[] }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [chave: string]: unknown;
}

/** O GLB aberto: o JSON e o pedaço binário (se houver). */
export function lerGlb(dados: Uint8Array): { json: JsonGltf; bin: Uint8Array | null } {
  const d = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  if (dados.length < 20 || d.getUint32(0, true) !== MAGICO) throw new ErroDoGltf("Este .glb não começa como um glTF binário.");
  if (d.getUint32(4, true) !== 2) throw new ErroDoGltf("Só o glTF 2.0 é aceito (este é de uma versão antiga).");
  const total = Math.min(d.getUint32(8, true), dados.length);
  let o = 12;
  let json: JsonGltf | null = null;
  let bin: Uint8Array | null = null;
  while (o + 8 <= total) {
    const tamanho = d.getUint32(o, true);
    const tipo = d.getUint32(o + 4, true);
    const corpo = dados.subarray(o + 8, o + 8 + tamanho);
    if (tipo === PEDACO_JSON) json = JSON.parse(new TextDecoder().decode(corpo)) as JsonGltf;
    else if (tipo === PEDACO_BIN && !bin) bin = corpo;
    o += 8 + tamanho;
  }
  if (!json) throw new ErroDoGltf("Este .glb não tem a parte que descreve o modelo.");
  return { json, bin };
}

function decodificarDataUri(uri: string): Uint8Array {
  const virgula = uri.indexOf(",");
  const cabeca = uri.slice(5, virgula);
  const corpo = uri.slice(virgula + 1);
  if (/;base64$/i.test(cabeca)) {
    const texto = atob(corpo);
    const b = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i);
    return b;
  }
  return new TextEncoder().encode(decodeURIComponent(corpo));
}

/** "pasta/Meu%20modelo.bin" → "meu modelo.bin" (a pessoa soltou o arquivo, não a pasta). */
export function nomeDoUri(uri: string): string {
  let n = uri.split(/[?#]/)[0];
  try { n = decodeURIComponent(n); } catch { /* fica como veio */ }
  return n.split(/[\\/]/).pop()!.toLowerCase();
}

/**
 * O GLB "só forma". `principal` é o .glb ou o .gltf; `companheiros` são os
 * arquivos soltos junto, pelo nome em minúsculas.
 */
export function normalizarGltf(
  principal: Uint8Array, ehBinario: boolean, companheiros: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  let json: JsonGltf;
  let binDoGlb: Uint8Array | null = null;
  if (ehBinario) ({ json, bin: binDoGlb } = lerGlb(principal));
  else {
    try { json = JSON.parse(new TextDecoder().decode(principal)) as JsonGltf; } catch {
      throw new ErroDoGltf("Este .gltf não é um JSON válido.");
    }
  }
  if (!json.asset?.version?.startsWith("2")) throw new ErroDoGltf("Só o glTF 2.0 é aceito (este é de uma versão antiga).");

  const usados = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  const comprimido = usados.find((e) => COMPRIMIDOS[e]);
  if (comprimido) {
    throw new ErroDoGltf(`Este modelo vem comprimido com ${COMPRIMIDOS[comprimido]}, que esta página não abre. Exporte de novo sem compressão (no Blender: desmarque "Compression") ou envie em OBJ ou STL.`);
  }

  /* os buffers, todos num só, cada um alinhado em 4 bytes */
  const buffers = json.buffers ?? [];
  const partes: Uint8Array[] = [];
  const inicio: number[] = [];
  let tamanho = 0;
  buffers.forEach((b, i) => {
    let bytes: Uint8Array | undefined;
    if (b.uri === undefined) {
      if (i !== 0 || !binDoGlb) throw new ErroDoGltf("O modelo aponta para dados que não estão no arquivo.");
      bytes = binDoGlb;
    } else if (b.uri.startsWith("data:")) {
      bytes = decodificarDataUri(b.uri);
    } else {
      bytes = companheiros.get(nomeDoUri(b.uri));
      if (!bytes) {
        throw new ErroDoGltf(`Falta o arquivo "${nomeDoUri(b.uri)}". Solte o .gltf junto com ele (selecione os dois de uma vez).`);
      }
    }
    if (bytes.length < b.byteLength) throw new ErroDoGltf("Um dos arquivos de dados do modelo está cortado.");
    inicio.push(tamanho);
    partes.push(bytes.subarray(0, b.byteLength));
    tamanho += Math.ceil(b.byteLength / 4) * 4;
  });

  for (const v of json.bufferViews ?? []) {
    v.byteOffset = (v.byteOffset ?? 0) + (inicio[v.buffer] ?? 0);
    v.buffer = 0;
  }
  json.buffers = tamanho ? [{ byteLength: tamanho }] : [];

  /* só a forma: sem material, textura e imagem (nada para o leitor buscar) */
  delete json.materials;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  for (const m of json.meshes ?? []) for (const p of m.primitives ?? []) delete p.material;
  const fica = (e: string) => !DE_APARENCIA.test(e);
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter(fica);
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter(fica);

  return montarGlb(json, partes, tamanho);
}

function montarGlb(json: JsonGltf, partes: Uint8Array[], tamanhoBin: number): Uint8Array {
  const texto = new TextEncoder().encode(JSON.stringify(json));
  const tamanhoJson = Math.ceil(texto.length / 4) * 4;
  const total = 12 + 8 + tamanhoJson + (tamanhoBin ? 8 + tamanhoBin : 0);
  const glb = new Uint8Array(total);
  const d = new DataView(glb.buffer);
  d.setUint32(0, MAGICO, true);
  d.setUint32(4, 2, true);
  d.setUint32(8, total, true);
  d.setUint32(12, tamanhoJson, true);
  d.setUint32(16, PEDACO_JSON, true);
  glb.set(texto, 20);
  glb.fill(0x20, 20 + texto.length, 20 + tamanhoJson);          // o JSON se completa com espaço
  if (tamanhoBin) {
    let o = 20 + tamanhoJson;
    d.setUint32(o, tamanhoBin, true);
    d.setUint32(o + 4, PEDACO_BIN, true);
    o += 8;
    let deslocamento = 0;
    for (const p of partes) {
      glb.set(p, o + deslocamento);
      deslocamento += Math.ceil(p.length / 4) * 4;          // o resto do alinhamento fica em zero
    }
  }
  return glb;
}
