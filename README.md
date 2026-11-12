# Conversor 3D → STL

Página única que converte arquivos 3D — **inclusive o `.skp` do SketchUp** —
para **STL** (e 3MF, se preferir), prontos para o fatiador. **Tudo no
navegador, inclusive no celular**: o arquivo não sobe para servidor nenhum.

**Entram:** SKP (SketchUp 2013 até os de hoje), STL, OBJ, 3MF, PLY, GLB, glTF
(+ `.bin`), FBX, DAE, KMZ, 3DS, AMF, VRML (`.wrl`), USDZ e OFF.

O `.skp` é lido pela [OpenSKP](https://github.com/iamahsanmehmood/openskp)
(MIT, engenharia reversa do formato; não é da Trimble/SketchUp), com cada face
uma vez só (`frontSideOnly`: sem a cópia invertida que estragaria o STL). Se
algum `.skp` não abrir, a tela mostra o plano B: SketchUp grátis no navegador ›
*Exportar* › *STL* (é *Exportar*, não *Baixar*).

O `.skp` é lido **em segundo plano** (um Web Worker embutido no próprio
`index.html`, por uma URL `blob:`): a página não congela durante a leitura e
mostra o andamento que a OpenSKP informa. O arquivo vai para o leitor e a malha
volta sem cópia, e o leitor é encerrado ao terminar — é o que devolve a memória
da leitura (num `.skp` de 211 MB, ~3,6 GB). Se o navegador não deixar criar o
leitor (navegador antigo, ou uma CSP que barra `blob:`), lê na página mesmo,
como antes. Os outros formatos são lidos na página (vários leitores do three
usam `DOMParser`, que não existe no Worker).

**Arquivo pesado converte.** Não há teto de triângulos. Acima de 5 milhões
(`LIMIAR_MODO_PESADO`), o item entra no **modo pesado**: sem prévia 3D (ela
faria mais uma cópia da malha), com um aviso no lugar dela; medidas, unidade e
giro continuam valendo; o STL sai **completo**, gravado em partes (o mesmo
arquivo, byte a byte, sem uma segunda cópia da malha nem um bloco do tamanho do
arquivo — há teste); o 3MF fica desligado nele (juntar os vértices não cabe na
memória) e ele fica fora do ZIP de "baixar todos" (a tela diz isso). O teto que
continua é o do arquivo: 300 MB. Arquivo de 50 MB ou mais avisa, durante a
leitura, que pode passar de um minuto; se a memória do navegador acabar e a
página sobreviver (o Safari e o Firefox costumam sobreviver), a tela diz
"pesado demais para este navegador" (com o plano B do SketchUp, no `.skp`) em
vez de "arquivo danificado". No Chrome, quando a memória acaba de vez, quem cai
é a aba inteira, e aí não há aviso que a página possa dar — o FAQ diz isso.

Medido em 12/11 com um `.skp` real de 211 MB (SketchUp 2023, 6.190.607
triângulos): no Chrome do computador, a página segue respondendo durante a
leitura e o STL sai com todos os triângulos. O Safari não foi testado com esse
arquivo.

**Como funciona:** solte um ou vários arquivos em qualquer lugar da página →
confira na prévia 3D (gira com o dedo, mostra largura × profundidade × altura
em mm), acerte a unidade (mm, cm, m, pol) e a posição (girar 90° em X/Y/Z) →
baixe em **STL (o padrão)** ou 3MF, um por vez ou todos num ZIP.

**Tutorial:** na primeira visita abre um passo a passo que pergunta que arquivo
a pessoa tem. Quem tem `.skp` é levado pelo SketchUp grátis no navegador
(abrir › **Exportar** › STL — não "Baixar") antes dos passos do conversor.
O botão "Como usar" do topo o abre de novo.

**Qualidade:** nada é reduzido nem arredondado. O STL é binário com todos os
triângulos do arquivo; o 3MF guarda cada coordenada com 9 algarismos (volta ao
mesmo número exato). Há teste que confere as duas coisas.

## Publicar no GitHub Pages

O site é só o `index.html` da raiz (JavaScript e CSS já dentro). Em
**Settings › Pages › Build and deployment**, escolha *Deploy from a branch*,
branch `main`, pasta `/ (root)`. O link fica
`https://<usuário>.github.io/<repositório>/`.

## Mexer no código

```bash
npm install --legacy-peer-deps   # o npm 10/11 tropeça nos "peers" opcionais do vitest sem isso
npm run build     # gera o index.html e o LICENCAS.txt da raiz — faça commit dos dois
npm test          # 57 testes: malha, formatos, gravação (inclusive em partes) e 6 .skp reais (2013 a 2021)
npx playwright install chromium && npm run e2e   # a página num navegador de verdade (o modo pesado gera um STL de 250 MB temporário, só no desktop)
```

| arquivo | o quê |
|---|---|
| `src/main.tsx` | a página: topo, passos, formatos, SketchUp, perguntas |
| `src/Tutorial.tsx`, `src/tutorial.css` | o tutorial da primeira visita e o botão "Como usar" |
| `src/Conversor.tsx` | a tela do conversor: fila, véu de arrastar, ajustes, downloads |
| `src/conversor.css` | o visual |
| `src/formatos.ts` | os formatos aceitos, o teto de 300 MB, o limiar do modo pesado (5 milhões de triângulos), o aviso de arquivo grande (50 MB), nomes de saída |
| `src/ler.ts` | os leitores do three.js, um por formato; textura nunca é buscada |
| `src/skp.ts` | o leitor do `.skp` (OpenSKP), sem three |
| `src/leitor-skp.worker.ts`, `src/leitorSkp.ts` | o leitor de `.skp` em segundo plano (Web Worker) e quem o liga, com a queda para a página |
| `src/erros.ts` | o erro de leitura e a falta de memória ("pesado demais para este navegador") |
| `src/gravar.ts` | a conversão, e o STL gravado em partes do modo pesado |
| `src/gltf.ts` | glTF/GLB remontado num GLB só com a forma (junta o `.bin`, decodifica `data:`) |
| `src/off.ts` | o leitor de OFF |
| `src/malha.ts` | giro em passos de 90°, escala para mm, peça centrada e pousada em z = 0, solda dos vértices |
| `src/arquivos.ts` | os gravadores: STL binário, 3MF (ZIP com deflate) e o ZIP de "baixar todos" |
| `src/visor.ts` | a prévia 3D |

Limites conhecidos: glTF comprimido com Draco/meshopt e `.3dm` do Rhino não
abrem (pedem WebAssembly/leitores externos); cores e texturas não vão para o
STL/3MF (só a forma).

## Licenças

O `index.html` leva dentro bibliotecas de terceiros (OpenSKP, three.js, React,
fflate, earcut, flatbuffers, chevrotain). A OpenSKP e as que ela usa vão duas
vezes: na página e no leitor de `.skp` em segundo plano (marcadas com `*`). Os
avisos de cada uma estão em [`LICENCAS.txt`](LICENCAS.txt), gerado pelo
`npm run build` e linkado no rodapé; o `licencas.mjs` confere a lista contra o
que o esbuild empacotou de verdade nos dois pacotes e falha se faltar algum aviso.
Os `.skp` de `e2e/skp/` vêm do repositório da OpenSKP (MIT).
