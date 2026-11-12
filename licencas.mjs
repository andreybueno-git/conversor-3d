// Gera LICENCAS.txt: o aviso de cada biblioteca que vai dentro do index.html
// (as licenças MIT, ISC e Apache-2.0 pedem que o aviso acompanhe a cópia).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const pacotes = [
  ["openskp", "leitor de .skp do SketchUp", "node_modules/openskp/LICENSE", "licencas/openskp.txt"],
  ["three", "3D e leitores de formatos", "node_modules/three/LICENSE"],
  ["react", "interface", "node_modules/react/LICENSE"],
  ["react-dom", "interface", "node_modules/react-dom/LICENSE"],
  ["scheduler", "interface (parte do React)", "node_modules/scheduler/LICENSE"],
  ["fflate", "descompactar (usado pela OpenSKP e pelo three)", "node_modules/fflate/LICENSE"],
  ["earcut", "triangulação (usado pela OpenSKP)", "node_modules/earcut/LICENSE"],
  ["flatbuffers", "leitura binária (usado pela OpenSKP)", "node_modules/flatbuffers/LICENSE"],
];
/* confere com o que o build.mjs empacotou de verdade (a página E o leitor de .skp em
   segundo plano): pacote no index.html sem aviso aqui é erro, não esquecimento */
const empacotados = JSON.parse(readFileSync("node_modules/.cache/conversor-3d/pacotes.json", "utf8"));
const listados = new Set(pacotes.map(([nome]) => nome));
for (const [onde, lista] of Object.entries(empacotados)) {
  const faltam = lista.filter((p) => !listados.has(p));
  if (faltam.length) throw new Error(`licencas.mjs: ${faltam.join(", ")} entrou no pacote "${onde}" e não tem aviso aqui. Acrescente na lista.`);
}
const noLeitor = new Set(empacotados.leitorSkp);
let saida = "Conversor 3D — avisos das bibliotecas de terceiros incluídas no index.html\n"
  + "(as marcadas com * vão também no leitor de .skp que roda em segundo plano, embutido no mesmo index.html)\n\n";
for (const [nome, uso, ...arquivos] of pacotes) {
  const arquivo = arquivos.find((a) => existsSync(a));
  const pkg = JSON.parse(readFileSync(`node_modules/${nome}/package.json`, "utf8"));
  saida += `${"=".repeat(78)}\n${nome}${noLeitor.has(nome) ? "*" : ""} ${pkg.version} (${pkg.license}) — ${uso}\n${"=".repeat(78)}\n\n${readFileSync(arquivo, "utf8").trim()}\n\n`;
}
saida += `${"=".repeat(78)}\nchevrotain 9.0.1 (Apache-2.0) — leitor de VRML, embutido no three\n${"=".repeat(78)}\n\n`
  + "Copyright (c) 2021 the original author or authors from the Chevrotain project\nCopyright (c) 2015-2020 SAP SE or an SAP affiliate company.\n\n"
  + "Licensed under the Apache License, Version 2.0 — texto completo acima, no aviso do flatbuffers.\n";
writeFileSync("LICENCAS.txt", saida);
console.log(`LICENCAS.txt: ${pacotes.length + 1} bibliotecas`);
