import { MM_POR_UNIDADE, type Unidade } from "./formatos";

/* A MALHA DO CONVERSOR, em TS puro (sem three): o que se faz com os
   triângulos entre ler o arquivo e gravar o STL ou o 3MF.

   A malha chega como SOPA — 9 números por triângulo (3 vértices x, y, z),
   já com a posição de cada objeto do arquivo aplicada — na unidade e no "para
   cima" do arquivo. Daqui ela sai em milímetros, Z para cima, centrada na
   mesa e pousada em z = 0: é como o fatiador espera.

   O giro é em passos de 90° (a pessoa aperta "girar"), guardado como matriz
   inteira 3×3: girar quatro vezes volta exatamente ao começo, sem resíduo de
   ponto flutuante. */

/** Matriz 3×3 por linhas: [a b c / d e f / g h i]. Só 0, 1 e −1. */
export type Giro = readonly [number, number, number, number, number, number, number, number, number];

export const SEM_GIRO: Giro = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** +90° em torno de X: o Y de cima vira o Z de cima (glTF, FBX, OBJ → mesa). */
export const Y_PARA_Z: Giro = [1, 0, 0, 0, 0, -1, 0, 1, 0];

const PASSO: Record<"x" | "y" | "z", Giro> = {
  x: Y_PARA_Z,
  y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
};

export function multiplicar(a: Giro, b: Giro): Giro {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  }
  return r as unknown as Giro;
}

/** Mais 90° em torno de um eixo da MESA (aplicado depois do giro que já havia). */
export function girar(atual: Giro, eixo: "x" | "y" | "z"): Giro {
  return multiplicar(PASSO[eixo], atual);
}

export interface Caixa { min: [number, number, number]; max: [number, number, number] }

export function caixaDe(p: Float32Array): Caixa {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const v = p[i + e];
      if (v < min[e]) min[e] = v;
      if (v > max[e]) max[e] = v;
    }
  }
  return { min, max };
}

export function medidasDe(c: Caixa): [number, number, number] {
  return [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];
}

/** Os triângulos com algum número que não é finito (NaN, ∞) saem: um só estraga a caixa e o fatiador. */
export function limparSopa(p: Float32Array): Float32Array {
  let ruins = 0;
  for (let t = 0; t < p.length; t += 9) {
    for (let e = 0; e < 9; e++) if (!Number.isFinite(p[t + e])) { ruins++; break; }
  }
  if (!ruins) return p;
  const saida = new Float32Array(p.length - ruins * 9);
  let o = 0;
  for (let t = 0; t < p.length; t += 9) {
    let bom = true;
    for (let e = 0; e < 9; e++) if (!Number.isFinite(p[t + e])) { bom = false; break; }
    if (bom) { saida.set(p.subarray(t, t + 9), o); o += 9; }
  }
  return saida;
}

/**
 * A malha pronta para a mesa: giro, escala para mm, centro em X/Y e base em
 * z = 0. Devolve uma sopa NOVA (a original fica, para a pessoa girar de novo).
 * Giro com determinante −1 não existe aqui (só rotações), então a ordem dos
 * vértices — o lado de fora de cada face — se mantém.
 */
export function prepararParaMesa(sopa: Float32Array, unidade: Unidade, giro: Giro): { posicoes: Float32Array; medidas: [number, number, number] } {
  const k = MM_POR_UNIDADE[unidade];
  const [a, b, c, d, e, f, g, h, i] = giro;
  const p = new Float32Array(sopa.length);
  for (let v = 0; v < sopa.length; v += 3) {
    const x = sopa[v], y = sopa[v + 1], z = sopa[v + 2];
    p[v] = (a * x + b * y + c * z) * k;
    p[v + 1] = (d * x + e * y + f * z) * k;
    p[v + 2] = (g * x + h * y + i * z) * k;
  }
  const caixa = caixaDe(p);
  const cx = (caixa.min[0] + caixa.max[0]) / 2;
  const cy = (caixa.min[1] + caixa.max[1]) / 2;
  const z0 = caixa.min[2];
  for (let v = 0; v < p.length; v += 3) {
    /* o "+ 0" troca −0 por 0: os dois têm bits diferentes, e a solda do 3MF compara bits */
    p[v] = p[v] - cx + 0;
    p[v + 1] = p[v + 1] - cy + 0;
    p[v + 2] = p[v + 2] - z0 + 0;
  }
  return { posicoes: p, medidas: medidasDe(caixa) };
}

/**
 * A unidade mais provável, quando a do formato dá um tamanho sem sentido
 * para uma peça impressa: um OBJ do Blender vem em metros e, lido como mm,
 * vira um grão de 0,2 mm. Se o maior lado na unidade padrão fica abaixo de
 * 2 mm, tenta a próxima maior até a peça passar de 10 mm. Acima disso a
 * escolha do formato vale (uma maquete de 3 m em mm é peça de verdade).
 */
export function unidadeProvavel(maiorLadoNaUnidadeDoArquivo: number, padrao: Unidade): Unidade {
  const ordem: Unidade[] = ["mm", "cm", "pol", "m"];
  const mm = maiorLadoNaUnidadeDoArquivo * MM_POR_UNIDADE[padrao];
  if (!(mm > 0) || mm >= 2) return padrao;
  for (const u of ordem) {
    if (MM_POR_UNIDADE[u] <= MM_POR_UNIDADE[padrao]) continue;
    if (maiorLadoNaUnidadeDoArquivo * MM_POR_UNIDADE[u] >= 10) return u;
  }
  return "m";
}

/**
 * A malha INDEXADA (para o 3MF): vértices iguais viram um só. "Igual" é a
 * mesma posição em float32 — o que a sopa já guarda. Triângulo que fica com
 * dois cantos no mesmo vértice (área zero) sai: o 3MF o recusa e o fatiador
 * reclama.
 */
export function soldar(sopa: Float32Array): { posicoes: Float32Array; indices: Uint32Array } {
  const n = sopa.length / 3;
  /* tabela de espalhamento aberta, em arrays tipados: 5 milhões de triângulos
     são 15 milhões de vértices, e um Map de texto não cabe na aba */
  let tamanho = 1;
  while (tamanho < n * 2) tamanho <<= 1;
  const mascara = tamanho - 1;
  const tabela = new Int32Array(tamanho).fill(-1);
  const bits = new Uint32Array(sopa.buffer, sopa.byteOffset, sopa.length);
  const unicos = new Uint32Array(n);          // o vértice da sopa que representa cada único
  let total = 0;
  const mapa = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    const x = bits[v * 3], y = bits[v * 3 + 1], z = bits[v * 3 + 2];
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mascara;
    for (;;) {
      const i = tabela[h];
      if (i < 0) {
        tabela[h] = total;
        unicos[total] = v;
        mapa[v] = total++;
        break;
      }
      const u = unicos[i] * 3;
      if (bits[u] === x && bits[u + 1] === y && bits[u + 2] === z) { mapa[v] = i; break; }
      h = (h + 1) & mascara;
    }
  }
  const posicoes = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) posicoes.set(sopa.subarray(unicos[i] * 3, unicos[i] * 3 + 3), i * 3);
  const indices = new Uint32Array(n);
  let o = 0;
  for (let t = 0; t < n; t += 3) {
    const a = mapa[t], b = mapa[t + 1], c = mapa[t + 2];
    if (a === b || b === c || a === c) continue;
    indices[o++] = a; indices[o++] = b; indices[o++] = c;
  }
  return { posicoes, indices: indices.slice(0, o) };
}

/** Os índices 0, 1, 2… de uma sopa (o STL não precisa soldar: cada triângulo leva os seus três vértices). */
export function indicesDaSopa(sopa: Float32Array): Uint32Array {
  const n = sopa.length / 3;
  const t = new Uint32Array(n);
  for (let i = 0; i < n; i++) t[i] = i;
  return t;
}

/**
 * As medidas na mesa (mm) sem refazer a malha: o giro só troca eixos de
 * lugar (e de sinal), então a caixa girada é a caixa do arquivo com os lados
 * permutados. É o que a tela mostra a cada toque em "girar" ou na unidade.
 */
export function medidasNaMesa(bruto: readonly [number, number, number], unidade: Unidade, giro: Giro): [number, number, number] {
  const k = MM_POR_UNIDADE[unidade];
  const lado = (i: number) => (Math.abs(giro[i * 3]) * bruto[0] + Math.abs(giro[i * 3 + 1]) * bruto[1] + Math.abs(giro[i * 3 + 2]) * bruto[2]) * k;
  return [lado(0), lado(1), lado(2)];
}
