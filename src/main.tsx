import { createRoot } from "react-dom/client";
import { FORMATOS } from "./formatos";
import { Conversor } from "./Conversor";
import { BotaoTutorial, Tutorial } from "./Tutorial";
import "./conversor.css";
import "./tutorial.css";

/* A PÁGINA: o topo, o conversor e as explicações. Um HTML só, sem servidor:
   o arquivo de quem converte não sai do aparelho. */

const PERGUNTAS: { p: string; r: string }[] = [
  {
    p: "Meu arquivo é enviado para algum lugar?",
    r: "Não. A leitura e a conversão acontecem no seu navegador, com o poder do seu próprio aparelho. Nada sobe para a internet — dá até para desligar o Wi-Fi depois que a página abriu.",
  },
  {
    p: "STL ou 3MF: qual escolher?",
    r: "O 3MF é o formato moderno: guarda a unidade (milímetro), sai menor e abre direto no Bambu Studio, PrusaSlicer, OrcaSlicer e Cura. O STL é o mais antigo e o mais aceito — se o programa for velho ou você não souber, vá de STL.",
  },
  {
    p: "Por que a peça ficou minúscula (ou gigante)?",
    r: "Alguns formatos não dizem a unidade. glTF e DAE vêm em metros, FBX costuma vir em centímetros, e um OBJ pode vir em qualquer uma. Confira as medidas embaixo da prévia e troque a unidade até bater com o tamanho real.",
  },
  {
    p: "A peça veio deitada. E agora?",
    r: "Programas de animação usam o Y para cima; impressoras, o Z. Os formatos que costumam vir assim já entram em pé, mas, se não acertar, use os botões de girar: cada toque gira 90° e a prévia mostra o resultado na hora.",
  },
  {
    p: "As cores e texturas vêm junto?",
    r: "Não: STL e 3MF levam a forma da peça, que é o que a impressora precisa. Cor e textura ficam no arquivo original.",
  },
  {
    p: "Tem limite de tamanho?",
    r: "Até 300 MB e 5 milhões de triângulos por arquivo, para a aba do navegador não travar. Num celular, arquivos muito grandes podem demorar alguns segundos.",
  },
];

function Pagina() {
  return (
    <main className="cv-pagina">
      <header className="cv-topo">
        <p className="cv-selo">Grátis · sem cadastro · sem enviar nada</p>
        <h1 className="cv-titulo">
          Converta seus arquivos 3D para <span className="cv-destaque">STL</span> e <span className="cv-destaque">3MF</span>
        </h1>
        <p className="cv-sub">
          OBJ, FBX, glTF, DAE do SketchUp, 3DS, PLY e mais — com prévia 3D, medidas em milímetro e a peça já em pé na mesa.
          Tudo no seu navegador: o arquivo não sai do seu aparelho.
        </p>
        <BotaoTutorial />
      </header>

      <Conversor />

      <section className="cv-secao" aria-labelledby="cv-como">
        <h2 id="cv-como" className="cv-h2">Três passos, nenhum programa</h2>
        <ol className="cv-passos">
          <li><span className="cv-passo-n">1</span><b>Solte o arquivo</b><span>Arraste para qualquer lugar da página, ou escolha no aparelho. Vários de uma vez.</span></li>
          <li><span className="cv-passo-n">2</span><b>Confira na prévia</b><span>Gire a peça com o dedo, veja as medidas em mm e acerte a unidade e a posição.</span></li>
          <li><span className="cv-passo-n">3</span><b>Baixe em STL</b><span>O botão grande baixa em STL, em qualidade máxima, sem reduzir nada. Vários de uma vez saem num ZIP; o 3MF também está lá, se preferir.</span></li>
        </ol>
      </section>

      <section className="cv-secao" aria-labelledby="cv-formatos">
        <h2 id="cv-formatos" className="cv-h2">Os formatos que entram</h2>
        <ul className="cv-formatos">
          {FORMATOS.map((f) => (
            <li key={f.ext}><b>.{f.ext}</b><span>{f.origem}</span></li>
          ))}
        </ul>
        <p className="cv-nota-larga">
          No glTF com o <code>.bin</code> separado, selecione os dois arquivos de uma vez. Modelos comprimidos com Draco ou meshopt não abrem aqui.
        </p>
      </section>

      <section className="cv-secao cv-skp" aria-labelledby="cv-sketchup">
        <div>
          <h2 id="cv-sketchup" className="cv-h2">E o SketchUp (.skp)?</h2>
          <p>
            O <code>.skp</code> é um formato fechado: só o próprio SketchUp o lê por inteiro. Mas ele exporta em dois cliques, e daí
            a conversão é aqui:
          </p>
        </div>
        <ol className="cv-skp-passos">
          <li>
            <b>Não tem o SketchUp?</b> Abra o <a href="https://app.sketchup.com" target="_blank" rel="noopener">SketchUp para Web</a>{" "}
            (grátis, entra com a conta Google) e, no ícone de pasta, abra o seu <code>.skp</code>.
          </li>
          <li>
            No ícone de pasta de novo: <i>Exportar</i> › <i>STL</i> — atenção, é <i>Exportar</i>, não <i>Baixar</i> (o Baixar só devolve o .skp).
            No SketchUp Pro: <i>Arquivo</i> › <i>Exportar</i> › <i>Modelo 3D</i> › <i>STL</i>, <i>DAE</i> ou <i>OBJ</i>.
          </li>
          <li>Solte o arquivo exportado aqui para conferir as medidas, acertar a unidade e baixar em 3MF ou STL.</li>
        </ol>
      </section>

      <section className="cv-secao" aria-labelledby="cv-perguntas">
        <h2 id="cv-perguntas" className="cv-h2">Perguntas</h2>
        <div className="cv-perguntas">
          {PERGUNTAS.map((q) => (
            <details key={q.p}>
              <summary>{q.p}</summary>
              <p>{q.r}</p>
            </details>
          ))}
        </div>
      </section>

      <Tutorial />

      <footer className="cv-rodape">
        Conversor 3D · feito com <a href="https://threejs.org">three.js</a> · o seu arquivo nunca sai do seu aparelho
      </footer>
    </main>
  );
}

createRoot(document.getElementById("raiz")!).render(<Pagina />);
