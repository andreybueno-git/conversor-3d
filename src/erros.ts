import { SKP_PLANO_B } from "./formatos";

/* OS ERROS DE LEITURA, em TS puro (sem three): este módulo vai também para o
   leitor de .skp que roda em segundo plano (leitor-skp.worker.ts). */

/** Um erro já escrito para a pessoa ler. */
export class ErroDeLeitura extends Error {}

/**
 * A memória acabou? É o que o navegador diz quando não consegue reservar um
 * bloco grande: no Chrome, "Array buffer allocation failed" ou "Invalid typed
 * array length" (RangeError); no Safari, "Out of memory"; no Firefox,
 * "allocation size overflow" ou "out of memory" (InternalError). Um RangeError
 * qualquer de outra causa (ex.: pilha estourada) não conta.
 */
export function faltouMemoria(e: unknown): boolean {
  if (!(e instanceof Error) && !(typeof e === "object" && e !== null && "message" in e)) return false;
  const { name = "", message = "" } = e as { name?: string; message?: string };
  if (/out of memory/i.test(message)) return true;
  if (name !== "RangeError" && name !== "InternalError") return false;
  return /alloc|memory|array buffer|(typed )?array length|buffer size/i.test(message);
}

/** A frase de quando o .skp não abre por um erro de leitura de verdade. */
export const SKP_ILEGIVEL = `Não consegui ler este .skp (pode ser de uma versão do SketchUp que o leitor ainda não conhece, ou um arquivo danificado). ${SKP_PLANO_B}`;

/** A frase de quando a memória acaba no meio da leitura: no lugar de "arquivo danificado". */
export function pesadoDemais(ext: string): string {
  const base = "Este arquivo é pesado demais para este navegador: a memória acabou antes de terminar a leitura. Tente no Chrome do computador, com as outras abas fechadas.";
  return ext === "skp" ? `${base} ${SKP_PLANO_B}` : `${base} Se ainda assim não abrir, reduza a malha no programa de origem.`;
}
