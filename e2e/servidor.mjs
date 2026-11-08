// Serve o index.html como o GitHub Pages serviria, mas com uma CSP fechada: prova que a
// página não busca nada fora (nem textura, nem buffer) durante a conversão.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; worker-src 'self'";
createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
  res.end(readFileSync(new URL("../index.html", import.meta.url)));
}).listen(Number(process.env.PORTA ?? 4321));
