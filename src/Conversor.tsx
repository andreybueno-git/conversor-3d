"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ACEITA, COMPANHEIROS, MAX_BYTES, MAX_TRIANGULOS, ROTULO_DA_UNIDADE, SEM_LEITOR, extensao, formatarBytes, formatarInteiro, formatarMm,
  formatoDe, nomeDeSaida, nomesUnicos, type Formato, type Saida, type Unidade,
} from "./formatos";
import { SEM_GIRO, Y_PARA_Z, caixaDe, girar, medidasDe, medidasNaMesa, prepararParaMesa, unidadeProvavel, type Giro } from "./malha";
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
  /** as medidas da caixa do arquivo, na unidade dele */
  bruto?: [number, number, number];
  unidade: Unidade;
  giro: Giro;
}

const UNIDADES: Unidade[] = ["mm", "cm", "m", "pol"];
/* STL primeiro e escolhido de saída: é o que todo fatiador e toda impressora aceitam */
const SAIDAS: { id: Saida; nome: string; nota: string }[] = [
  { id: "stl", nome: "STL", nota: "abre em qualquer fatiador" },
  { id: "3mf", nome: "3MF", nota: "moderno, em mm, menor" },
];

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

export function Conversor() {
  const [itens, setItens] = useState<Item[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [saida, setSaida] = useState<Saida>("stl");
  const [arrastando, setArrastando] = useState(false);
  const [ocupado, setOcupado] = useState<null | "um" | "todos">(null);
  const [aviso, setAviso] = useState("");
  const [sem3d, setSem3d] = useState(false);
  const [com3d, setCom3d] = useState(false);
  const campoId = useId();
  const campo = useRef<HTMLInputElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const visor = useRef<Visor | null>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());

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
    setItens((lista) => [...lista, ...novos]);
    const primeiroBom = novos.find((n) => n.estado === "lendo") ?? novos[0];
    if (primeiroBom) setSelecionado(primeiroBom.id);

    /* um de cada vez, na ordem: dois leitores juntos dobram a memória da aba */
    for (const item of novos) {
      if (item.estado !== "lendo") continue;
      const arquivo = modelos.find((m) => m.name === item.nome)!;
      fila.current = fila.current.then(async () => {
        try {
          await respirar();
          const [{ lerModelo }, dados, extras] = await Promise.all([
            import("./ler"),
            arquivo.arrayBuffer(),
            Promise.all(companheiros.map(async (c) => ({ nome: c.name, dados: await c.arrayBuffer() }))),
          ]);
          const lido = await lerModelo({ nome: arquivo.name, dados }, extras);
          if (lido.sopa.length / 9 > MAX_TRIANGULOS) {
            mudar(item.id, { estado: "erro", erro: `São ${formatarInteiro(lido.sopa.length / 9)} triângulos; o teto aqui é ${formatarInteiro(MAX_TRIANGULOS)}. Reduza a malha (no Blender: modificador Decimate).` });
            return;
          }
          const bruto = medidasDe(caixaDe(lido.sopa));
          const unidade = unidadeProvavel(Math.max(...bruto), item.unidade);
          mudar(item.id, { estado: "pronto", sopa: lido.sopa, partes: lido.partes, bruto, unidade });
        } catch (e) {
          mudar(item.id, { estado: "erro", erro: e instanceof Error ? e.message : "Não consegui ler este arquivo." });
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

  /* ── o 3D: nasce com o primeiro modelo pronto; sem WebGL, a tela segue sem ele ── */
  const temPronto = atual?.estado === "pronto";
  useEffect(() => {
    if (!temPronto || visor.current || sem3d || !palco.current) return;
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
  }, [temPronto, sem3d]);

  const vazio = itens.length === 0;
  useEffect(() => () => { visor.current?.destruir(); visor.current = null; }, []);

  useEffect(() => {
    if (!com3d || !visor.current || atual?.estado !== "pronto" || !atual.sopa) return;
    const { posicoes, medidas } = prepararParaMesa(atual.sopa, atual.unidade, atual.giro);
    visor.current.mostrar(posicoes, medidas);
  }, [atual, com3d]);

  /* ── baixar ── */
  async function converterUm(item: Item, nome: string) {
    const { converter, TIPO_MIME } = await import("./gravar");
    const r = await converter(item.sopa!, { unidade: item.unidade, giro: item.giro, saida, titulo: nome.replace(/\.[^.]+$/, "") });
    return { bytes: r.bytes, tipo: TIPO_MIME[saida] };
  }

  async function baixarUm(item: Item) {
    setOcupado("um");
    try {
      await respirar();
      const nome = nomeDeSaida(item.nome, saida);
      const { bytes, tipo } = await converterUm(item, nome);
      baixar([bytes as BlobPart], nome, tipo);
      setAviso(`${nome} pronto, ${formatarBytes(bytes.length)}.`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui gravar o arquivo.");
    } finally {
      setOcupado(null);
    }
  }

  async function baixarTodos() {
    setOcupado("todos");
    try {
      await respirar();
      const { gravarZip } = await import("./arquivos");
      const nomes = nomesUnicos(prontos.map((i) => nomeDeSaida(i.nome, saida)));
      const arquivos = [];
      for (const [k, item] of prontos.entries()) {
        arquivos.push({ nome: nomes[k], dados: (await converterUm(item, nomes[k])).bytes });
      }
      const zip = gravarZip(arquivos);
      baixar([zip as BlobPart], `convertidos-${saida}.zip`, "application/zip");
      setAviso(`${arquivos.length} arquivos num ZIP, ${formatarBytes(zip.length)}.`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui montar o ZIP.");
    } finally {
      setOcupado(null);
    }
  }

  function tirar(id: number) {
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
          <span className="cv-soltar-titulo">Solte seus arquivos 3D aqui</span>
          <span className="cv-soltar-sub">ou <span className="cv-link">escolha no aparelho</span> · vários de uma vez</span>
          <span className="cv-soltar-pe">
            <span className="cv-cadeado" aria-hidden="true" /> O arquivo não sai do seu aparelho: a conversão é feita aqui, no navegador.
          </span>
        </label>
      ) : (
        <div className="cv-mesa">
          <section className="cv-palco" aria-label="Prévia 3D">
            <div ref={palco} className="cv-palco-quadro" data-estado={atual?.estado ?? "vazio"}>
              {atual?.estado === "lendo" && (
                <div className="cv-palco-aviso"><span className="cv-girando" aria-hidden="true" />Lendo {atual.nome}…</div>
              )}
              {atual?.estado === "erro" && (
                <div className="cv-palco-aviso cv-palco-erro">
                  <strong>{atual.dica ? "Este formato precisa de um passo antes" : "Este não deu"}</strong>
                  <span>{atual.erro}</span>
                </div>
              )}
              {atual?.estado === "pronto" && sem3d && (
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
            {atual?.estado === "pronto" && <p className="cv-dica-gesto">Arraste para girar · pinça ou roda para aproximar</p>}
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
                  <p className="cv-nota">Confira as medidas na prévia: se a peça parecer minúscula ou gigante, troque a unidade.</p>
                </div>

                <div className="cv-grupo">
                  <h2 className="cv-rotulo">Posição na mesa</h2>
                  <div className="cv-giros">
                    {(["x", "y", "z"] as const).map((eixo) => (
                      <button key={eixo} type="button" className="cv-giro" onClick={() => mudar(atual.id, { giro: girar(atual.giro, eixo) })}>
                        <span aria-hidden="true" className="cv-giro-seta">↻</span> Girar em {eixo.toUpperCase()}
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

            <div className="cv-grupo">
              <h2 className="cv-rotulo">Converter para</h2>
              <div className="cv-saidas" role="radiogroup" aria-label="Formato de saída" data-saida={saida}>
                <span className="cv-saidas-pilula" aria-hidden="true" />
                {SAIDAS.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={saida === s.id} className="cv-saida" onClick={() => setSaida(s.id)}>
                    <b>{s.nome}</b><small>{s.nota}</small>
                  </button>
                ))}
              </div>
            </div>

            {atual?.estado === "pronto" && (
              <p className="cv-qualidade">
                <span className="cv-qualidade-selo" aria-hidden="true">✓</span>
                <span>
                  <b>Qualidade máxima</b> — os {formatarInteiro((atual.sopa?.length ?? 0) / 9)} triângulos do arquivo, sem reduzir nem
                  arredondar{saida === "stl" ? " (STL binário, precisão total)" : " (3MF com a precisão total do arquivo)"}.
                </span>
              </p>
            )}
            <div className="cv-acoes">
              {atual?.estado === "pronto" && (
                <button type="button" className="cv-botao" disabled={ocupado !== null} onClick={() => baixarUm(atual)}>
                  {ocupado === "um" ? <><span className="cv-girando" aria-hidden="true" /> Gravando…</> : <>Baixar {nomeDeSaida(atual.nome, saida)}</>}
                </button>
              )}
              {prontos.length > 1 && (
                <button type="button" className="cv-botao cv-botao-2" disabled={ocupado !== null} onClick={baixarTodos}>
                  {ocupado === "todos" ? <><span className="cv-girando" aria-hidden="true" /> Montando o ZIP…</> : <>Baixar os {prontos.length} em ZIP</>}
                </button>
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
                        {i.estado === "lendo" && "lendo…"}
                        {i.estado === "erro" && (i.dica ? "precisa exportar antes" : "não abriu")}
                        {i.estado === "pronto" && `${formatarBytes(i.tamanho)} · ${formatarInteiro((i.sopa?.length ?? 0) / 9)} triângulos${i.partes && i.partes > 1 ? ` · ${i.partes} partes` : ""}`}
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
    </div>
  );
}
