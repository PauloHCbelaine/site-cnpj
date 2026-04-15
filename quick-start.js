/**
 * QUICK START - Exemplo pronto para usar
 * 
 * Copie e cole este código no seu projeto
 * Instale dependências: npm install axios cheerio dotenv
 */

import CNPJExtractor from './extract-cnpj.js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================
// INICIALIZAR EXTRATOR
// ============================================

const extractor = new CNPJExtractor({
  // Usar IA como fallback (opcional)
  apiKey: process.env.GEMINI_API_KEY,
  useAI: true,
  
  // Configurações (opcional)
  timeout: 15000,
  maxRetries: 3,
});

// ============================================
// EXEMPLO 1: EXTRAIR CNPJ DE UMA URL
// ============================================

async function exemplo1() {
  console.log('\n📌 EXEMPLO 1: Extrair CNPJ de uma URL\n');
  
  const url = 'https://www.google.com.br';
  console.log(`URL: ${url}\n`);
  
  const result = await extractor.extract(url);
  
  console.log('Resultado:');
  console.log(`  CNPJ: ${result.cnpj || 'Não encontrado'}`);
  console.log(`  Confiança: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`  Fonte: ${result.source}`);
  console.log(`  Validado: ${result.validated ? '✓ Sim' : '✗ Não'}`);
}

// ============================================
// EXEMPLO 2: VALIDAR CNPJ
// ============================================

async function exemplo2() {
  console.log('\n✅ EXEMPLO 2: Validar CNPJ\n');
  
  const cnpjs = [
    '11.222.333/0001-81',  // Válido
    '11.111.111/1111-11',  // Inválido (repetido)
    '11.222.333/0001-82',  // Inválido (checksum errado)
  ];
  
  cnpjs.forEach(cnpj => {
    const isValid = extractor.validateCNPJ(cnpj);
    const status = isValid ? '✓ Válido' : '✗ Inválido';
    console.log(`${cnpj} → ${status}`);
  });
}

// ============================================
// EXEMPLO 3: NORMALIZAR CNPJ
// ============================================

async function exemplo3() {
  console.log('\n🔄 EXEMPLO 3: Normalizar CNPJ\n');
  
  const formatos = [
    '11222333000181',         // Sem formatação
    '11-222-333-0001-81',     // Dashes
    '11 222 333 0001 81',     // Espaços
    '11.222.333/0001-81',     // Já formatado
  ];
  
  formatos.forEach(fmt => {
    const normalized = extractor.normalizeCNPJ(fmt);
    console.log(`${fmt.padEnd(25)} → ${normalized}`);
  });
}

// ============================================
// EXEMPLO 4: PROCESSAR LOTE
// ============================================

async function exemplo4() {
  console.log('\n📦 EXEMPLO 4: Processar Lote de URLs\n');
  
  const urls = [
    'https://www.google.com.br',
    'https://www.microsoft.com',
    'https://www.amazon.com.br',
  ];
  
  console.log(`Processando ${urls.length} URLs...\n`);
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);
    
    try {
      const result = await extractor.extract(url);
      
      if (result.cnpj) {
        console.log(`  ✓ CNPJ: ${result.cnpj}`);
      } else {
        console.log(`  ✗ Não encontrado`);
      }
    } catch (error) {
      console.log(`  ⚠️ Erro: ${error.message}`);
    }
    
    // Delay entre requisições
    if (i < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// ============================================
// EXEMPLO 5: USAR CACHE
// ============================================

async function exemplo5() {
  console.log('\n💾 EXEMPLO 5: Usar Cache\n');
  
  const url = 'https://www.google.com.br';
  
  console.log('Primeira requisição (vai para cache):');
  let result = await extractor.extract(url);
  console.log(`  CNPJ: ${result.cnpj || 'N/A'}`);
  
  console.log('\nSegunda requisição (do cache, instantânea):');
  result = await extractor.extract(url);
  console.log(`  CNPJ: ${result.cnpj || 'N/A'}`);
  
  // Estatísticas de cache
  const stats = extractor.getCacheStats();
  console.log(`\nEstatísticas de Cache:`);
  console.log(`  Entradas: ${stats.size}`);
  
  // Limpar cache
  extractor.clearCache();
  console.log(`\nCache limpo!`);
}

// ============================================
// EXEMPLO 6: TRATAMENTO DE ERROS
// ============================================

async function exemplo6() {
  console.log('\n⚠️ EXEMPLO 6: Tratamento de Erros\n');
  
  const urls = [
    'https://site-inexistente-12345.com.br',
    'invalid-url',
    'https://www.google.com.br',
  ];
  
  for (const url of urls) {
    console.log(`\nTestando: ${url}`);
    
    const result = await extractor.extract(url);
    
    if (result.error) {
      console.log(`  ❌ Erro: ${result.error}`);
    } else if (result.cnpj) {
      console.log(`  ✓ CNPJ: ${result.cnpj}`);
    } else {
      console.log(`  ⚠️ CNPJ não encontrado`);
    }
  }
}

// ============================================
// MENU INTERATIVO
// ============================================

async function menu() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   EXTRATOR DE CNPJ - QUICK START      ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  console.log('Exemplos disponíveis:');
  console.log('  1. Extrair CNPJ de uma URL');
  console.log('  2. Validar CNPJ');
  console.log('  3. Normalizar CNPJ');
  console.log('  4. Processar Lote de URLs');
  console.log('  5. Usar Cache');
  console.log('  6. Tratamento de Erros');
  console.log('  7. Executar Todos\n');
  
  // Executar exemplo específico ou todos
  const args = process.argv.slice(2);
  const choice = args[0] || '7';
  
  switch (choice) {
    case '1':
      await exemplo1();
      break;
    case '2':
      exemplo2();
      break;
    case '3':
      exemplo3();
      break;
    case '4':
      await exemplo4();
      break;
    case '5':
      await exemplo5();
      break;
    case '6':
      await exemplo6();
      break;
    case '7':
      await exemplo1();
      exemplo2();
      exemplo3();
      await exemplo4();
      await exemplo5();
      await exemplo6();
      break;
    default:
      console.log('Opção inválida');
  }
  
  console.log('\n═══════════════════════════════════════════════\n');
}

// ============================================
// EXECUTAR
// ============================================

menu().catch(console.error);

// ============================================
// DICAS DE USO
// ============================================

/*

EXECUTAR EXEMPLOS:

  # Executar todos
  node quick-start.js

  # Exemplo específico
  node quick-start.js 1
  node quick-start.js 2
  node quick-start.js 3

DENTRO DO SEU CÓDIGO:

  import CNPJExtractor from './extract-cnpj.js';
  
  const extractor = new CNPJExtractor();
  
  // Extrair
  const result = await extractor.extract('https://empresa.com.br');
  if (result.cnpj) {
    console.log(`CNPJ encontrado: ${result.cnpj}`);
  }
  
  // Validar
  const isValid = extractor.validateCNPJ('11.222.333/0001-81');
  console.log(isValid ? 'Válido' : 'Inválido');
  
  // Normalizar
  const normalized = extractor.normalizeCNPJ('11222333000181');
  console.log(normalized); // "11.222.333/0001-81"

VARIÁVEIS DE AMBIENTE:

  GEMINI_API_KEY=sua-chave-aqui
  NODE_ENV=production
  TIMEOUT=15000

INTEGRAÇÃO COM EXPRESS:

  import express from 'express';
  import CNPJExtractor from './extract-cnpj.js';
  
  const app = express();
  const extractor = new CNPJExtractor();
  
  app.post('/cnpj', async (req, res) => {
    const result = await extractor.extract(req.body.url);
    res.json(result);
  });
  
  app.listen(3000);

*/
