import { cabecalhoStl, escreverTriangulosStl, gravar3mf, gravarStl } from "./arquivos";
import { MM_POR_UNIDADE, type Saida, type Unidade } from "./formatos";
import { prepararParaMesa, soldar, type Giro } from "./malha";

/* A GRAVAÇÃO: a sopa lida vira STL binário ou 3MF, em mm, Z para cima,
   centrada e pousada na mesa. */

export interface Convertido {
  bytes: Uint8Array;
  triangulos: number;
  /** largura (X), profundidade (Y) e altura (Z), em mm */
  medidas: [number, number, number];
}

export async function converter(sopa: Float32Array, o: { unidade: Unidade; giro: Giro; saida: Saida; titulo: string }): Promise<Convertido> {
  const { posicoes, medidas } = prepararParaMesa(sopa, o.unidade, o.giro);
  if (o.saida === "stl") return { bytes: gravarStl(posicoes), triangulos: posicoes.length / 9, medidas };
  const malha = soldar(posicoes);
  if (!malha.indices.length) throw new Error("Depois de juntar os vértices, não sobrou nenhuma face com área: o modelo é plano demais ou minúsculo.");
  const bytes = await gravar3mf(malha.posicoes, malha.indices, o.titulo.slice(0, 120));
  return { bytes, triangulos: malha.indices.length / 3, medidas };
}

export const TIPO_MIME: Readonly<Record<Saida, string>> = { stl: "model/stl", "3mf": "model/3mf" };

/** Triângulos por parte no STL gravado em partes: 200 mil = 10 MB por parte. */
export const TRIANGULOS_POR_PARTE = 200_000;

/**
 * O STL do MODO PESADO, gravado em partes: o mesmo arquivo que
 * `converter(…, "stl")` daria, byte a byte, mas sem a cópia inteira da malha
 * (prepararParaMesa) e sem um Uint8Array do tamanho do arquivo todo — num
 * modelo de 6 milhões de triângulos, são 220 MB + 310 MB que não existem.
 *
 * Duas passadas sobre a sopa: a primeira acha a caixa (com o giro e a escala
 * já aplicados, arredondados para float32 como prepararParaMesa faz); a
 * segunda grava os triângulos de bloco em bloco, cada um entregue a
 * `aoEntregar` (que o junta num Blob). Entre um bloco e outro, `ceder` deixa
 * a tela respirar e mostrar o andamento (0 a 1).
 */
export async function gravarStlEmPartes(
  sopa: Float32Array,
  o: {
    unidade: Unidade; giro: Giro;
    aoEntregar: (parte: Uint8Array) => void;
    ceder?: (feito: number) => Promise<void> | void;
    triangulosPorParte?: number;
  },
): Promise<{ triangulos: number; bytes: number; medidas: [number, number, number] }> {
  const k = MM_POR_UNIDADE[o.unidade];
  const [a, b, c, d, e, f, g, h, i] = o.giro;
  const f32 = Math.fround;
  const n = Math.floor(sopa.length / 9);

  /* 1ª passada: a caixa, nos mesmos float32 que prepararParaMesa guardaria */
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let v = 0; v < n * 9; v += 3) {
    const x = sopa[v], y = sopa[v + 1], z = sopa[v + 2];
    const X = f32((a * x + b * y + c * z) * k), Y = f32((d * x + e * y + f * z) * k), Z = f32((g * x + h * y + i * z) * k);
    if (X < x0) x0 = X; if (X > x1) x1 = X;
    if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  /* 2ª passada: bloco a bloco, o pedaço da malha na mesa e os seus 50 bytes por triângulo */
  o.aoEntregar(cabecalhoStl(n));
  const porParte = Math.max(1, Math.floor(o.triangulosPorParte ?? TRIANGULOS_POR_PARTE));
  const bloco = new Float32Array(Math.min(n, porParte) * 9);
  for (let t0 = 0; t0 < n; t0 += porParte) {
    const nt = Math.min(porParte, n - t0);
    const inicio = t0 * 9;
    for (let j = 0; j < nt * 9; j += 3) {
      const x = sopa[inicio + j], y = sopa[inicio + j + 1], z = sopa[inicio + j + 2];
      /* a mesma conta de prepararParaMesa: arredonda para float32, depois centra (o "+ 0" troca −0 por 0) */
      bloco[j] = f32((a * x + b * y + c * z) * k) - cx + 0;
      bloco[j + 1] = f32((d * x + e * y + f * z) * k) - cy + 0;
      bloco[j + 2] = f32((g * x + h * y + i * z) * k) - z0 + 0;
    }
    const parte = new Uint8Array(50 * nt);
    escreverTriangulosStl(new DataView(parte.buffer), 0, bloco, nt);
    o.aoEntregar(parte);
    if (o.ceder) await o.ceder((t0 + nt) / n);
  }
  return { triangulos: n, bytes: 84 + 50 * n, medidas: [x1 - x0, y1 - y0, z1 - z0] };
}
