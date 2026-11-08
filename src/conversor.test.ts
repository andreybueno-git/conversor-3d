import { inflateRawSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ACEITA, FORMATOS, SEM_LEITOR, extensao, formatarBytes, formatarInteiro, formatarMm, formatoDe, nomeDeSaida, nomesUnicos,
} from "./formatos";
import { converter } from "./gravar";
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
    expect(formatoDe("casa.skp")).toBeNull();
  });

  it("toda extensão aparece uma vez, e o campo de arquivo aceita todas", () => {
    const exts = FORMATOS.map((f) => f.ext);
    expect(new Set(exts).size).toBe(exts.length);
    for (const e of exts) expect(ACEITA.split(",")).toContain(`.${e}`);
    expect(ACEITA).toContain(".bin");
  });

  it("o SketchUp tem o caminho escrito, não um 'formato inválido'", () => {
    expect(SEM_LEITOR.skp).toMatch(/Exportar/);
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
