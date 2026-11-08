import { gravar3mf, gravarStl } from "./arquivos";
import type { Saida, Unidade } from "./formatos";
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
