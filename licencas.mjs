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
let saida = "Conversor 3D — avisos das bibliotecas de terceiros incluídas no index.html\n\n";
for (const [nome, uso, ...arquivos] of pacotes) {
  const arquivo = arquivos.find((a) => existsSync(a));
  const pkg = JSON.parse(readFileSync(`node_modules/${nome}/package.json`, "utf8"));
  saida += `${"=".repeat(78)}\n${nome} ${pkg.version} (${pkg.license}) — ${uso}\n${"=".repeat(78)}\n\n${readFileSync(arquivo, "utf8").trim()}\n\n`;
}
saida += `${"=".repeat(78)}\nchevrotain 9.0.1 (Apache-2.0) — leitor de VRML, embutido no three\n${"=".repeat(78)}\n\n`
  + "Copyright (c) 2021 the original author or authors from the Chevrotain project\nCopyright (c) 2015-2020 SAP SE or an SAP affiliate company.\n\n"
  + "Licensed under the Apache License, Version 2.0 — texto completo acima, no aviso do flatbuffers.\n";
writeFileSync("LICENCAS.txt", saida);
console.log(`LICENCAS.txt: ${pacotes.length + 1} bibliotecas`);
