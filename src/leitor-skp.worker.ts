import { ErroDeLeitura, faltouMemoria } from "./erros";
import { lerSkp } from "./skp";
import type { MensagemDoLeitor } from "./leitorSkp";

/* O LEITOR DE .SKP EM SEGUNDO PLANO (Web Worker). O build.mjs o empacota à
   parte e o embute no index.html como texto; leitorSkp.ts o liga por uma URL
   blob: — o site continua sendo um arquivo só.

   Conversa: ele diz "vivo" assim que carrega; recebe o ArrayBuffer do
   arquivo (transferido, sem cópia); manda o andamento que a OpenSKP informa;
   e devolve a sopa (transferida) ou o erro. Quem o criou o encerra ao fim —
   é o que devolve ao aparelho a memória da leitura. */

const escopo = self as unknown as {
  postMessage(m: MensagemDoLeitor, transferir?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ArrayBuffer>) => void) | null;
};

escopo.onmessage = (e) => {
  escopo.onmessage = null;                       // um arquivo por leitor
  try {
    const lido = lerSkp(e.data, {
      onProgress: (p) => escopo.postMessage({ tipo: "andamento", etapa: p.stage, feito: p.current, total: p.total }),
    });
    escopo.postMessage({ tipo: "lido", sopa: lido.sopa, partes: lido.partes }, [lido.sopa.buffer]);
  } catch (erro) {
    escopo.postMessage({
      tipo: "erro",
      memoria: faltouMemoria(erro),
      mensagem: erro instanceof ErroDeLeitura ? erro.message : "",
    });
  }
};

escopo.postMessage({ tipo: "vivo" });
