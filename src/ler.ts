import * as THREE from "three";
import { ErroDeLeitura, faltouMemoria, pesadoDemais } from "./erros";
import { extensao } from "./formatos";
import { ErroDoGltf, normalizarGltf } from "./gltf";
import { limparSopa } from "./malha";
import { lerOff } from "./off";
import type { Lido } from "./skp";

/* OS LEITORES DO CONVERSOR — o módulo que leva o three ao navegador, e só
   depois que a pessoa solta um arquivo (`import()`). Cada formato
   carrega o SEU leitor, também por `import()`: quem converte um STL não baixa
   o leitor do FBX.

   Daqui sai a SOPA (9 números por triângulo), com a posição de cada objeto
   do arquivo já aplicada, na unidade e no "para cima" do arquivo. Linhas e
   pontos ficam de fora: não se imprimem.

   NADA SE BUSCA PELA REDE: material e textura não importam para STL e 3MF, e
   os leitores do three tentam baixar as imagens por endereço (uma CSP fechada
   barra `blob:` e `data:` em img-src). Durante a leitura, o
   carregador de textura do three devolve uma textura vazia sem buscar nada. */

export { ErroDeLeitura };
export type { Lido };

type ArquivoSolto = { nome: string; dados: ArrayBuffer };

const texto = (b: ArrayBuffer) => new TextDecoder().decode(b);

/** Lê o arquivo principal; `companheiros` são os outros soltos junto (o .bin do glTF). */
export async function lerModelo(arquivo: ArquivoSolto, companheiros: readonly ArquivoSolto[]): Promise<Lido> {
  const ext = extensao(arquivo.nome);
  const restaurar = silenciarTexturas();
  try {
    let lido: Lido;
    if (ext === "stl") {
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      lido = deGeometria(new STLLoader().parse(arquivo.dados));
    } else if (ext === "off") {
      try { lido = { sopa: lerOff(texto(arquivo.dados)), partes: 1 }; } catch (e) {
        throw new ErroDeLeitura(e instanceof Error ? e.message : "Este .off está ilegível.");
      }
    } else if (ext === "skp") {
      /* aqui só chega o .skp de quando o navegador não deixou criar o leitor em segundo plano */
      const { lerSkp } = await import("./skp");
      lido = lerSkp(arquivo.dados);
    } else if (ext === "ply") {
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      const g = new PLYLoader().parse(arquivo.dados);
      if (!g.index) throw new ErroDeLeitura("Este PLY é uma nuvem de pontos, sem faces: não há superfície para imprimir. Gere a malha antes (no MeshLab: Filters › Remeshing › Surface Reconstruction).");
      lido = deGeometria(g);
    } else {
      lido = deObjeto(await cena(ext, arquivo, companheiros));
    }
    const sopa = limparSopa(lido.sopa);
    if (!sopa.length) throw new ErroDeLeitura("Não achei nenhuma superfície neste arquivo (só linhas, pontos ou nada). Confira se o modelo tem faces.");
    return { sopa, partes: lido.partes };
  } catch (e) {
    if (e instanceof ErroDeLeitura) throw e;
    /* a memória acabou: o arquivo não está danificado, é grande demais para esta aba */
    if (faltouMemoria(e)) throw new ErroDeLeitura(pesadoDemais(ext));
    /* o erro do glTF já vem escrito para a pessoa; os do three, não */
    if (e instanceof ErroDoGltf) throw new ErroDeLeitura(e.message);
    throw new ErroDeLeitura("Não consegui ler este arquivo. Ele pode estar corrompido ou ter sido salvo numa variação que o leitor não conhece. Tente exportar de novo, de preferência em STL ou OBJ.");
  } finally {
    restaurar();
  }
}

async function cena(ext: string, a: ArquivoSolto, companheiros: readonly ArquivoSolto[]): Promise<THREE.Object3D> {
  switch (ext) {
    case "obj": {
      const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
      /* linha ("l") e ponto ("p") não se imprimem — e, no MESMO objeto das faces, o leitor do
         three transforma o objeto inteiro em linha: saem antes de ler */
      return new OBJLoader().parse(texto(a.dados).replace(/^[ \t]*[lp][ \t].*$/gm, ""));
    }
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const mapa = new Map(companheiros.map((c) => [c.nome.toLowerCase(), new Uint8Array(c.dados)]));
      const glb = normalizarGltf(new Uint8Array(a.dados), ext === "glb", mapa);
      const gltf = await new GLTFLoader().parseAsync(glb.buffer as ArrayBuffer, "");
      return gltf.scene;
    }
    case "fbx": {
      const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
      return new FBXLoader().parse(a.dados, "");
    }
    case "dae": {
      const { ColladaLoader } = await import("three/addons/loaders/ColladaLoader.js");
      const r = new ColladaLoader().parse(texto(a.dados), "");
      if (!r?.scene) throw new ErroDeLeitura("Este .dae não tem uma cena que eu consiga ler.");
      return r.scene;
    }
    case "kmz": {
      const { KMZLoader } = await import("three/addons/loaders/KMZLoader.js");
      const r = new KMZLoader().parse(a.dados);
      if (!r?.scene) throw new ErroDeLeitura("Este .kmz não traz um modelo 3D (só o mapa).");
      return r.scene;
    }
    case "3ds": {
      const { TDSLoader } = await import("three/addons/loaders/TDSLoader.js");
      return new TDSLoader().parse(a.dados, "");
    }
    case "3mf": {
      const { ThreeMFLoader } = await import("three/addons/loaders/3MFLoader.js");
      return new ThreeMFLoader().parse(a.dados);
    }
    case "amf": {
      const { AMFLoader } = await import("three/addons/loaders/AMFLoader.js");
      return new AMFLoader().parse(a.dados);
    }
    case "wrl": {
      const { VRMLLoader } = await import("three/addons/loaders/VRMLLoader.js");
      return new VRMLLoader().parse(texto(a.dados), "");
    }
    case "usdz": {
      const { USDLoader } = await import("three/addons/loaders/USDLoader.js");
      return new USDLoader().parse(a.dados);
    }
    default:
      throw new ErroDeLeitura("Este formato não está na lista dos que eu leio.");
  }
}

/** Troca, durante a leitura, o carregador de textura por um que não busca nada. */
function silenciarTexturas(): () => void {
  const alvos = [THREE.TextureLoader.prototype, THREE.DataTextureLoader.prototype] as unknown as { load: unknown }[];
  const originais = alvos.map((p) => p.load);
  for (const p of alvos) p.load = () => new THREE.Texture();
  return () => alvos.forEach((p, i) => { p.load = originais[i]; });
}

function deGeometria(g: THREE.BufferGeometry): Lido {
  const malha = new THREE.Mesh(g);
  malha.updateMatrixWorld(true);
  return deObjeto(malha);
}

/** Os triângulos de todas as malhas do objeto, cada uma na sua posição do mundo. */
export function deObjeto(raiz: THREE.Object3D): Lido {
  raiz.updateMatrixWorld(true);
  const malhas: THREE.Mesh[] = [];
  raiz.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute("position")) malhas.push(m);
  });

  const triangulosDe = (m: THREE.Mesh) => {
    const g = m.geometry;
    const n = g.index ? g.index.count : g.getAttribute("position").count;
    const instancias = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    return Math.floor(n / 3) * instancias;
  };
  const total = malhas.reduce((s, m) => s + triangulosDe(m), 0);
  const sopa = new Float32Array(total * 9);

  const v = new THREE.Vector3();
  const matriz = new THREE.Matrix4();
  const instancia = new THREE.Matrix4();
  let o = 0;
  for (const m of malhas) {
    const g = m.geometry;
    const pos = g.getAttribute("position");
    const idx = g.index;
    const n = Math.floor((idx ? idx.count : pos.count) / 3) * 3;
    const im = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh) : null;
    for (let k = 0; k < (im ? im.count : 1); k++) {
      matriz.copy(m.matrixWorld);
      if (im) { im.getMatrixAt(k, instancia); matriz.multiply(instancia); }
      /* matriz espelhada inverte o lado de fora das faces: troca dois cantos de volta */
      const espelho = matriz.determinant() < 0;
      for (let t = 0; t < n; t += 3) {
        for (let c = 0; c < 3; c++) {
          const canto = espelho && c > 0 ? 3 - c : c;
          const i = idx ? idx.getX(t + canto) : t + canto;
          v.fromBufferAttribute(pos, i).applyMatrix4(matriz);
          sopa[o++] = v.x; sopa[o++] = v.y; sopa[o++] = v.z;
        }
      }
    }
  }
  return { sopa, partes: malhas.length };
}
