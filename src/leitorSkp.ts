import { ErroDeLeitura, SKP_ILEGIVEL, pesadoDemais } from "./erros";
import type { Lido } from "./skp";

/* A LINHA PRINCIPAL LIGANDO O LEITOR DE .SKP EM SEGUNDO PLANO.

   O código do leitor (leitor-skp.worker.ts, já empacotado) chega pelo
   build.mjs como o texto __LEITOR_SKP__ e vira um Worker por uma URL blob:.
   Assim a leitura pesada (50 s e 3,6 GB num .skp de 211 MB) não congela a
   tela, e a memória dela volta ao aparelho quando o Worker é encerrado.

   Sem Worker (navegador antigo, ou uma CSP que barra blob:), `lerSkpEmSegundoPlano`
   devolve null e quem chamou lê na linha principal, como antes. */

declare const __LEITOR_SKP__: string | undefined;

export type MensagemDoLeitor =
  | { tipo: "vivo" }
  | { tipo: "andamento"; etapa: string; feito: number; total: number }
  | { tipo: "lido"; sopa: Float32Array; partes: number }
  | { tipo: "erro"; memoria: boolean; mensagem: string };

export interface Andamento { etapa: string; feito: number; total: number }

/** Lançado quando a pessoa tira o item da fila no meio da leitura: quem chamou só ignora. */
export class LeituraCancelada extends Error {}

export interface LeituraEmSegundoPlano {
  /** a sopa; null se o Worker nem chegou a nascer (aí `dados` continua inteiro, para ler aqui) */
  promessa: Promise<Lido | null>;
  /** encerra o Worker na hora (a promessa rejeita com LeituraCancelada) */
  cancelar(): void;
}

export function lerSkpEmSegundoPlano(dados: ArrayBuffer, aoAndar: (a: Andamento) => void): LeituraEmSegundoPlano {
  let resolver!: (l: Lido | null) => void;
  let rejeitar!: (e: Error) => void;
  const promessa = new Promise<Lido | null>((ok, falha) => { resolver = ok; rejeitar = falha; });
  let acabou = false;
  let url = "";
  let leitor: Worker | null = null;

  const encerrar = () => {
    acabou = true;
    if (leitor) { leitor.onmessage = leitor.onerror = leitor.onmessageerror = null; leitor.terminate(); leitor = null; }
    if (url) { URL.revokeObjectURL(url); url = ""; }
  };

  try {
    if (typeof Worker === "undefined" || typeof __LEITOR_SKP__ !== "string") throw new Error("sem Worker");
    url = URL.createObjectURL(new Blob([__LEITOR_SKP__], { type: "text/javascript" }));
    leitor = new Worker(url);
  } catch {
    encerrar();
    resolver(null);
    return { promessa, cancelar: () => {} };
  }

  /* o arquivo só vai para o Worker depois que ele diz "vivo": se a CSP o barrar, o
     ArrayBuffer não foi transferido (continua inteiro) e dá para ler aqui mesmo */
  let vivo = false;
  leitor.onmessage = (e: MessageEvent<MensagemDoLeitor>) => {
    if (acabou) return;
    const m = e.data;
    if (m.tipo === "vivo") {
      vivo = true;
      if (url) { URL.revokeObjectURL(url); url = ""; }
      try {
        leitor!.postMessage(dados, [dados]);
      } catch {
        /* a transferência falhou (navegador que a recusa, ArrayBuffer já desligado): sem
           isto, o Worker ficaria vivo e o item em "lendo" para sempre */
        encerrar();
        if (dados.byteLength > 0) resolver(null);         // ainda inteiro: lê-se aqui mesmo
        else rejeitar(new ErroDeLeitura(SKP_ILEGIVEL));
      }
    } else if (m.tipo === "andamento") {
      aoAndar({ etapa: m.etapa, feito: m.feito, total: m.total });
    } else if (m.tipo === "lido") {
      encerrar();
      resolver({ sopa: m.sopa, partes: m.partes });
    } else if (m.tipo === "erro") {
      encerrar();
      rejeitar(new ErroDeLeitura(m.memoria ? pesadoDemais("skp") : m.mensagem || SKP_ILEGIVEL));
    }
  };
  /* erro solto no Worker: antes do "vivo", ele não pôde nascer (lê-se aqui); depois,
     morreu no meio da leitura — sem mensagem, é quase sempre a memória que acabou */
  leitor.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    if (acabou) return;
    encerrar();
    if (!vivo) resolver(null);
    else rejeitar(new ErroDeLeitura(pesadoDemais("skp")));
  };
  leitor.onmessageerror = () => {
    if (acabou) return;
    encerrar();
    rejeitar(new ErroDeLeitura(pesadoDemais("skp")));
  };

  return {
    promessa,
    cancelar: () => {
      if (acabou) return;
      encerrar();
      rejeitar(new LeituraCancelada("cancelada"));
    },
  };
}
