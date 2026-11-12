import { buildScene, type ParseOptions } from "openskp";
import { ErroDeLeitura, SKP_ILEGIVEL, faltouMemoria, pesadoDemais } from "./erros";
import { SKP_PLANO_B } from "./formatos";
import { limparSopa } from "./malha";

/* O LEITOR DO .SKP, sem three: roda no leitor em segundo plano
   (leitor-skp.worker.ts) e, se o navegador não deixar criar um, na linha
   principal (ler.ts). */

export interface Lido {
  sopa: Float32Array;
  /** quantos objetos (malhas) do arquivo entraram */
  partes: number;
}

/**
 * O .skp do SketchUp, pela OpenSKP (MIT, engenharia reversa do formato; lê o
 * SketchUp 2013–2020 e o 2021+). `buildScene` resolve componentes e grupos e
 * triangula tudo, no lugar do mundo, em METROS e Y para cima.
 *
 * `frontSideOnly`: cada face sai UMA vez. Sem isso, face com as duas cores
 * diferentes ganha uma cópia invertida no mesmo lugar — boa para ver, péssima
 * para imprimir (o fatiador vê paredes duplicadas e a malha deixa de fechar).
 *
 * `opcoes` leva o andamento que a própria OpenSKP informa (`onProgress`).
 */
export function lerSkp(dados: ArrayBuffer, opcoes: ParseOptions = {}): Lido {
  let cena: ReturnType<typeof buildScene> | null;
  try {
    cena = buildScene(dados, { ...opcoes, frontSideOnly: true });
  } catch (e) {
    throw new ErroDeLeitura(faltouMemoria(e) ? pesadoDemais("skp") : SKP_ILEGIVEL);
  }
  try {
    const prims = cena.glbPrimitives ?? [];
    const total = prims.reduce((s, p) => s + Math.floor(p.indices.length / 3), 0);
    if (!total) throw new ErroDeLeitura(`Este .skp não tem nenhuma face (só linhas, textos ou nada). ${SKP_PLANO_B}`);
    opcoes.onProgress?.({ stage: "triangulos", current: 0, total });
    const sopa = new Float32Array(total * 9);
    let o = 0;
    for (const p of prims) {
      const n = Math.floor(p.indices.length / 3) * 3;
      for (let t = 0; t < n; t++) {
        const i = p.indices[t] * 3;
        sopa[o++] = p.positions[i]; sopa[o++] = p.positions[i + 1]; sopa[o++] = p.positions[i + 2];
      }
    }
    const partes = prims.length;
    cena = null;                                  // a cena (o grosso da memória) já pode ir embora
    const limpa = limparSopa(sopa);
    if (!limpa.length) throw new ErroDeLeitura(`Este .skp não tem nenhuma face com números válidos. ${SKP_PLANO_B}`);
    return { sopa: limpa, partes };
  } catch (e) {
    if (e instanceof ErroDeLeitura) throw e;
    throw new ErroDeLeitura(faltouMemoria(e) ? pesadoDemais("skp") : SKP_ILEGIVEL);
  }
}
