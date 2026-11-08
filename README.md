# Conversor 3D → STL e 3MF

Página única que converte arquivos 3D para **STL** ou **3MF**, prontos para o
fatiador — **tudo no navegador**: o arquivo não sobe para servidor nenhum.

**Entram:** STL, OBJ, 3MF, PLY, GLB, glTF (+ `.bin`), FBX, DAE (o que o
SketchUp exporta), KMZ, 3DS, AMF, VRML (`.wrl`), USDZ e OFF.
O `.skp` do SketchUp é um formato fechado: a página explica como exportar
(SketchUp para Web: *Baixar › STL*; Pro: *Exportar › Modelo 3D › DAE/OBJ*).

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
npm install
npm run build     # gera o index.html da raiz — faça commit dele
npm test          # 29 testes da malha, dos formatos e da gravação
npx playwright install chromium && npm run e2e   # a página num navegador de verdade
```

| arquivo | o quê |
|---|---|
| `src/main.tsx` | a página: topo, passos, formatos, SketchUp, perguntas |
| `src/Tutorial.tsx`, `src/tutorial.css` | o tutorial da primeira visita e o botão "Como usar" |
| `src/Conversor.tsx` | a tela do conversor: fila, véu de arrastar, ajustes, downloads |
| `src/conversor.css` | o visual |
| `src/formatos.ts` | os formatos aceitos, tetos (300 MB, 5 milhões de triângulos), nomes de saída |
| `src/ler.ts` | os leitores do three.js, um por formato; textura nunca é buscada |
| `src/gltf.ts` | glTF/GLB remontado num GLB só com a forma (junta o `.bin`, decodifica `data:`) |
| `src/off.ts` | o leitor de OFF |
| `src/malha.ts` | giro em passos de 90°, escala para mm, peça centrada e pousada em z = 0, solda dos vértices |
| `src/arquivos.ts` | os gravadores: STL binário, 3MF (ZIP com deflate) e o ZIP de "baixar todos" |
| `src/visor.ts` | a prévia 3D |

Limites conhecidos: glTF comprimido com Draco/meshopt e `.3dm` do Rhino não
abrem (pedem WebAssembly/leitores externos); cores e texturas não vão para o
STL/3MF (só a forma).
