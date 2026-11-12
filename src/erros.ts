import { SKP_PLANO_B } from "./formatos";

/* OS ERROS DE LEITURA, em TS puro (sem three): este módulo vai também para o
   leitor de .skp que roda em segundo plano (leitor-skp.worker.ts). */

/** Um erro já escrito para a pessoa ler. */
export class ErroDeLeitura extends Error {}

/**
 * A memória acabou? É o que o navegador diz quando não consegue reservar um
 * bloco grande: no Chrome, "Array buffer allocation failed" (ou "Invalid typed
 * array length: N" com N enorme); no Safari, "Out of memory"; no Firefox,
 * "allocation size overflow" ou "out of memory".
 *
 * A OpenSKP pega esse erro e o embrulha num SkpParseError ("legacy .skp parse
 * failed: Array buffer allocation failed", com `cause` = o original): por isso
 * a frase vale qualquer que seja o nome do erro, e a cadeia de `cause` é
 * percorrida (até 8 elos, para não girar em círculo).
 *
 * Não conta: pilha estourada, nem "Invalid … length" com número negativo,
 * pequeno ou sem número — isso é contagem lixo de arquivo corrompido, e a
 * pessoa deve ler "pode estar danificado", não "tente outro navegador".
 */
export function faltouMemoria(e: unknown): boolean {
  let elo: unknown = e;
  for (let n = 0; n < 8 && typeof elo === "object" && elo !== null; n++) {
    if (umElo(elo as { name?: unknown; message?: unknown })) return true;
    elo = (elo as { cause?: unknown }).cause;
  }
  return false;
}

/** comprimento que só falha por falta de memória: 2^28 elementos (1 GB em Float32) */
const COMPRIMENTO_DE_MEMORIA = 2 ** 28;

function umElo({ name, message }: { name?: unknown; message?: unknown }): boolean {
  if (typeof message !== "string") return false;
  if (/allocation failed|out of memory|allocation size overflow/i.test(message)) return true;
  if (name !== "RangeError" && name !== "InternalError") return false;
  const m = /invalid (?:typed )?array(?: buffer)? length:\s*(-?\d+)/i.exec(message);
  return !!m && Number(m[1]) >= COMPRIMENTO_DE_MEMORIA;
}

/** A frase de quando o .skp não abre por um erro de leitura de verdade. */
export const SKP_ILEGIVEL = `Não consegui ler este .skp (pode ser de uma versão do SketchUp que o leitor ainda não conhece, ou um arquivo danificado). ${SKP_PLANO_B}`;

/** A frase de quando a memória acaba no meio da leitura: no lugar de "arquivo danificado". */
export function pesadoDemais(ext: string): string {
  const base = "Este arquivo é pesado demais para este navegador: a memória acabou antes de terminar a leitura. Tente no Chrome do computador, com as outras abas fechadas.";
  return ext === "skp" ? `${base} ${SKP_PLANO_B}` : `${base} Se ainda assim não abrir, reduza a malha no programa de origem.`;
}
