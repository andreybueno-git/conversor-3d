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
npm test          # 36 testes: malha, formatos, gravação e 6 .skp reais (2013 a 2021)
npx playwright install chromium && npm run e2e   # a página num navegador de verdade
```

| arquivo | o quê |
|---|---|
| `src/main.tsx` | a página: topo, passos, formatos, SketchUp, perguntas |
| `src/Tutorial.tsx`, `src/tutorial.css` | o tutorial da primeira visita e o botão "Como usar" |
| `src/Conversor.tsx` | a tela do conversor: fila, véu de arrastar, ajustes, downloads |
| `src/conversor.css` | o visual |
| `src/formatos.ts` | os formatos aceitos, tetos (300 MB, 5 milhões de triângulos), nomes de saída |
| `src/ler.ts` | os leitores do three.js, um por formato, e o do `.skp` (OpenSKP); textura nunca é buscada |
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
fflate, earcut, flatbuffers, chevrotain). Os avisos de cada uma estão em
[`LICENCAS.txt`](LICENCAS.txt), gerado pelo `npm run build` e linkado no rodapé.
Os `.skp` de `e2e/skp/` vêm do repositório da OpenSKP (MIT).
