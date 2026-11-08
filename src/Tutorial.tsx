import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* O TUTORIAL: abre sozinho na PRIMEIRA visita (e pelo botão "Como usar?" a
   qualquer hora). Primeiro pergunta que arquivo a pessoa tem: quem tem um
   .skp do SketchUp passa antes pelo caminho de exportar (é onde quase todo
   mundo trava: o botão certo é Exportar, não Baixar); depois, os três passos
   do conversor. Esc fecha, setas andam, o foco fica dentro do quadro. */

const CHAVE = "conversor3d:tutorial-visto";
export const ABRIR_TUTORIAL = "conversor3d:abrir-tutorial";

type Caminho = "skp" | "outro";

interface Passo {
  titulo: string;
  texto: ReactNode;
  ilustracao: ReactNode;
}

const PASSOS_SKP: Passo[] = [
  {
    titulo: "O .skp passa primeiro pelo SketchUp",
    texto: (
      <>
        O <b>.skp</b> é um formato fechado: só o SketchUp abre. Mas ele tem uma versão <b>grátis no navegador</b>, sem instalar nada.
        Abra numa aba nova e entre com a sua conta Google:
        <a className="tt-link" href="https://app.sketchup.com" target="_blank" rel="noopener">Abrir o SketchUp grátis ↗</a>
      </>
    ),
    ilustracao: (
      <div className="tt-navegador" aria-hidden="true">
        <div className="tt-barra"><i /><i /><i /><span>app.sketchup.com</span></div>
        <div className="tt-tela"><span className="tt-casinha" /></div>
      </div>
    ),
  },
  {
    titulo: "Abra o seu arquivo lá",
    texto: <>No SketchUp, clique no <b>ícone de pasta</b> (no canto de cima) › <b>Abrir</b> e escolha o seu <b>.skp</b>.</>,
    ilustracao: (
      <div className="tt-menu" aria-hidden="true">
        <span className="tt-pasta" />
        <ul><li data-luz="sim">Abrir…</li><li>Salvar</li><li>Baixar</li><li>Exportar</li></ul>
      </div>
    ),
  },
  {
    titulo: "Exporte em STL",
    texto: (
      <>
        No ícone de pasta de novo: <b>Exportar › STL</b>.
        <span className="tt-alerta">Atenção: é <b>Exportar</b>, não <b>Baixar</b> — o Baixar só devolve o próprio .skp.</span>
      </>
    ),
    ilustracao: (
      <div className="tt-menu" aria-hidden="true">
        <span className="tt-pasta" />
        <ul><li>Abrir…</li><li>Salvar</li><li data-risco="sim">Baixar</li><li data-luz="sim">Exportar › STL</li></ul>
      </div>
    ),
  },
];

const PASSOS_CONVERSOR: Passo[] = [
  {
    titulo: "Solte o arquivo aqui",
    texto: <>Arraste o arquivo para <b>qualquer lugar desta página</b>, ou toque em <b>escolher no aparelho</b>. Pode mandar vários de uma vez. Nada é enviado para a internet.</>,
    ilustracao: (
      <div className="tt-soltar" aria-hidden="true">
        <span className="tt-arquivo">STL</span>
        <span className="tt-caixa" />
      </div>
    ),
  },
  {
    titulo: "Confira a peça",
    texto: <>A peça aparece em 3D: <b>arraste para girar</b>. Embaixo ficam as <b>medidas em milímetros</b>. Se ela parecer minúscula ou gigante, troque a unidade (mm, cm, m, pol); se vier deitada, use os botões de girar.</>,
    ilustracao: (
      <div className="tt-peca" aria-hidden="true">
        <span className="tt-cubo"><i /><i /><i /><i /><i /><i /></span>
        <span className="tt-cota">120 × 80 × 40 mm</span>
      </div>
    ),
  },
  {
    titulo: "Baixe em STL",
    texto: <>O <b>STL já vem escolhido</b> — é o que toda impressora e todo fatiador aceitam. Sai em <b>qualidade máxima</b>: todos os triângulos do arquivo, com a precisão total, nada reduzido.</>,
    ilustracao: (
      <div className="tt-baixar" aria-hidden="true">
        <span className="tt-botao">↓ Baixar peca.stl</span>
        <span className="tt-selo">✓ qualidade máxima</span>
      </div>
    ),
  },
];

function jaViu(): boolean {
  try { return localStorage.getItem(CHAVE) === "1"; } catch { return false; }
}
function marcarVisto() {
  try { localStorage.setItem(CHAVE, "1"); } catch { /* sem armazenamento: o tutorial volta na próxima visita */ }
}

export function Tutorial() {
  const [aberto, setAberto] = useState(false);
  const [caminho, setCaminho] = useState<Caminho | null>(null);
  const [indice, setIndice] = useState(0);
  const quadro = useRef<HTMLDivElement>(null);
  const antes = useRef<HTMLElement | null>(null);

  const abrir = useCallback(() => {
    antes.current = document.activeElement as HTMLElement | null;
    setCaminho(null);
    setIndice(0);
    setAberto(true);
  }, []);

  const fechar = useCallback(() => {
    marcarVisto();
    setAberto(false);
    antes.current?.focus?.();
  }, []);

  /* primeira visita: abre sozinho, um instante depois da página aparecer */
  useEffect(() => {
    if (jaViu()) return;
    const t = setTimeout(abrir, 450);
    return () => clearTimeout(t);
  }, [abrir]);

  useEffect(() => {
    const ouvir = () => abrir();
    window.addEventListener(ABRIR_TUTORIAL, ouvir);
    return () => window.removeEventListener(ABRIR_TUTORIAL, ouvir);
  }, [abrir]);

  const passos = caminho === "skp" ? [...PASSOS_SKP, ...PASSOS_CONVERSOR] : PASSOS_CONVERSOR;
  const total = passos.length;
  const passo = caminho ? passos[indice] : null;
  const ultimo = caminho !== null && indice === total - 1;

  const avancar = useCallback(() => setIndice((i) => Math.min(i + 1, total - 1)), [total]);
  const voltar = useCallback(() => {
    if (indice === 0) setCaminho(null);
    else setIndice((i) => i - 1);
  }, [indice]);

  /* teclado: Esc fecha, setas andam; Tab não sai do quadro */
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
      if (caminho && e.key === "ArrowRight" && !ultimo) avancar();
      if (caminho && e.key === "ArrowLeft") voltar();
      if (e.key === "Tab" && quadro.current) {
        const focaveis = quadro.current.querySelectorAll<HTMLElement>("button, a[href]");
        if (!focaveis.length) return;
        const primeiro = focaveis[0], fim = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); fim.focus(); }
        else if (!e.shiftKey && document.activeElement === fim) { e.preventDefault(); primeiro.focus(); }
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, caminho, ultimo, avancar, voltar, fechar]);

  /* o foco entra no título de cada passo (o leitor de tela lê o passo novo) */
  useEffect(() => {
    if (aberto) quadro.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [aberto, caminho, indice]);

  function comecar() {
    fechar();
    /* o próprio toque abre o seletor de arquivos (o navegador só deixa com um gesto da pessoa) */
    document.querySelector<HTMLInputElement>(".cv-campo")?.click();
  }

  if (!aberto) return null;

  return (
    <div className="tt-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div ref={quadro} className="tt-quadro" role="dialog" aria-modal="true" aria-labelledby="tt-titulo">
        <button type="button" className="tt-fechar" onClick={fechar} aria-label="Fechar o tutorial">×</button>

        {!caminho ? (
          <div className="tt-inicio" key="inicio">
            <span className="tt-onda" aria-hidden="true">👋</span>
            <h2 id="tt-titulo" tabIndex={-1}>Vamos transformar seu arquivo em STL</h2>
            <p>Leva um minuto, e o arquivo não sai do seu aparelho. Para começar: <b>que arquivo você tem?</b></p>
            <div className="tt-escolhas">
              <button type="button" className="tt-escolha" onClick={() => { setCaminho("skp"); setIndice(0); }}>
                <span className="tt-escolha-ext">.skp</span>
                <span><b>Um arquivo do SketchUp</b><small>termina em .skp</small></span>
              </button>
              <button type="button" className="tt-escolha" onClick={() => { setCaminho("outro"); setIndice(0); }}>
                <span className="tt-escolha-ext">.obj</span>
                <span><b>Outro arquivo 3D</b><small>OBJ, FBX, DAE, glTF, 3DS, PLY…</small></span>
              </button>
            </div>
            <button type="button" className="tt-pular" onClick={fechar}>Pular o tutorial</button>
          </div>
        ) : (
          <div className="tt-passo" key={`${caminho}-${indice}`}>
            <div className="tt-ilustracao">{passo!.ilustracao}</div>
            <p className="tt-contador">Passo {indice + 1} de {total}</p>
            <h2 id="tt-titulo" tabIndex={-1}>{passo!.titulo}</h2>
            <div className="tt-texto">{passo!.texto}</div>
            <div className="tt-pontos" aria-hidden="true">
              {passos.map((_, i) => <i key={i} data-atual={i === indice ? "sim" : i < indice ? "feito" : "nao"} />)}
            </div>
            <div className="tt-navegacao">
              <button type="button" className="tt-voltar" onClick={voltar}>← Voltar</button>
              {ultimo ? (
                <button type="button" className="tt-avancar" onClick={comecar}>Escolher meu arquivo</button>
              ) : (
                <button type="button" className="tt-avancar" onClick={avancar}>Próximo →</button>
              )}
            </div>
            {ultimo && <button type="button" className="tt-pular" onClick={fechar}>Fechar e ver a página</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** O botão "Como usar?" do topo: abre o tutorial de novo. */
export function BotaoTutorial() {
  return (
    <button type="button" className="cv-como-usar" onClick={() => window.dispatchEvent(new Event(ABRIR_TUTORIAL))}>
      <span aria-hidden="true">?</span> Como usar
    </button>
  );
}
