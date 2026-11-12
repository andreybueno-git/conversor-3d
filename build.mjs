// Gera index.html na raiz (é o que o GitHub Pages serve): um arquivo só, com o
// JavaScript e o CSS dentro. Rode `npm run build` e faça commit do index.html.
//
// São dois pacotes: o leitor de .skp que roda em segundo plano (Web Worker,
// src/leitor-skp.worker.ts) e a página. O do leitor entra na página como
// TEXTO (__LEITOR_SKP__), e a página o liga por uma URL blob: — continua
// sendo um arquivo só, sem nada para buscar. Os pacotes de terceiros dos dois
// vão para node_modules/.cache, onde o licencas.mjs confere se cada um tem o
// seu aviso no LICENCAS.txt.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const comum = { bundle: true, minify: true, target: "es2020", write: false, outdir: "dist", legalComments: "eof", metafile: true };
const leitor = await build({ ...comum, entryPoints: ["src/leitor-skp.worker.ts"], format: "iife" });
const codigoDoLeitor = leitor.outputFiles.find((f) => f.path.endsWith(".js")).text;
const r = await build({
  ...comum, entryPoints: ["src/main.tsx"], format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', __LEITOR_SKP__: JSON.stringify(codigoDoLeitor) },
});
const js = r.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const css = r.outputFiles.find((f) => f.path.endsWith(".css")).text;
const html = readFileSync("index.template.html", "utf8").replace("/*CSS*/", () => css).replace("/*JS*/", () => js);
writeFileSync("index.html", html);

/* os pacotes de node_modules que entraram em cada pacote (o nome vem do caminho) */
const pacotesDe = (meta) => [...new Set(Object.keys(meta.inputs)
  .map((c) => c.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
mkdirSync("node_modules/.cache/conversor-3d", { recursive: true });
writeFileSync("node_modules/.cache/conversor-3d/pacotes.json", JSON.stringify({
  pagina: pacotesDe(r.metafile), leitorSkp: pacotesDe(leitor.metafile),
}, null, 2));
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB (o leitor de .skp em segundo plano: ${(codigoDoLeitor.length / 1024).toFixed(0)} KB dele)`);
