// Gera index.html na raiz (é o que o GitHub Pages serve): um arquivo só, com o
// JavaScript e o CSS dentro. Rode `npm run build` e faça commit do index.html.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
const r = await build({
  entryPoints: ["src/main.tsx"], bundle: true, minify: true, format: "iife", target: "es2020",
  jsx: "automatic", write: false, outdir: "dist", legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = r.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const css = r.outputFiles.find((f) => f.path.endsWith(".css")).text;
const html = readFileSync("index.template.html", "utf8").replace("/*CSS*/", () => css).replace("/*JS*/", () => js);
writeFileSync("index.html", html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB`);
