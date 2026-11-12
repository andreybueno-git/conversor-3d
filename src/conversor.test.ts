import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ACEITA, FORMATOS, LIMIAR_MODO_PESADO, SEM_LEITOR, SKP_PLANO_B, extensao, formatarBytes, formatarInteiro, formatarMm, formatoDe, modoPesado,
  nomeDeSaida, nomesUnicos, textoDoAndamento,
} from "./formatos";
import { faltouMemoria, pesadoDemais } from "./erros";
import { lerSkp } from "./skp";
import { converter, gravarStlEmPartes } from "./gravar";
import { ErroDoGltf, lerGlb, nomeDoUri, normalizarGltf } from "./gltf";
import { deObjeto, ErroDeLeitura, lerModelo } from "./ler";
import {
  SEM_GIRO, Y_PARA_Z, caixaDe, girar, limparSopa, medidasDe, medidasNaMesa, multiplicar, prepararParaMesa, soldar, unidadeProvavel,
} from "./malha";
import { lerOff } from "./off";

/* O CONVERSOR : os formatos, a malha (giro,
   escala, mesa, solda), o glTF montado sem buscar nada, o OFF, e a volta
   inteira — ler um arquivo e gravar o STL e o 3MF — nos formatos que o three
   lê sem DOM. Os que precisam de DOMParser (DAE, 3MF, AMF, KMZ) e a tela
   ficam no e2e (e2e/conversor.spec.ts), num navegador de verdade. */


/** Lê um STL binário de volta (cabeçalho, contagem e posições). */
function lerStl(a: Uint8Array) {
  const d = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const n = d.getUint32(80, true);
  expect(a.length).toBe(84 + 50 * n);
  const posicoes = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) for (let e = 0; e < 9; e++) posicoes[t * 9 + e] = d.getFloat32(84 + t * 50 + 12 + e * 4, true);
  return { cabecalho: new TextDecoder().decode(a.subarray(0, 80)).trimEnd(), posicoes };
}

/** Os nomes de um ZIP, pelo diretório central. */
function lerZip(z: Uint8Array): Map<string, number> {
  const d = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let fim = z.length - 22;
  while (d.getUint32(fim, true) !== 0x06054b50) fim--;
  let o = d.getUint32(fim + 16, true);
  const saida = new Map<string, number>();
  for (let i = 0; i < d.getUint16(fim + 10, true); i++) {
    const n = d.getUint16(o + 28, true), extra = d.getUint16(o + 30, true), coment = d.getUint16(o + 32, true);
    saida.set(new TextDecoder().decode(z.subarray(o + 46, o + 46 + n)), d.getUint32(o + 24, true));
    o += 46 + n + extra + coment;
  }
  return saida;
}

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const enc = (s: string) => buf(new TextEncoder().encode(s));

/** Um cubo de 2 de lado, de −1 a 1, como sopa. */
function cubo(): Float32Array {
  return deObjeto(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))).sopa;
}

describe("formatos", () => {
  it("acha o formato pela extensão, sem olhar maiúscula", () => {
    expect(extensao("Peça.Final.STL")).toBe("stl");
    expect(extensao(".bashrc")).toBe("");
    expect(extensao("semponto")).toBe("");
    expect(formatoDe("casa.DAE")?.nome).toBe("DAE");
    expect(formatoDe("casa.SKP")?.unidade).toBe("m");                 // o .skp entra (OpenSKP), em metros e Y para cima
    expect(formatoDe("casa.step")).toBeNull();
  });

  it("toda extensão aparece uma vez, e o campo de arquivo aceita todas", () => {
    const exts = FORMATOS.map((f) => f.ext);
    expect(new Set(exts).size).toBe(exts.length);
    for (const e of exts) expect(ACEITA.split(",")).toContain(`.${e}`);
    expect(ACEITA).toContain(".bin");
  });

  it("o .skp que não abrir tem o plano B escrito; o STEP tem o caminho do CAD", () => {
    expect(SKP_PLANO_B).toMatch(/Exportar, não Baixar/);
    expect(SEM_LEITOR.step).toMatch(/STL ou 3MF/);
    expect(SEM_LEITOR.skp).toBeUndefined();
  });

  it("o nome de saída só tem o que qualquer disco (e o ZIP) aceita", () => {
    expect(nomeDeSaida("Minha peça (v2).obj", "stl")).toBe("Minha-peca-v2.stl");
    expect(nomeDeSaida("..obj", "3mf")).toBe("modelo.3mf");
    expect(nomeDeSaida("vaso", "3mf")).toBe("vaso.3mf");
    expect(nomeDeSaida("ação_final.glb", "stl")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("dois arquivos com o mesmo nome ganham número (o ZIP não aceita repetido)", () => {
    expect(nomesUnicos(["a.stl", "A.stl", "b.stl", "a.stl"])).toEqual(["a.stl", "A-2.stl", "b.stl", "a-3.stl"]);
  });

  it("formata para gente", () => {
    expect(formatarBytes(512)).toBe("512 B");
    expect(formatarBytes(2048)).toBe("2 KB");
    expect(formatarBytes(14.2 * 1024 * 1024)).toBe("14,2 MB");
    expect(formatarMm(120.4)).toBe("120 mm");
    expect(formatarMm(8.4)).toBe("8,4 mm");
    expect(formatarMm(20)).toBe("20 mm");
    expect(formatarMm(0.35)).toBe("0,35 mm");
    expect(formatarMm(1200)).toBe("1,2 m");
    expect(formatarInteiro(1204330)).toBe("1.204.330");
  });
});

describe("malha", () => {
  it("quatro giros de 90° voltam exatamente ao começo, em cada eixo", () => {
    for (const eixo of ["x", "y", "z"] as const) {
      let g = SEM_GIRO;
      for (let i = 0; i < 4; i++) g = girar(g, eixo);
      expect(g.map((n) => n + 0)).toEqual([...SEM_GIRO]);
    }
  });

  it("Y para cima vira Z para cima (o glTF deitado na mesa)", () => {
    const [x, y, z] = [0, 1, 0];
    const g = Y_PARA_Z;
    expect([g[0] * x + g[1] * y + g[2] * z, g[3] * x + g[4] * y + g[5] * z, g[6] * x + g[7] * y + g[8] * z]).toEqual([0, 0, 1]);
    expect(multiplicar(SEM_GIRO, g)).toEqual(g);
  });

  it("a mesa: mm, centro em X/Y, base em z = 0", () => {
    const s = cubo().map((v, i) => v + [10, 20, 30][i % 3]);
    const { posicoes, medidas } = prepararParaMesa(s, "cm", SEM_GIRO);
    expect(medidas).toEqual([20, 20, 20]);
    const c = caixaDe(posicoes);
    expect(c.min).toEqual([-10, -10, 0]);
    expect(c.max).toEqual([10, 10, 20]);
    expect(Array.from(posicoes).some((v) => Object.is(v, -0))).toBe(false);
  });

  it("o giro troca as medidas de lugar", () => {
    const s = deObjeto(new THREE.Mesh(new THREE.BoxGeometry(10, 40, 2))).sopa;
    expect(prepararParaMesa(s, "mm", SEM_GIRO).medidas).toEqual([10, 40, 2]);
    expect(prepararParaMesa(s, "mm", Y_PARA_Z).medidas).toEqual([10, 2, 40]);
  });

  it("as medidas da tela batem com as da malha girada, em qualquer giro", () => {
    const s = deObjeto(new THREE.Mesh(new THREE.BoxGeometry(10, 40, 2))).sopa;
    const bruto = medidasDe(caixaDe(s));
    let g = SEM_GIRO;
    for (const eixo of ["x", "z", "y", "x", "y"] as const) {
      g = girar(g, eixo);
      expect(medidasNaMesa(bruto, "pol", g)).toEqual(prepararParaMesa(s, "pol", g).medidas.map((m) => expect.closeTo(m, 4)));
    }
  });

  it("um grão de 0,2 mm é, quase sempre, uma peça em metros", () => {
    expect(unidadeProvavel(0.2, "mm")).toBe("m");
    expect(unidadeProvavel(1.5, "mm")).toBe("cm");
    expect(unidadeProvavel(80, "mm")).toBe("mm");
    expect(unidadeProvavel(0.08, "m")).toBe("m");
    expect(unidadeProvavel(0, "mm")).toBe("mm");
  });

  it("a solda: o cubo tem 8 vértices e 12 faces; face sem área sai", () => {
    const s = soldar(cubo());
    expect(s.posicoes.length / 3).toBe(8);
    expect(s.indices.length / 3).toBe(12);
    const degenerado = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0]);
    expect(soldar(degenerado).indices.length).toBe(0);
  });

  it("triângulo com NaN sai da sopa (estragaria a caixa e o fatiador)", () => {
    const s = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, NaN, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(limparSopa(s).length).toBe(9);
    expect(medidasDe(caixaDe(limparSopa(s)))).toEqual([1, 1, 0]);
  });
});

describe("OFF", () => {
  const CUBO = `OFF
# um cubo
8 6 12
-1 -1 -1
1 -1 -1
1 1 -1
-1 1 -1
-1 -1 1
1 -1 1
1 1 1
-1 1 1
4 0 3 2 1
4 4 5 6 7
4 0 1 5 4 255 0 0
4 2 3 7 6
4 1 2 6 5
4 0 4 7 3
`;
  it("lê um cubo de quadrados (cada quadrado vira 2 triângulos), ignorando a cor da face", () => {
    const s = lerOff(CUBO);
    expect(s.length / 9).toBe(12);
    expect(medidasDe(caixaDe(s))).toEqual([2, 2, 2]);
  });
  it("contagens na mesma linha do cabeçalho", () => {
    expect(lerOff("OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n").length).toBe(9);
  });
  it("recusa o que não é OFF, o cortado e o índice fora", () => {
    expect(() => lerOff("solid x")).toThrow(/cabeçalho/);
    expect(() => lerOff("OFF\n3 1 0\n0 0 0\n")).toThrow(/cortado/);
    expect(() => lerOff("OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 7\n")).toThrow(/não existe/);
  });
});

/* um triângulo em glTF: 3 posições float32 (36 bytes) */
function triangulo(): Uint8Array {
  return new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
}
function gltfDeUmTriangulo(uri?: string, extras: Record<string, unknown> = {}) {
  return {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }], scene: 0,
    nodes: [{ mesh: 0, translation: [0, 0, 5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: "textura.png" }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36, ...(uri !== undefined ? { uri } : {}) }],
    extensionsUsed: ["KHR_materials_unlit"],
    ...extras,
  };
}

describe("glTF sem buscar nada", () => {
  it("o .bin solto junto entra pelo nome; material, textura e imagem saem", () => {
    const json = enc(JSON.stringify(gltfDeUmTriangulo("pasta/Meu%20modelo.bin")));
    const glb = normalizarGltf(new Uint8Array(json), false, new Map([["meu modelo.bin", triangulo()]]));
    const { json: j, bin } = lerGlb(glb);
    expect(j.materials).toBeUndefined();
    expect(j.images).toBeUndefined();
    expect(j.extensionsUsed).toEqual([]);
    expect(j.buffers).toEqual([{ byteLength: 36 }]);
    expect(new Float32Array(buf(bin!.slice(0, 36)))).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(glb.length % 4).toBe(0);
  });

  it("buffer embutido em data: (base64) é decodificado aqui", () => {
    const b64 = Buffer.from(triangulo()).toString("base64");
    const glb = normalizarGltf(new Uint8Array(enc(JSON.stringify(gltfDeUmTriangulo(`data:application/octet-stream;base64,${b64}`)))), false, new Map());
    expect(lerGlb(glb).bin!.length).toBe(36);
  });

  it("dois buffers viram um, e as vistas apontam para o lugar certo", () => {
    const g = gltfDeUmTriangulo("a.bin", {
      buffers: [{ byteLength: 6, uri: "a.bin" }, { byteLength: 36, uri: "b.bin" }],
      bufferViews: [{ buffer: 1, byteLength: 36 }],
    });
    const glb = normalizarGltf(new Uint8Array(enc(JSON.stringify(g))), false, new Map([["a.bin", new Uint8Array(6)], ["b.bin", triangulo()]]));
    const { json, bin } = lerGlb(glb);
    expect(json.bufferViews).toEqual([{ buffer: 0, byteOffset: 8, byteLength: 36 }]);
    expect(new Float32Array(buf(bin!.slice(8, 44)))[3]).toBe(1);
  });

  it("diz o que falta e o que não abre", () => {
    const sem = new Uint8Array(enc(JSON.stringify(gltfDeUmTriangulo("modelo.bin"))));
    expect(() => normalizarGltf(sem, false, new Map())).toThrow(/Falta o arquivo "modelo.bin"/);
    const draco = new Uint8Array(enc(JSON.stringify(gltfDeUmTriangulo("m.bin", { extensionsRequired: ["KHR_draco_mesh_compression"] }))));
    expect(() => normalizarGltf(draco, false, new Map())).toThrow(ErroDoGltf);
    expect(() => normalizarGltf(new Uint8Array([1, 2, 3]), true, new Map())).toThrow(/glTF binário/);
    expect(nomeDoUri("..\\x\\Y.BIN?v=1")).toBe("y.bin");
  });
});

describe("a volta inteira: ler e gravar", () => {
  it("glTF: lido sem rede, com a posição do nó; vira STL do tamanho certo", async () => {
    const b64 = Buffer.from(triangulo()).toString("base64");
    const gltf = { nome: "tri.gltf", dados: enc(JSON.stringify(gltfDeUmTriangulo(`data:application/octet-stream;base64,${b64}`))) };
    const lido = await lerModelo(gltf, []);
    expect(lido.partes).toBe(1);
    expect(lido.sopa.length).toBe(9);
    expect(lido.sopa[2]).toBe(5);                         // o translation do nó entrou
  });

  it("OBJ (Y para cima) e o cubo em 3MF: um objeto, 8 vértices, 12 faces, em milímetro", async () => {
    const obj = `v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1
f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 3 4 8 7\nf 2 3 7 6\nf 1 5 8 4\nl 1 7\n`;
    const lido = await lerModelo({ nome: "cubo.obj", dados: enc(obj) }, []);
    expect(lido.sopa.length / 9).toBe(12);                // a linha "l" não entra
    const r = await converter(lido.sopa, { unidade: "cm", giro: Y_PARA_Z, saida: "3mf", titulo: "cubo" });
    expect(r.medidas).toEqual([20, 20, 20]);
    expect(r.triangulos).toBe(12);
    /* o 3MF é um ZIP comprimido (deflate cru): o diretório central diz onde cada arquivo começa */
    const z = r.bytes;
    const d = new DataView(z.buffer, z.byteOffset, z.byteLength);
    let o = 0;
    const arquivos = new Map<string, string>();
    while (d.getUint32(o, true) === 0x04034b50) {
      const comprimido = d.getUint32(o + 18, true), n = d.getUint16(o + 26, true);
      const nome = new TextDecoder().decode(z.subarray(o + 30, o + 30 + n));
      arquivos.set(nome, inflateRawSync(z.subarray(o + 30 + n, o + 30 + n + comprimido)).toString("utf8"));
      o += 30 + n + comprimido;
    }
    expect([...arquivos.keys()].sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    const modelo = arquivos.get("3D/3dmodel.model")!;
    expect(modelo).toContain('unit="millimeter"');
    expect(modelo.match(/<vertex /g)).toHaveLength(8);
    expect(modelo.match(/<triangle /g)).toHaveLength(12);
  });

  it("STL binário → STL binário: mesma forma, tamanho 84 + 50 × triângulos, pousado em z = 0", async () => {
    const primeiro = await converter(cubo(), { unidade: "mm", giro: SEM_GIRO, saida: "stl", titulo: "cubo" });
    expect(primeiro.bytes.length).toBe(84 + 50 * 12);
    const lido = await lerModelo({ nome: "cubo.stl", dados: buf(primeiro.bytes) }, []);
    const de_novo = await converter(lido.sopa, { unidade: "mm", giro: SEM_GIRO, saida: "stl", titulo: "cubo" });
    const { posicoes, cabecalho } = lerStl(de_novo.bytes);
    expect(cabecalho).toMatch(/^Conversor 3D \| mm \| Z-up/);
    expect(caixaDe(posicoes).min[2]).toBe(0);
    expect(de_novo.medidas).toEqual([2, 2, 2]);
  });

  it("qualidade máxima: o STL leva todos os triângulos e o 3MF guarda cada coordenada exata (float32)", async () => {
    const sopa = deObjeto(new THREE.Mesh(new THREE.SphereGeometry(37.123456, 64, 48))).sopa;
    const entrada = sopa.length / 9;
    const stl = await converter(sopa, { unidade: "mm", giro: SEM_GIRO, saida: "stl", titulo: "esfera" });
    expect(stl.triangulos).toBe(entrada);
    const { posicoes } = lerStl(stl.bytes);
    expect(Array.from(posicoes)).toEqual(Array.from(prepararParaMesa(sopa, "mm", SEM_GIRO).posicoes));

    const tresmf = await converter(sopa, { unidade: "mm", giro: SEM_GIRO, saida: "3mf", titulo: "esfera" });
    const z = tresmf.bytes;
    const d = new DataView(z.buffer, z.byteOffset, z.byteLength);
    let o = 0, modelo = "";
    while (d.getUint32(o, true) === 0x04034b50) {
      const c = d.getUint32(o + 18, true), n = d.getUint16(o + 26, true);
      const nome = new TextDecoder().decode(z.subarray(o + 30, o + 30 + n));
      if (nome === "3D/3dmodel.model") modelo = inflateRawSync(z.subarray(o + 30 + n, o + 30 + n + c)).toString("utf8");
      o += 30 + n + c;
    }
    const lidos = [...modelo.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
    const soldado = soldar(prepararParaMesa(sopa, "mm", SEM_GIRO).posicoes);
    expect(Float32Array.from(lidos)).toEqual(soldado.posicoes);         // cada número volta ao mesmo float32
    expect(tresmf.triangulos).toBe(soldado.indices.length / 3);
  });

  it("STL em texto (ASCII) também entra", async () => {
    const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n`;
    const lido = await lerModelo({ nome: "t.stl", dados: enc(ascii) }, []);
    expect(lido.sopa.length).toBe(9);
  });

  it("PLY só de pontos é recusado com o porquê", async () => {
    const ply = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n";
    await expect(lerModelo({ nome: "nuvem.ply", dados: enc(ply) }, [])).rejects.toThrow(/nuvem de pontos/);
  });

  it("arquivo ilegível vira uma frase, não o erro do three", async () => {
    await expect(lerModelo({ nome: "x.fbx", dados: enc("isto não é fbx") }, [])).rejects.toBeInstanceOf(ErroDeLeitura);
    await expect(lerModelo({ nome: "x.obj", dados: enc("# vazio\n") }, [])).rejects.toThrow(/nenhuma superfície/);
  });

  it("o ZIP de vários convertidos abre (o 'baixar tudo')", async () => {
    const { gravarZip } = await import("./arquivos");
    const a = await converter(cubo(), { unidade: "mm", giro: SEM_GIRO, saida: "stl", titulo: "a" });
    const zip = gravarZip([{ nome: "a.stl", dados: a.bytes }, { nome: "a-2.stl", dados: a.bytes }]);
    expect([...lerZip(zip).keys()]).toEqual(["a.stl", "a-2.stl"]);
  });
});

describe("SketchUp (.skp)", () => {
  const ler = (nome: string) => {
    const b = readFileSync(new URL(`../e2e/skp/${nome}`, import.meta.url));
    return { nome, dados: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  };

  for (const nome of ["chair_and_table.skp", "nesting_2013.skp", "nesting_2021.skp", "capilla_quiroz_v17.skp", "arcs_2021.skp", "SU_File.skp"]) {
    it(`${nome}: vira STL com faces, uma vez cada (sem a cópia invertida), em pé na mesa`, async () => {
      const lido = await lerModelo(ler(nome), []);
      expect(lido.sopa.length / 9).toBeGreaterThan(0);
      const stl = await converter(lido.sopa, { unidade: "m", giro: Y_PARA_Z, saida: "stl", titulo: nome });
      expect(stl.bytes.length).toBe(84 + 50 * (lido.sopa.length / 9));
      expect(Math.min(...stl.medidas)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...stl.medidas)).toBeGreaterThan(1);              // nada de grão: as medidas são de peça

      /* cada triângulo uma vez: nenhum par de triângulos com os mesmos três cantos */
      const chaves = new Set<string>();
      let repetidos = 0;
      for (let t = 0; t < lido.sopa.length; t += 9) {
        const cantos = [0, 3, 6].map((k) => `${lido.sopa[t + k]},${lido.sopa[t + k + 1]},${lido.sopa[t + k + 2]}`).sort().join("|");
        if (chaves.has(cantos)) repetidos++;
        chaves.add(cantos);
      }
      expect(repetidos).toBe(0);
      /* o registro para quem ler a saída do teste: tamanho e quantidade de cada modelo */
      console.info(`${nome}: ${lido.sopa.length / 9} triângulos, ${stl.medidas.map((m) => m.toFixed(0)).join(" × ")} mm`);
    });
  }

  it("um .skp que não é .skp vira uma frase com o plano B, não o erro da biblioteca", async () => {
    await expect(lerModelo({ nome: "falso.skp", dados: enc("isto não é sketchup") }, [])).rejects.toThrow(/Exportar, não Baixar/);
  });
});

describe("modo pesado: o STL gravado em partes", () => {
  /** Junta as partes num arquivo só, para comparar com o caminho de sempre. */
  async function emPartes(sopa: Float32Array, unidade: "mm" | "cm" | "m" | "pol", giro: typeof SEM_GIRO, triangulosPorParte: number) {
    const partes: Uint8Array[] = [];
    const andamento: number[] = [];
    const r = await gravarStlEmPartes(sopa, { unidade, giro, triangulosPorParte, aoEntregar: (p) => partes.push(p), ceder: (f) => { andamento.push(f); } });
    const total = partes.reduce((s, p) => s + p.length, 0);
    const junto = new Uint8Array(total);
    let o = 0;
    for (const p of partes) { junto.set(p, o); o += p.length; }
    return { r, junto, partes, andamento };
  }

  /** Uma sopa "suja" de propósito: números quebrados, negativos, zeros (−0 incluso) e triângulos sem área. */
  function sopaDeTeste(n: number): Float32Array {
    const s = new Float32Array(n * 9);
    let x = 12345;
    const aleatorio = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 2 ** 32; };
    for (let i = 0; i < s.length; i++) s[i] = (aleatorio() - 0.37) * 1234.567;
    s[0] = -0; s[1] = 0; s[2] = -0;                       // −0 tem bits diferentes de 0
    s.copyWithin(9, 0, 3); s.copyWithin(12, 0, 3);        // um triângulo sem área (normal 0, 0, 0)
    return s;
  }

  const giros = { "sem giro": SEM_GIRO, "Y para Z": Y_PARA_Z, "Y para Z, girado em Z e em Y": girar(girar(Y_PARA_Z, "z"), "y") };
  for (const [nomeDoGiro, giro] of Object.entries(giros)) {
    for (const unidade of ["mm", "cm", "m", "pol"] as const) {
      it(`sai igual, byte a byte, ao STL de sempre (${nomeDoGiro}, ${unidade})`, async () => {
        const sopa = sopaDeTeste(1003);
        const sempre = await converter(sopa, { unidade, giro, saida: "stl", titulo: "x" });
        const { r, junto, partes } = await emPartes(sopa, unidade, giro, 97);
        expect(partes.length, "cabeçalho + 11 partes de até 97 triângulos").toBe(1 + Math.ceil(1003 / 97));
        expect(junto.length).toBe(sempre.bytes.length);
        expect(Buffer.from(junto).equals(Buffer.from(sempre.bytes)), "os mesmos bytes").toBe(true);
        expect(r.triangulos).toBe(1003);
        expect(r.bytes).toBe(sempre.bytes.length);
        expect(r.medidas).toEqual(sempre.medidas);
      });
    }
  }

  it("um .skp de verdade também sai igual, e o andamento vai até 1 sem voltar", async () => {
    const b = readFileSync(new URL("../e2e/skp/chair_and_table.skp", import.meta.url));
    const lido = await lerModelo({ nome: "chair_and_table.skp", dados: buf(b) }, []);
    const sempre = await converter(lido.sopa, { unidade: "cm", giro: girar(Y_PARA_Z, "x"), saida: "stl", titulo: "x" });
    const { junto, andamento } = await emPartes(lido.sopa, "cm", girar(Y_PARA_Z, "x"), 1000);
    expect(Buffer.from(junto).equals(Buffer.from(sempre.bytes))).toBe(true);
    expect(andamento.at(-1)).toBe(1);
    expect(andamento.every((f, i) => i === 0 || f > andamento[i - 1])).toBe(true);
  });

  it("parte maior que a malha inteira: o cabeçalho e uma parte só", async () => {
    const sopa = cubo();
    const sempre = await converter(sopa, { unidade: "mm", giro: SEM_GIRO, saida: "stl", titulo: "x" });
    const { junto, partes } = await emPartes(sopa, "mm", SEM_GIRO, 1_000_000);
    expect(partes.map((p) => p.length)).toEqual([84, 50 * 12]);
    expect(Buffer.from(junto).equals(Buffer.from(sempre.bytes))).toBe(true);
  });
});

describe("memória que acaba x arquivo ilegível", () => {
  it("reconhece a falta de memória do Chrome, do Safari e do Firefox", () => {
    expect(faltouMemoria(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(faltouMemoria(new RangeError("Invalid typed array length: 4294967296"))).toBe(true);
    expect(faltouMemoria(new RangeError("Out of memory"))).toBe(true);
    expect(faltouMemoria({ name: "InternalError", message: "allocation size overflow" })).toBe(true);
    expect(faltouMemoria(new Error("out of memory"))).toBe(true);
  });

  it("não confunde com erro de leitura de verdade", () => {
    expect(faltouMemoria(new RangeError("Maximum call stack size exceeded"))).toBe(false);
    expect(faltouMemoria(new RangeError("Offset is outside the bounds of the DataView"))).toBe(false);
    expect(faltouMemoria(new Error("Unsupported SketchUp version"))).toBe(false);
    expect(faltouMemoria("Array buffer allocation failed")).toBe(false);   // texto solto não é erro
    expect(faltouMemoria(null)).toBe(false);
    /* comprimento negativo ou pequeno é número lixo de arquivo corrompido, não memória */
    expect(faltouMemoria(new RangeError("Invalid typed array length: -3"))).toBe(false);
    expect(faltouMemoria(new RangeError("Invalid typed array length: 12"))).toBe(false);
    expect(faltouMemoria(new RangeError("Invalid array buffer length"))).toBe(false);
  });

  it("a falta de memória embrulhada pela OpenSKP (SkpParseError com cause) ainda conta", () => {
    const embrulhado = Object.assign(new Error("legacy .skp parse failed: Array buffer allocation failed", { cause: new RangeError("Array buffer allocation failed") }), { name: "SkpParseError" });
    expect(faltouMemoria(embrulhado)).toBe(true);
    const soNaCausa = Object.assign(new Error("tlv walk failed", { cause: new Error("x", { cause: new RangeError("Array buffer allocation failed") }) }), { name: "SkpParseError" });
    expect(faltouMemoria(soNaCausa)).toBe(true);
    const ciclo: { name: string; message: string; cause?: unknown } = { name: "Error", message: "a" };
    ciclo.cause = ciclo;
    expect(faltouMemoria(ciclo)).toBe(false);                               // cadeia em círculo não trava
  });

  it("a frase de memória diz 'pesado demais' e, no .skp, traz o plano B", () => {
    expect(pesadoDemais("skp")).toMatch(/pesado demais para este navegador/);
    expect(pesadoDemais("skp")).toContain(SKP_PLANO_B);
    expect(pesadoDemais("obj")).not.toContain("SketchUp");
    expect(pesadoDemais("skp")).not.toMatch(/danificado/);
  });

  it("a memória que acaba DENTRO da OpenSKP também vira 'pesado demais'", async () => {
    /* a OpenSKP pega o RangeError e o embrulha num SkpParseError (cause = o RangeError) */
    const b = readFileSync(new URL("../e2e/skp/chair_and_table.skp", import.meta.url));
    for (const nome of ["Uint32Array", "Float64Array"] as const) {
      const original = globalThis[nome];
      let grandes = 0;
      const Falha = new Proxy(original, {
        construct(alvo, args) {
          if (typeof args[0] === "number" && args[0] > 64 && ++grandes === 4) throw new RangeError("Array buffer allocation failed");
          return Reflect.construct(alvo, args);
        },
      });
      (globalThis as Record<string, unknown>)[nome] = Falha;
      let erro: unknown;
      try { lerSkp(buf(b)); } catch (e) { erro = e; } finally { (globalThis as Record<string, unknown>)[nome] = original; }
      expect(grandes, `${nome}: a falha aconteceu dentro da leitura`).toBeGreaterThanOrEqual(4);
      expect((erro as Error)?.message, nome).toMatch(/pesado demais para este navegador/);
    }
  });

  it("o .skp que a memória não aguenta vira 'pesado demais', não 'arquivo danificado'", async () => {
    const original = Float32Array;
    /* simula a aba sem memória: o primeiro Float32Array grande falha como no Chrome */
    const Falha = new Proxy(original, {
      construct(alvo, args) {
        if (typeof args[0] === "number" && args[0] > 1000) throw new RangeError("Array buffer allocation failed");
        return Reflect.construct(alvo, args);
      },
    });
    const b = readFileSync(new URL("../e2e/skp/chair_and_table.skp", import.meta.url));
    globalThis.Float32Array = Falha;
    try {
      await expect(lerModelo({ nome: "x.skp", dados: buf(b) }, [])).rejects.toThrow(/pesado demais para este navegador/);
    } finally {
      globalThis.Float32Array = original;
    }
  });
});

describe("o andamento da leitura do .skp", () => {
  it("diz o que a OpenSKP informa, em português", () => {
    expect(textoDoAndamento({ etapa: "tlv_walk", feito: 501, total: 1000 })).toBe("Lendo o arquivo: 50%");
    expect(textoDoAndamento({ etapa: "tlv_walk", feito: 5, total: 0 })).toBe("Lendo o arquivo: 0%");
    expect(textoDoAndamento({ etapa: "build_scene", feito: 60500, total: 60500 })).toBe("Montando o modelo: 60.500 peças");
    expect(textoDoAndamento({ etapa: "legacy_defs", feito: 1500, total: 1500 })).toBe("Lendo os componentes: 1.500");
    expect(textoDoAndamento({ etapa: "triangulos", feito: 0, total: 6190607 })).toBe("Juntando os 6.190.607 triângulos");
    expect(textoDoAndamento({ etapa: "outra", feito: 1, total: 1 })).toBe("Lendo…");
  });

  it("o leitor do .skp manda o andamento de verdade (e termina juntando os triângulos)", () => {
    const b = readFileSync(new URL("../e2e/skp/nesting_2021.skp", import.meta.url));
    const etapas: string[] = [];
    const lido = lerSkp(buf(b), { onProgress: (p) => etapas.push(p.stage) });
    expect(etapas[0], "o passeio pelos registros, que a OpenSKP informa").toBe("tlv_walk");
    expect(etapas.at(-1)).toBe("triangulos");
    expect(lido.sopa.length % 9).toBe(0);
  });

  it("o modo pesado começa DEPOIS do limiar: exatamente no limiar ainda é o caminho de sempre", () => {
    expect(modoPesado(LIMIAR_MODO_PESADO)).toBe(false);
    expect(modoPesado(LIMIAR_MODO_PESADO + 1)).toBe(true);
  });
});
