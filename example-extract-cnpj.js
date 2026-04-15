/**
 * Exemplo de uso do CNPJExtractor
 * 
 * Instalação:
 * npm install axios cheerio dotenv @google/generative-ai
 * 
 * Configuração:
 * 1. Criar arquivo .env com: GEMINI_API_KEY=sua-chave-aqui
 * 2. Executar: node example-extract-cnpj.js
 */

import CNPJExtractor from './extract-cnpj.js';
import dotenv from 'dotenv';

dotenv.config();

async function demonstrarExtracaoCNPJ() {
  console.log('🚀 Demonstração do Extrator de CNPJ\n');
  console.log('='.repeat(60));

  // Inicializar extrator com IA habilitada (opcional)
  const extractor = new CNPJExtractor({
    apiKey: process.env.GEMINI_API_KEY,
    useAI: true,
    timeout: 15000,
  });

  // Exemplos de URLs para testar
  const testUrls = [
    'https://www.google.com.br',
    'https://www.microsoft.com',
    'https://www.amazon.com.br',
    // Adicione suas próprias URLs aqui
  ];

  // Processar cada URL
  for (const url of testUrls) {
    console.log(`\n${'─'.repeat(60)}`);
    
    try {
      const result = await extractor.extract(url);

      // Exibir resultado formatado
      console.log(`\n📌 Resultado para: ${url}`);
      console.log(`   CNPJ: ${result.cnpj || 'Não encontrado'}`);
      console.log(`   Fonte: ${result.source}`);
      console.log(`   Confiança: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`   Validado: ${result.validated ? '✓ Sim' : '✗ Não'}`);
      
      if (result.error) {
        console.log(`   ⚠️ Erro: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ Erro ao processar ${url}: ${error.message}`);
    }

    // Pequeno delay entre requisições
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Exibir estatísticas de cache
  console.log(`\n${'═'.repeat(60)}`);
  console.log('\n📊 Estatísticas de Cache:');
  const stats = extractor.getCacheStats();
  console.log(`   Entradas em cache: ${stats.size}`);
  
  if (stats.entries.length > 0) {
    console.log('\n   Detalhes:');
    stats.entries.forEach((entry, idx) => {
      console.log(`   ${idx + 1}. ${entry.url}`);
      console.log(`      → CNPJ: ${entry.cnpj || 'N/A'}`);
      console.log(`      → Fonte: ${entry.source}`);
      console.log(`      → Confiança: ${(entry.confidence * 100).toFixed(0)}%`);
    });
  }
}

/**
 * Exemplo 2: Uso programático em um serviço
 */
async function exemploBatch() {
  console.log('\n\n🔄 Exemplo 2: Processamento em Lote\n');
  console.log('='.repeat(60));

  const extractor = new CNPJExtractor({
    useAI: false, // Desabilitar IA para teste rápido
  });

  const empresas = [
    { nome: 'Google Brasil', url: 'https://www.google.com.br' },
    { nome: 'Microsoft', url: 'https://www.microsoft.com' },
  ];

  const resultados = [];

  for (const empresa of empresas) {
    console.log(`\n⏳ Processando: ${empresa.nome}...`);
    
    try {
      const result = await extractor.extract(empresa.url);
      
      resultados.push({
        ...empresa,
        cnpj: result.cnpj,
        fonte: result.source,
        confianca: result.confidence,
        valido: result.validated,
      });

      console.log(`✓ CNPJ: ${result.cnpj || 'N/A'}`);
    } catch (error) {
      console.error(`✗ Erro: ${error.message}`);
      resultados.push({
        ...empresa,
        cnpj: null,
        erro: error.message,
      });
    }
  }

  // Exibir resumo
  console.log(`\n${'═'.repeat(60)}`);
  console.log('\n📋 Resumo de Resultados:');
  console.table(resultados);
}

/**
 * Exemplo 3: Validação de CNPJ
 */
function exemploValidacao() {
  console.log('\n\n✅ Exemplo 3: Validação de CNPJ\n');
  console.log('='.repeat(60));

  const extractor = new CNPJExtractor();

  const testCases = [
    { cnpj: '11.222.333/0001-81', esperado: true, descricao: 'CNPJ válido formatado' },
    { cnpj: '11222333000181', esperado: true, descricao: 'CNPJ válido sem formatação' },
    { cnpj: '11.111.111/1111-11', esperado: false, descricao: 'CNPJ com dígitos repetidos' },
    { cnpj: '11.222.333/0001-82', esperado: false, descricao: 'CNPJ com checksum inválido' },
    { cnpj: '123', esperado: false, descricao: 'CNPJ incompleto' },
  ];

  console.log('\nTestando validação de CNPJ:\n');

  testCases.forEach((test, idx) => {
    const resultado = extractor.validateCNPJ(test.cnpj);
    const status = resultado === test.esperado ? '✓' : '✗';
    
    console.log(`${status} Teste ${idx + 1}: ${test.descricao}`);
    console.log(`   Entrada: ${test.cnpj}`);
    console.log(`   Resultado: ${resultado ? 'Válido' : 'Inválido'}`);
    console.log(`   Esperado: ${test.esperado ? 'Válido' : 'Inválido'}`);
    console.log();
  });
}

/**
 * Exemplo 4: Uso com tratamento de erros
 */
async function exemploTratamentoErros() {
  console.log('\n\n⚠️ Exemplo 4: Tratamento de Erros\n');
  console.log('='.repeat(60));

  const extractor = new CNPJExtractor({
    maxRetries: 2,
    timeout: 5000,
  });

  const urls = [
    'https://site-invalido-12345.com.br', // Site inexistente
    'invalid-url', // URL inválida
    'https://www.google.com.br', // Site válido
  ];

  for (const url of urls) {
    console.log(`\n🔍 Testando: ${url}`);
    
    const result = await extractor.extract(url);
    
    if (result.error) {
      console.log(`⚠️ Erro: ${result.error}`);
    } else if (result.cnpj) {
      console.log(`✓ CNPJ encontrado: ${result.cnpj}`);
    } else {
      console.log(`✗ CNPJ não encontrado`);
    }
  }
}

/**
 * Exemplo 5: Integração com API Express
 */
export function setupCNPJAPI(app, extractor) {
  /**
   * POST /api/extract-cnpj
   * Body: { url: "https://..." }
   * Response: { cnpj: "...", confidence: 0.9, ... }
   */
  app.post('/api/extract-cnpj', async (req, res) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({
          error: 'URL é obrigatória',
        });
      }

      const result = await extractor.extract(url);

      res.json({
        url,
        ...result,
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  });

  /**
   * POST /api/extract-cnpj/batch
   * Body: { urls: ["https://...", "https://..."] }
   * Response: { results: [...] }
   */
  app.post('/api/extract-cnpj/batch', async (req, res) => {
    try {
      const { urls } = req.body;

      if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({
          error: 'URLs deve ser um array não vazio',
        });
      }

      const results = [];

      for (const url of urls) {
        try {
          const result = await extractor.extract(url);
          results.push({
            url,
            ...result,
          });
        } catch (error) {
          results.push({
            url,
            error: error.message,
            cnpj: null,
          });
        }
      }

      res.json({
        total: urls.length,
        sucesso: results.filter(r => r.cnpj).length,
        erro: results.filter(r => r.error).length,
        results,
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  });

  /**
   * GET /api/extract-cnpj/cache
   * Response: Estatísticas de cache
   */
  app.get('/api/extract-cnpj/cache', (req, res) => {
    const stats = extractor.getCacheStats();
    res.json(stats);
  });

  /**
   * DELETE /api/extract-cnpj/cache
   * Response: Confirmação de limpeza
   */
  app.delete('/api/extract-cnpj/cache', (req, res) => {
    extractor.clearCache();
    res.json({
      message: 'Cache limpo com sucesso',
    });
  });
}

// Executar exemplos
console.log('\n');
console.log('╔' + '═'.repeat(58) + '╗');
console.log('║' + ' '.repeat(10) + 'DEMONSTRAÇÃO DO EXTRATOR DE CNPJ' + ' '.repeat(16) + '║');
console.log('╚' + '═'.repeat(58) + '╝');

// Descomente para executar os exemplos
// await demonstrarExtracaoCNPJ();
// await exemploBatch();
exemploValidacao();
// await exemploTratamentoErros();

console.log('\n' + '═'.repeat(60));
console.log('Exemplos concluídos!\n');
