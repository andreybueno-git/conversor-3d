"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { faltouMemoria, pesadoDemais } from "./erros";
import {
  ACEITA, ARQUIVO_GRANDE_BYTES, COMPANHEIROS, MAX_BYTES, ROTULO_DA_UNIDADE, SEM_LEITOR, extensao, formatarBytes, formatarInteiro, formatarMm,
  formatoDe, modoPesado, nomeDeSaida, nomesUnicos, textoDoAndamento, type Formato, type Saida, type Unidade,
} from "./formatos";
import { LeituraCancelada, lerSkpEmSegundoPlano } from "./leitorSkp";
import { SEM_GIRO, Y_PARA_Z, caixaDe, girar, medidasDe, medidasNaMesa, prepararParaMesa, unidadeProvavel, type Giro } from "./malha";
import type { Lido } from "./skp";
import type { Visor } from "./visor";

/* A TELA DO CONVERSOR: fila, véu de arrastar, prévia, ajustes e downloads.
   Nada sobe para servidor: o arquivo é lido, convertido e baixado aqui, no
   navegador (ler.ts, gravar.ts, visor.ts). */

type Estado = "lendo" | "pronto" | "erro";

interface Item {
  id: number;
  nome: string;
  tamanho: number;
  formato: Formato | null;
  estado: Estado;
  erro?: string;
  /** o "porquê" de um formato que não abre aqui (o .skp): vem com o caminho */
  dica?: boolean;
  sopa?: Float32Array;
  partes?: number;
  /** MODO PESADO (mais triângulos que LIMIAR_MODO_PESADO): sem prévia, STL em partes, sem 3MF nem ZIP */
  pesado?: boolean;
  /** o andamento real da leitura do .skp, já em português */
  andamento?: string;
  /** as medidas da caixa do arquivo, na unidade dele */
  bruto?: [number, number, number];
  unidade: Unidade;
  giro: Giro;
}

const UNIDADES: Unidade[] = ["mm", "cm", "m", "pol"];

let proximoId = 1;

function baixar(dados: BlobPart[], nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob(dados, { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Um quadro para a tela pintar o "lendo…" antes de o leitor ocupar a linha principal. */
const respirar = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Cede a vez à tela entre dois blocos de uma gravação longa (sem o freio do setTimeout em aba de fundo). */
const cederAVez = () => new Promise<void>((r) => {
  const canal = new MessageChannel();
  canal.port1.onmessage = () => { canal.port1.close(); r(); };
  canal.port2.postMessage(null);
});

/** A frase dos que ficam de fora do ZIP (os pesados). */
function foraDoZip(pesados: readonly { nome: string }[]): string {
  const nomes = pesados.map((p) => p.nome).join(", ");
  return pesados.length === 1
    ? `${nomes} fica de fora do ZIP por ser pesado: baixe-o sozinho, no botão Baixar em STL.`
    : `${nomes} ficam de fora do ZIP por serem pesados: baixe cada um sozinho, no botão Baixar em STL.`;
}

/** O rótulo do botão enquanto grava: no modo pesado, com quanto já foi. */
const gravandoStl = (gravado: number | null) => `Gravando o STL…${gravado !== null ? ` ${Math.floor(gravado * 100)}%` : ""}`;

export function Conversor() {
  const [itens, setItens] = useState<Item[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [ocupado, setOcupado] = useState<null | Saida | "todos">(null);
  /* quanto do STL em partes já foi gravado (0 a 1), no modo pesado */
  const [gravado, setGravado] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");
  const [sem3d, setSem3d] = useState(false);
  const [com3d, setCom3d] = useState(false);
  const campoId = useId();
  const campo = useRef<HTMLInputElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const visor = useRef<Visor | null>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());
  /* os itens que ainda estão na fila (tirar um no meio da leitura não mexe mais na tela)
     e, para o .skp em leitura, como encerrar o leitor em segundo plano */
  const naFila = useRef(new Set<number>());
  const cancelar = useRef(new Map<number, () => void>());
  /* no celular, o botão de baixar fica duas telas abaixo da prévia: uma barra presa
     embaixo da tela o repete enquanto ele não está à vista */
  const botaoStl = useRef<HTMLButtonElement>(null);
  const [botaoAVista, setBotaoAVista] = useState(true);

  const mudar = useCallback((id: number, m: Partial<Item>) => {
    setItens((lista) => lista.map((i) => (i.id === id ? { ...i, ...m } : i)));
  }, []);

  /* ── chegar arquivos: separa modelos, companheiros (.bin) e os que não abrem aqui ── */
  const receber = useCallback((arquivos: File[]) => {
    if (!arquivos.length) return;
    const modelos = arquivos.filter((a) => formatoDe(a.name));
    const companheiros = arquivos.filter((a) => COMPANHEIROS.has(extensao(a.name)));
    const novos: Item[] = [];
    for (const a of arquivos) {
      const ext = extensao(a.name);
      const formato = formatoDe(a.name);
      if (!formato && COMPANHEIROS.has(ext)) continue;
      const base: Item = { id: proximoId++, nome: a.name, tamanho: a.size, formato, estado: "lendo", unidade: formato?.unidade ?? "mm", giro: formato?.cima === "y" ? Y_PARA_Z : SEM_GIRO };
      if (!formato) {
        novos.push({ ...base, estado: "erro", dica: Boolean(SEM_LEITOR[ext]), erro: SEM_LEITOR[ext] ?? `Não leio arquivos .${ext || "sem extensão"}. A lista dos que entram está logo abaixo.` });
      } else if (a.size > MAX_BYTES) {
        novos.push({ ...base, estado: "erro", erro: `Este arquivo tem ${formatarBytes(a.size)}; o teto aqui é ${formatarBytes(MAX_BYTES)}, para a aba não travar. Reduza a malha no programa de origem.` });
      } else {
        novos.push(base);
      }
    }
    if (!modelos.length && companheiros.length) {
      setAviso("Esse arquivo acompanha um modelo. Solte o .gltf junto com ele (selecione os dois de uma vez).");
      return;
    }
    setAviso("");
    for (const n of novos) naFila.current.add(n.id);
    setItens((lista) => [...lista, ...novos]);
    const primeiroBom = novos.find((n) => n.estado === "lendo") ?? novos[0];
    if (primeiroBom) setSelecionado(primeiroBom.id);

    /* um de cada vez, na ordem: dois leitores juntos dobram a memória da aba */
    for (const item of novos) {
      if (item.estado !== "lendo") continue;
      const arquivo = modelos.find((m) => m.name === item.nome)!;
      const vivo = () => naFila.current.has(item.id);
      fila.current = fila.current.then(async () => {
        if (!vivo()) return;                                 // tirado enquanto esperava a vez
        try {
          await respirar();
          const dados = await arquivo.arrayBuffer();
          if (!vivo()) return;
          let lido: Lido | null = null;
          /* o .skp é lido em segundo plano (Web Worker): a tela segue viva, com o andamento real */
          if (item.formato?.ext === "skp") {
            const leitura = lerSkpEmSegundoPlano(dados, (a) => { if (vivo()) mudar(item.id, { andamento: textoDoAndamento(a) }); });
            cancelar.current.set(item.id, leitura.cancelar);
            try { lido = await leitura.promessa; } finally { cancelar.current.delete(item.id); }
            if (!vivo()) return;
          }
          /* os outros formatos (vários leitores do three usam DOMParser, que não existe no
             Worker) e o .skp de quando o Worker não pôde nascer: aqui, como sempre */
          if (!lido) {
            const [{ lerModelo }, extras] = await Promise.all([
              import("./ler"),
              Promise.all(companheiros.map(async (c) => ({ nome: c.name, dados: await c.arrayBuffer() }))),
            ]);
            lido = await lerModelo({ nome: arquivo.name, dados }, extras);
            if (!vivo()) return;
          }
          const bruto = medidasDe(caixaDe(lido.sopa));
          const unidade = unidadeProvavel(Math.max(...bruto), item.unidade);
          mudar(item.id, { estado: "pronto", sopa: lido.sopa, partes: lido.partes, bruto, unidade, pesado: modoPesado(lido.sopa.length / 9), andamento: undefined });
        } catch (e) {
          if (e instanceof LeituraCancelada || !vivo()) return;
          const erro = faltouMemoria(e) ? pesadoDemais(item.formato?.ext ?? "")
            : e instanceof Error ? e.message : "Não consegui ler este arquivo.";
          mudar(item.id, { estado: "erro", erro, andamento: undefined });
        }
      });
    }
  }, [mudar]);

  /* ── soltar em QUALQUER lugar da página: o navegador abriria o arquivo e a pessoa perderia a página ── */
  useEffect(() => {
    let profundidade = 0;
    const temArquivo = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const entrou = (e: DragEvent) => { if (!temArquivo(e)) return; e.preventDefault(); profundidade++; setArrastando(true); };
    const sobre = (e: DragEvent) => { if (!temArquivo(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const saiu = (e: DragEvent) => { if (!temArquivo(e)) return; profundidade = Math.max(0, profundidade - 1); if (!profundidade) setArrastando(false); };
    const soltou = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade = 0;
      setArrastando(false);
      receber(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", entrou);
    window.addEventListener("dragover", sobre);
    window.addEventListener("dragleave", saiu);
    window.addEventListener("drop", soltou);
    return () => {
      window.removeEventListener("dragenter", entrou);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("dragleave", saiu);
      window.removeEventListener("drop", soltou);
    };
  }, [receber]);

  const atual = itens.find((i) => i.id === selecionado) ?? null;
  const prontos = itens.filter((i) => i.estado === "pronto");
  /* o ZIP leva só os que não são pesados: dois de 300 MB num ZIP montado na memória não cabem */
  const leves = prontos.filter((i) => !i.pesado);
  const pesadosProntos = prontos.filter((i) => i.pesado);

  /* ── o 3D: nasce com o primeiro modelo pronto; sem WebGL, a tela segue sem ele ── */
  const temPronto = atual?.estado === "pronto";
  const pesadoAtual = temPronto && Boolean(atual?.pesado);
  useEffect(() => {
    if (!temPronto || pesadoAtual || visor.current || sem3d || !palco.current) return;
    let cancelado = false;
    import("./visor").then(({ criarVisor }) => {
      if (cancelado || !palco.current || visor.current) return;
      try {
        const amortecer = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        visor.current = criarVisor(palco.current, { amortecer });
        setCom3d(true);                                // desenha a peça já selecionada
      } catch {
        setSem3d(true);
      }
    }, () => setSem3d(true));
    return () => { cancelado = true; };
  }, [temPronto, pesadoAtual, sem3d]);

  /* modo pesado: a prévia sai de cena (e devolve a memória da placa de vídeo); volta ao escolher um leve */
  useEffect(() => {
    if (!pesadoAtual || !visor.current) return;
    visor.current.destruir();
    visor.current = null;
    setCom3d(false);
  }, [pesadoAtual]);

  const vazio = itens.length === 0;
  useEffect(() => () => {
    visor.current?.destruir();
    visor.current = null;
    for (const c of cancelar.current.values()) c();         // nenhum leitor em segundo plano fica vivo
    naFila.current.clear();
  }, []);

  useEffect(() => {
    if (!com3d || !visor.current || atual?.estado !== "pronto" || !atual.sopa || atual.pesado) return;
    const { posicoes, medidas } = prepararParaMesa(atual.sopa, atual.unidade, atual.giro);
    visor.current.mostrar(posicoes, medidas);
  }, [atual, com3d]);

  const pronto = atual?.estado === "pronto";
  useEffect(() => {
    const alvo = botaoStl.current;
    if (!pronto || !alvo || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver(([e]) => setBotaoAVista(e.isIntersecting), { threshold: 0.6 });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [pronto]);

  /* ── baixar ── */
  /* O BOTÃO PRINCIPAL É SEMPRE STL (o que toda impressora e todo fatiador aceitam);
     o 3MF é um botão menor, opcional, embaixo. Sem seletor: ninguém baixa o formato errado. */
  async function converterUm(item: Item, nome: string, saida: Saida) {
    const { converter, TIPO_MIME } = await import("./gravar");
    const r = await converter(item.sopa!, { unidade: item.unidade, giro: item.giro, saida, titulo: nome.replace(/\.[^.]+$/, "") });
    return { bytes: r.bytes, tipo: TIPO_MIME[saida] };
  }

  /* MODO PESADO: o STL sai gravado em partes (gravar.ts), cada uma num Blob; o arquivo
     baixado é o mesmo, byte a byte, sem uma segunda cópia da malha nem um bloco de 300 MB */
  async function gravarPesado(item: Item, nome: string) {
    const { gravarStlEmPartes, TIPO_MIME } = await import("./gravar");
    const partes: Blob[] = [];
    const r = await gravarStlEmPartes(item.sopa!, {
      unidade: item.unidade, giro: item.giro,
      aoEntregar: (p) => partes.push(new Blob([p as BlobPart])),
      ceder: async (feito) => { setGravado(feito); await cederAVez(); },
    });
    baixar(partes, nome, TIPO_MIME.stl);
    return r.bytes;
  }

  async function baixarUm(item: Item, saida: Saida) {
    if (item.pesado && saida !== "stl") return;            // o 3MF fica desligado no modo pesado
    setOcupado(saida);
    try {
      await respirar();
      const nome = nomeDeSaida(item.nome, saida);
      if (item.pesado) {
        setGravado(0);
        const tamanho = await gravarPesado(item, nome);
        setAviso(`${nome} pronto, ${formatarBytes(tamanho)}, com os ${formatarInteiro((item.sopa?.length ?? 0) / 9)} triângulos.`);
      } else {
        const { bytes, tipo } = await converterUm(item, nome, saida);
        baixar([bytes as BlobPart], nome, tipo);
        setAviso(`${nome} pronto, ${formatarBytes(bytes.length)}.`);
      }
    } catch (e) {
      setAviso(faltouMemoria(e) ? "A memória acabou no meio da gravação. Feche as outras abas e tente de novo; no Chrome do computador cabe mais."
        : e instanceof Error ? e.message : "Não consegui gravar o arquivo.");
    } finally {
      setOcupado(null);
      setGravado(null);
    }
  }

  async function baixarTodos() {
    const saida: Saida = "stl";
    setOcupado("todos");
    try {
      await respirar();
      const { gravarZip } = await import("./arquivos");
      const nomes = nomesUnicos(leves.map((i) => nomeDeSaida(i.nome, saida)));
      const arquivos = [];
      for (const [k, item] of leves.entries()) {
        arquivos.push({ nome: nomes[k], dados: (await converterUm(item, nomes[k], saida)).bytes });
      }
      const zip = gravarZip(arquivos);
      baixar([zip as BlobPart], `convertidos-${saida}.zip`, "application/zip");
      setAviso(`${arquivos.length} arquivos num ZIP, ${formatarBytes(zip.length)}.${pesadosProntos.length ? ` ${foraDoZip(pesadosProntos)}` : ""}`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui montar o ZIP.");
    } finally {
      setOcupado(null);
    }
  }

  function tirar(id: number) {
    /* no meio da leitura: o leitor em segundo plano é encerrado (devolve a memória) e o
       resultado, se ainda chegar, não mexe mais na tela */
    naFila.current.delete(id);
    cancelar.current.get(id)?.();
    cancelar.current.delete(id);
    const resto = itens.filter((i) => i.id !== id);
    /* a fila esvaziou: o palco sai da tela, e o 3D sai junto (nasce de novo no próximo arquivo) */
    if (!resto.length) {
      visor.current?.destruir();
      visor.current = null;
      setCom3d(false);
    }
    setItens((l) => l.filter((i) => i.id !== id));
    if (selecionado === id) setSelecionado(itens.find((i) => i.id !== id)?.id ?? null);
  }

  const medidas = atual?.estado === "pronto" && atual.bruto ? medidasNaMesa(atual.bruto, atual.unidade, atual.giro) : null;

  return (
    <div className="cv-ilha" data-vazio={vazio ? "sim" : "nao"} data-arrastando={arrastando ? "sim" : "nao"}>
      <input
        ref={campo} id={campoId} className="cv-campo" type="file" multiple accept={ACEITA}
        onChange={(e) => { receber(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ""; }}
      />

      {/* o véu de quando um arquivo é arrastado sobre a página (soltar em qualquer lugar) */}
      <div className="cv-veu" aria-hidden="true">
        <div className="cv-veu-cartao">
          <span className="cv-cubo cv-cubo-grande"><i /><i /><i /><i /><i /><i /></span>
          <strong>Solte para converter</strong>
        </div>
      </div>

      {vazio ? (
        <label htmlFor={campoId} className="cv-soltar">
          <span className="cv-cubo" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
          {/* com mouse: arrastar; no celular (toque): tocar — o texto certo para cada um */}
          <span className="cv-soltar-titulo cv-so-mouse">Solte seus arquivos 3D aqui</span>
          <span className="cv-soltar-sub cv-so-mouse">ou <span className="cv-link">escolha no aparelho</span> · vários de uma vez</span>
          <span className="cv-soltar-titulo cv-so-toque">Toque aqui para escolher seu arquivo</span>
          <span className="cv-soltar-sub cv-so-toque">dos Arquivos, do Drive ou baixado do WhatsApp</span>
          <span className="cv-soltar-pe">
            <span className="cv-cadeado" aria-hidden="true" /> O arquivo não sai do seu aparelho: a conversão é feita aqui, no navegador.
          </span>
        </label>
      ) : (
        <div className="cv-mesa">
          <section className="cv-palco" aria-label="Prévia 3D">
            <div ref={palco} className="cv-palco-quadro" data-estado={atual?.estado ?? "vazio"}>
              {atual?.estado === "lendo" && (
                <div className="cv-palco-aviso" role="status">
                  <span className="cv-girando" aria-hidden="true" />
                  <span>Lendo {atual.nome}…</span>
                  {atual.andamento && <span className="cv-andamento">{atual.andamento}</span>}
                  {atual.tamanho >= ARQUIVO_GRANDE_BYTES && (
                    <span className="cv-palco-grande">
                      Arquivo grande ({formatarBytes(atual.tamanho)}): a leitura pode levar mais de um minuto. Arquivo grande vai melhor no
                      Chrome do computador, com as outras abas fechadas.
                    </span>
                  )}
                </div>
              )}
              {atual?.estado === "erro" && (
                <div className="cv-palco-aviso cv-palco-erro">
                  <strong>{atual.dica ? "Este formato precisa de um passo antes" : "Este não deu"}</strong>
                  <span>{atual.erro}</span>
                </div>
              )}
              {atual?.estado === "pronto" && atual.pesado && (
                <div className="cv-palco-aviso cv-palco-pesado">
                  <strong>Modelo pesado: {formatarInteiro((atual.sopa?.length ?? 0) / 9)} triângulos</strong>
                  <span>
                    A prévia 3D fica desligada para a conversão caber na memória do navegador. As medidas, a unidade e o giro continuam
                    valendo, e o STL sai completo, com todos os triângulos.
                  </span>
                </div>
              )}
              {atual?.estado === "pronto" && !atual.pesado && sem3d && (
                <div className="cv-palco-aviso">A prévia 3D não abriu neste navegador, mas a conversão funciona igual.</div>
              )}
            </div>
            {medidas && atual && (
              <div className="cv-medidas" aria-live="polite">
                <span><b>{formatarMm(medidas[0])}</b><small>largura</small></span>
                <span aria-hidden="true">×</span>
                <span><b>{formatarMm(medidas[1])}</b><small>profundidade</small></span>
                <span aria-hidden="true">×</span>
                <span><b>{formatarMm(medidas[2])}</b><small>altura</small></span>
              </div>
            )}
            {atual?.estado === "pronto" && !atual.pesado && <p className="cv-dica-gesto"><span className="cv-so-mouse">Arraste para girar · roda do mouse para aproximar</span><span className="cv-so-toque">Arraste com o dedo para girar · dois dedos para aproximar</span></p>}
          </section>

          <section className="cv-painel" aria-label="Ajustes e download">
            {atual?.estado === "pronto" && (
              <>
                <div className="cv-grupo">
                  <h2 className="cv-rotulo">O arquivo está em</h2>
                  <div className="cv-fichas" role="radiogroup" aria-label="Unidade do arquivo">
                    {UNIDADES.map((u) => (
                      <button key={u} type="button" role="radio" aria-checked={atual.unidade === u} className="cv-ficha"
                              title={ROTULO_DA_UNIDADE[u]} onClick={() => mudar(atual.id, { unidade: u })}>
                        {u}
                      </button>
                    ))}
                  </div>
                  <p className="cv-nota">
                    {atual.pesado ? "Confira as medidas embaixo do aviso" : "Confira as medidas na prévia"}: se a peça parecer minúscula ou gigante, troque a unidade.
                  </p>
                </div>

                <div className="cv-grupo">
                  <h2 className="cv-rotulo">Posição na mesa</h2>
                  <div className="cv-giros">
                    {(["x", "y", "z"] as const).map((eixo) => (
                      <button key={eixo} type="button" className="cv-giro" aria-label={`Girar em ${eixo.toUpperCase()}`}
                              onClick={() => mudar(atual.id, { giro: girar(atual.giro, eixo) })}>
                        <span aria-hidden="true" className="cv-giro-seta">↻</span> Girar {eixo.toUpperCase()}
                      </button>
                    ))}
                    <button type="button" className="cv-giro cv-giro-volta"
                            onClick={() => mudar(atual.id, { giro: atual.formato?.cima === "y" ? Y_PARA_Z : SEM_GIRO })}>
                      Voltar ao original
                    </button>
                  </div>
                </div>
              </>
            )}

            {atual?.estado === "pronto" && (
              <p className="cv-qualidade">
                <span className="cv-qualidade-selo" aria-hidden="true">✓</span>
                <span>
                  <b>Qualidade máxima</b> — os {formatarInteiro((atual.sopa?.length ?? 0) / 9)} triângulos do arquivo, sem reduzir nem
                  arredondar (STL binário, precisão total).
                </span>
              </p>
            )}
            <div className="cv-acoes">
              {atual?.estado === "pronto" && (
                <button ref={botaoStl} type="button" className="cv-botao cv-botao-stl" disabled={ocupado !== null} onClick={() => baixarUm(atual, "stl")}>
                  {ocupado === "stl" ? <><span className="cv-girando" aria-hidden="true" /> {gravandoStl(gravado)}</> : (
                    <span className="cv-botao-duplo">
                      <b>↓ Baixar em STL</b>
                      <small>{nomeDeSaida(atual.nome, "stl")}</small>
                    </span>
                  )}
                </button>
              )}
              {leves.length > 1 && (
                <button type="button" className="cv-botao cv-botao-2" disabled={ocupado !== null} onClick={baixarTodos}>
                  {ocupado === "todos" ? <><span className="cv-girando" aria-hidden="true" /> Montando o ZIP…</> : <>Baixar os {leves.length} em STL (num ZIP)</>}
                </button>
              )}
              {leves.length > 1 && pesadosProntos.length > 0 && <p className="cv-nota cv-fora-do-zip">{foraDoZip(pesadosProntos)}</p>}
              {atual?.estado === "pronto" && !atual.pesado && (
                <button type="button" className="cv-botao-3mf" disabled={ocupado !== null} onClick={() => baixarUm(atual, "3mf")}>
                  {ocupado === "3mf" ? "Gravando o 3MF…" : <>Prefere 3MF? <u>Baixar em 3MF</u></>}
                </button>
              )}
              {atual?.estado === "pronto" && atual.pesado && (
                <>
                  <button type="button" className="cv-botao-3mf" disabled aria-describedby="cv-sem-3mf">Baixar em 3MF</button>
                  <p id="cv-sem-3mf" className="cv-nota">
                    O 3MF fica desligado neste modelo: juntar os vértices, que o 3MF exige, não cabe na memória do navegador num arquivo deste tamanho.
                  </p>
                </>
              )}
            </div>
            <p className="cv-aviso" role="status" aria-live="polite">{aviso}</p>
          </section>

          <section className="cv-fila" aria-label="Arquivos">
            <ul>
              {itens.map((i) => (
                <li key={i.id} data-estado={i.estado} data-atual={i.id === selecionado ? "sim" : "nao"}>
                  <button type="button" className="cv-item" onClick={() => setSelecionado(i.id)} aria-current={i.id === selecionado}>
                    <span className="cv-item-ext">{i.formato?.nome ?? (extensao(i.nome).toUpperCase() || "?")}</span>
                    <span className="cv-item-texto">
                      <span className="cv-item-nome">{i.nome}</span>
                      <span className="cv-item-info">
                        {i.estado === "lendo" && (i.andamento ? `lendo… ${i.andamento.charAt(0).toLowerCase()}${i.andamento.slice(1)}` : "lendo…")}
                        {i.estado === "erro" && (i.dica ? "precisa exportar antes" : "não abriu")}
                        {i.estado === "pronto" && `${formatarBytes(i.tamanho)} · ${formatarInteiro((i.sopa?.length ?? 0) / 9)} triângulos${i.partes && i.partes > 1 ? ` · ${formatarInteiro(i.partes)} partes` : ""}${i.pesado ? " · pesado, sem prévia" : ""}`}
                      </span>
                    </span>
                    <span className="cv-item-sinal" aria-hidden="true" />
                  </button>
                  <button type="button" className="cv-tirar" onClick={() => tirar(i.id)} aria-label={`Tirar ${i.nome}`}>×</button>
                </li>
              ))}
            </ul>
            <label htmlFor={campoId} className="cv-mais">+ Adicionar arquivos</label>
          </section>
        </div>
      )}
      {vazio && aviso && <p className="cv-aviso cv-aviso-solto" role="status">{aviso}</p>}

      {pronto && atual && (
        <div className="cv-barra-celular" data-mostrar={botaoAVista ? "nao" : "sim"} aria-hidden={botaoAVista}>
          <button type="button" className="cv-botao" tabIndex={botaoAVista ? -1 : 0} disabled={ocupado !== null} onClick={() => baixarUm(atual, "stl")}>
            {ocupado === "stl" ? <><span className="cv-girando" aria-hidden="true" /> {gravandoStl(gravado)}</> : (
              <span className="cv-botao-duplo"><b>↓ Baixar em STL</b><small>{nomeDeSaida(atual.nome, "stl")}</small></span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
