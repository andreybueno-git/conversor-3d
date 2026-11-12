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
    r: "O arquivo pode ter até 300 MB. Não há teto de triângulos: acima de 5 milhões, a prévia 3D fica desligada para caber na memória, e o STL sai completo mesmo assim (o 3MF e o ZIP ficam para os menores). Arquivo grande pode levar mais de um minuto para ler — vai melhor no Chrome do computador, com as outras abas fechadas. Se a memória do navegador acabar, a tela avisa e mostra outro caminho.",
  },
];

function Pagina() {
  return (
    <main className="cv-pagina">
      <header className="cv-topo">
        <p className="cv-selo">Grátis · sem cadastro · sem enviar nada</p>
        <h1 className="cv-titulo">
          Converta seu arquivo 3D para <span className="cv-destaque">STL</span>
        </h1>
        <p className="cv-sub">
          SketchUp (.skp), OBJ, FBX, glTF, DAE, 3DS, PLY e mais viram STL pronto para imprimir, em qualidade máxima — com prévia 3D e
          medidas em milímetro. Funciona no celular, e o arquivo não sai do seu aparelho.
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
          <h2 id="cv-sketchup" className="cv-h2">Tem um arquivo do SketchUp (.skp)?</h2>
          <p>
            Pode mandar direto: o conversor lê o <code>.skp</code> do SketchUp 2013 até os de hoje — com componentes e grupos — e
            entrega o STL aqui mesmo, sem instalar nada e sem passar por outro site.
          </p>
        </div>
        <ol className="cv-skp-passos">
          <li>Toque na caixa lá em cima e escolha o seu <code>.skp</code> (ou arraste para a página, no computador).</li>
          <li>Confira a peça e as medidas na prévia. Se o tamanho estiver estranho, troque a unidade.</li>
          <li>Toque em <b>Baixar em STL</b>. Pronto.</li>
        </ol>
        <p className="cv-skp-plano-b">
          <b>Se algum .skp não abrir</b> (arquivo danificado ou de uma versão muito nova): abra no{" "}
          <a href="https://app.sketchup.com" target="_blank" rel="noopener">SketchUp grátis no navegador</a>, ícone de pasta ›{" "}
          <i>Exportar</i> › <i>STL</i> (é <i>Exportar</i>, não <i>Baixar</i>) e solte o STL aqui.
        </p>
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
        Conversor 3D · feito com <a href="https://threejs.org">three.js</a> e{" "}
        <a href="https://github.com/iamahsanmehmood/openskp">OpenSKP</a> · o seu arquivo nunca sai do seu aparelho ·{" "}
        <a href="LICENCAS.txt">licenças</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("raiz")!).render(<Pagina />);
