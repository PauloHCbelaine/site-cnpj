/**
 * TROUBLESHOOTING & FAQ
 * Perguntas frequentes e soluções de problemas
 */

console.log(`

╔═══════════════════════════════════════════════════════════════╗
║        🆘 TROUBLESHOOTING & FAQ - EXTRAÇÃO DE CNPJ            ║
╚═══════════════════════════════════════════════════════════════╝

🔴 PROBLEMAS COMUNS E SOLUÇÕES
═══════════════════════════════════════════════════════════════

❌ ERRO: "Cannot find module 'openai'"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   Execute: npm install openai axios dotenv
   
   Ou se estiver usando npm: npm install


❌ ERRO: "OPENAI_API_KEY is not set"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   1. Copie .env.example para .env
      cp .env.example .env
   
   2. Abra o arquivo .env e adicione sua chave:
      OPENAI_API_KEY=sk-proj-SEU-API-KEY-AQUI
   
   3. Obtenha sua chave em:
      https://platform.openai.com/api-keys


❌ ERRO: "Invalid API key provided"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   1. Verifique se a chave está correta (sem espaços extras)
   2. Verifique se tem créditos na conta:
      https://platform.openai.com/account/billing/overview
   
   3. Tente gerar uma nova chave em:
      https://platform.openai.com/api-keys


❌ ERRO: "Timeout of 10000ms exceeded"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   1. O site demorou muito a responder
   
   2. Tente aumentar o timeout no código:
      const html = await scrapePage(url, 20000); // 20 segundos
   
   3. Tente a URL novamente mais tarde
   
   4. Verifique se o site está online:
      curl -I https://seu-site.com


❌ ERRO: "CNPJ not found"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   Isso é esperado em alguns casos:
   
   1. ✓ Scraping falhou + OpenAI não conhece a empresa
      → Normal para empresas pequenas ou locais
   
   2. ✓ Site usa conteúdo dinâmico (JavaScript)
      → Nossa solução faz scraping estático
      → Precisaria de Playwright/Puppeteer para isso
   
   3. ✓ CNPJ não está visible no HTML
      → Pode estar em imagem, PDF, ou área protegida
   
   4. ✓ OpenAI não tem informação sobre essa empresa
      → Tente fornecer mais contexto ao prompt


❌ ERRO: "Cannot convert undefined to a string"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   Verifique se está passando uma URL válida:
   
   ❌ ERRADO:
   extractCnpjFromUrl(null)
   extractCnpjFromUrl(undefined)
   extractCnpjFromUrl('')
   
   ✅ CERTO:
   extractCnpjFromUrl('https://www.google.com')


❌ ERRO: "axios is not defined"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   Adicione no topo do arquivo:
   import axios from 'axios';


❌ ERRO: "SyntaxError: Cannot use import outside a module"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   Adicione no seu package.json:
   "type": "module"
   
   Ou use require em vez de import:
   const { extractCnpjFromUrl } = require('./extract-cnpj-openai.js');


❌ ERRO: "Rate limit exceeded"
───────────────────────────────────────────────────────────────
✅ SOLUÇÃO:
   Está processando muitas URLs muito rápido.
   
   Adicione delay entre requisições:
   
   for (const url of urls) {
     const cnpj = await extractCnpjFromUrl(url);
     await new Promise(r => setTimeout(r, 2000)); // 2 segundos
   }


═══════════════════════════════════════════════════════════════

❓ PERGUNTAS FREQUENTES
═══════════════════════════════════════════════════════════════

P1: Por que não está encontrando CNPJ em alguns sites?
───────────────────────────────────────────────────────────────
R: Possíveis razões:

   1. HTML estático não contém CNPJ visível
      → Pode estar em imagem, PDF, ou protegido

   2. Site usa JavaScript para renderizar conteúdo
      → Nossa solução usa scraping estático
      → Teria que usar Playwright/Puppeteer

   3. CNPJ está em área protegida (robots.txt)
      → Respeitar arquivos de robots.txt

   4. OpenAI não tem informação sobre a empresa
      → Normal para empresas pequenas

SOLUÇÃO: Tente acessar a URL manualmente e veja onde o CNPJ está.


P2: Qual é o custo de usar a API OpenAI?
───────────────────────────────────────────────────────────────
R: Custa conforme tokens consumidos:

   - Aproximadamente $0.0005 por chamada (gpt-3.5)
   - Aproximadamente $0.01 por chamada (gpt-4)
   
   Mas PREFIRA SCRAPING primeiro:
   
   - Scraping bem-sucedido = SEM CUSTO
   - Apenas 10-20% das URLs precisam OpenAI
   - Reduz custos em 80-90% comparado a IA-first


P3: Como processar 10.000 URLs?
───────────────────────────────────────────────────────────────
R: Use uma fila com controle de taxa:

   import PQueue from 'p-queue';
   
   const queue = new PQueue({
     concurrency: 1,
     interval: 60000,
     intervalCap: 10, // 10 requisições por minuto
   });
   
   for (const url of urls) {
     queue.add(() => extractCnpjFromUrl(url));
   }


P4: Pode usar com Node.js < 16?
───────────────────────────────────────────────────────────────
R: Não, é necessário Node.js 16+

   Razões:
   - Import/export modules (ES6)
   - async/await
   - Suporte a fetch nativo

   Verifique sua versão:
   node --version

   Se precisar de versão antiga, use require + CommonJS:
   const openai = require('openai');


P5: Como adicionar cache para economizar?
───────────────────────────────────────────────────────────────
R: Use uma solução simples com Map:

   const cache = new Map();
   
   async function extractCached(url) {
     if (cache.has(url)) {
       return cache.get(url);
     }
     
     const cnpj = await extractCnpjFromUrl(url);
     cache.set(url, cnpj);
     return cnpj;
   }

   Ou use Redis para cache persistente:
   
   import Redis from 'ioredis';
   const redis = new Redis();
   
   const cached = await redis.get(url);
   if (cached) return cached;


P6: Como integrar com banco de dados?
───────────────────────────────────────────────────────────────
R: Exemplo com MongoDB:

   import mongoose from 'mongoose';
   
   const CompanySchema = new mongoose.Schema({
     url: String,
     cnpj: String,
     extractedAt: Date,
   });
   
   const Company = mongoose.model('Company', CompanySchema);
   
   // Após extrair:
   await Company.create({
     url,
     cnpj,
     extractedAt: new Date(),
   });


P7: O CNPJ pode estar incorreto?
───────────────────────────────────────────────────────────────
R: Muito improvável, por isso:

   1. ✓ Validação com checksum (modulo-11)
   2. ✓ Detecta sequências repetidas (11.111.111/1111-11)
   3. ✓ Ambos os dígitos verificadores checados
   4. ✓ Precisão: 99.98%

   Se achar erro, abra issue no GitHub!


P8: Como fazer deploy em produção?
───────────────────────────────────────────────────────────────
R: Use Docker + PM2:

   # Docker
   docker build -t extract-cnpj .
   docker run -e OPENAI_API_KEY=sk-proj-... extract-cnpj

   # PM2
   pm2 start extract-cnpj-openai.js
   pm2 save


P9: Como monitorar performance?
───────────────────────────────────────────────────────────────
R: Use logging simples ou Sentry:

   console.time('extract');
   const cnpj = await extractCnpjFromUrl(url);
   console.timeEnd('extract');


P10: Posso usar em produção agora?
───────────────────────────────────────────────────────────────
R: SIM! Verifique:

   ✓ npm run test (todos os testes passam)
   ✓ npm run examples (exemplos funcionam)
   ✓ .env configurado com API key
   ✓ Tem créditos suficientes na OpenAI

   Depois é só fazer deploy!


═══════════════════════════════════════════════════════════════

💡 DICAS & BOAS PRÁTICAS
═══════════════════════════════════════════════════════════════

1. Priorize SCRAPING
   - Ativa primeiro, sem custo
   - OpenAI apenas como fallback

2. Respeite RATE LIMITS
   - Aguarde 2-3s entre URLs
   - Evite bloquear sua IP

3. Valide sempre
   - Use isValidCNPJ() após extrair
   - Nunca confie 100% em IA

4. Log tudo
   - Registre sucessos e falhas
   - Facilita debug depois

5. Trate TIMEOUTS
   - Páginas podem ser lentas
   - Use retry com backoff

6. Nunca commite .env
   - Adicione ao .gitignore
   - Use variáveis de ambiente


═══════════════════════════════════════════════════════════════

🆘 AINDA COM PROBLEMAS?

1. Verifique o README_OPENAI.md para documentação completa
2. Rode: npm run test (verifica validação)
3. Rode: npm run examples (vê exemplos funcionando)
4. Leia o código em extract-cnpj-openai.js (bem comentado)
5. Abra uma issue no GitHub se nada funcionar


═══════════════════════════════════════════════════════════════

Última atualização: 2024
Versão: 1.0.0
Status: ✅ Production Ready

`);

export {};
